// Shared helpers: signing, slugs, and the GitHub commit.

const enc = new TextEncoder();

/** Constant-time-ish string compare. Avoids leaking the secret via timing. */
export function safeEqual(a, b) {
  const A = enc.encode(String(a)), B = enc.encode(String(b));
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]);
}

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Token authorising ONE action on ONE pending item, until `exp`. */
export async function sign(secret, id, action, exp) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${id}:${action}:${exp}`));
  return `${exp}.${b64url(sig)}`;
}

export async function verify(secret, id, action, token) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const exp = Number(token.slice(0, token.indexOf(".")));
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = await sign(secret, id, action, exp);
  return safeEqual(expected, token);
}

export function slugify(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "comic";
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * YAML-safe double-quoted scalar. Control characters are flattened to spaces
 * first: multipart form encoding turns a typed newline into CRLF, and a stray
 * carriage return inside a quoted scalar breaks the front matter parse.
 */
export function yamlStr(s) {
  const clean = String(s)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `"${clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const EXT = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
};
export const allowedType = (t) => Object.prototype.hasOwnProperty.call(EXT, t);
export const extFor = (t) => EXT[t];

// ---------------------------------------------------------------------------
// GitHub: write the image and its metadata file in ONE commit, via the git
// data API. Two separate Contents-API calls would be simpler but would trigger
// two Pages builds and briefly publish a comic whose image hasn't landed yet.
// ---------------------------------------------------------------------------

async function gh(env, path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "comicscuzyes-publisher",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

export async function commitComic(env, { slug, date, title, alt, note, imageBytes, ext }) {
  const branch = env.GH_BRANCH || "main";

  const ref = await gh(env, `/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const head = await gh(env, `/git/commits/${headSha}`);

  let bin = "";
  const arr = new Uint8Array(imageBytes);
  for (let i = 0; i < arr.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  }
  const imageBlob = await gh(env, "/git/blobs", {
    method: "POST",
    body: JSON.stringify({ content: btoa(bin), encoding: "base64" }),
  });

  const md = `---
title: ${yamlStr(title)}
date: ${date}
slug: ${slug}
image: ${slug}.${ext}
alt: ${yamlStr(alt)}
---
${note ? note.trim() + "\n" : ""}`;

  const mdBlob = await gh(env, "/git/blobs", {
    method: "POST",
    body: JSON.stringify({ content: md, encoding: "utf-8" }),
  });

  const tree = await gh(env, "/git/trees", {
    method: "POST",
    body: JSON.stringify({
      base_tree: head.tree.sha,
      tree: [
        { path: `src/static/images/comics/${slug}.${ext}`, mode: "100644", type: "blob", sha: imageBlob.sha },
        { path: `src/comics/${date}-${slug}.md`, mode: "100644", type: "blob", sha: mdBlob.sha },
      ],
    }),
  });

  const commit = await gh(env, "/git/commits", {
    method: "POST",
    body: JSON.stringify({
      message: `Publish "${title}"`,
      tree: tree.sha,
      parents: [headSha],
    }),
  });

  await gh(env, `/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  return commit.sha;
}
