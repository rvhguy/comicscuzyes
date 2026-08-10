import {
  safeEqual, sign, verify, slugify, escapeHtml, allowedType, extFor, commitComic,
} from "./lib.js";

const MAX_BYTES = 12 * 1024 * 1024;   // 12 MB — generous for a scan, small enough to bound abuse
const PENDING_TTL = 60 * 60 * 24 * 60; // pending items self-destruct after 60 days
const LINK_TTL = 1000 * 60 * 60 * 24 * 7; // approve/reject links live one week

// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (request.method === "POST" && p === "/submit") return submit(request, env, url);

      let m;
      if ((m = p.match(/^\/p\/([\w-]+)\/image$/))) return pendingImage(m[1], request, env, url);
      if ((m = p.match(/^\/(a|r)\/([\w-]+)$/))) {
        return linkAction(m[1] === "a" ? "approve" : "reject", m[2], request, env, url);
      }
      if (p === "/review") return reviewPage(request, env);
      if ((m = p.match(/^\/review\/([\w-]+)\/(approve|reject)$/)) && request.method === "POST") {
        return reviewAction(m[2], m[1], request, env, true);
      }
      if (p === "/") return text("comicscuzyes publisher. Nothing to see here.", 200);

      return text("Not found", 404);
    } catch (err) {
      console.error(err.stack || String(err));
      return text(`Something broke: ${err.message}`, 500);
    }
  },
};

// --- submission -------------------------------------------------------------

async function submit(request, env, url) {
  const auth = request.headers.get("authorization") || "";
  if (!safeEqual(auth, `Bearer ${env.SUBMIT_SECRET}`)) return text("Nope.", 401);

  const form = await request.formData();
  const file = form.get("image");
  if (!file || typeof file === "string") return text("No image in the upload.", 400);

  const type = file.type || "";
  if (!allowedType(type)) return text(`That's a ${type || "mystery"} file. Send a PNG, JPG, GIF, or WebP.`, 415);

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return text(`That image is ${(bytes.byteLength / 1048576).toFixed(1)} MB. Keep it under 12 MB.`, 413);
  }
  if (bytes.byteLength === 0) return text("That file is empty.", 400);

  const title = (form.get("title") || "").toString().trim() || "Untitled";
  const note = (form.get("note") || "").toString().trim();
  const alt = (form.get("alt") || "").toString().trim() ||
    `A comic by Octember titled "${title}".`;

  // Date comes from the server, not the client — a laptop with a wrong clock
  // shouldn't be able to file a comic under the year 2071.
  const date = new Date().toISOString().slice(0, 10);
  const id = `${date}-${slugify(title)}-${crypto.randomUUID().slice(0, 6)}`;

  const meta = {
    id, title, note, alt, date,
    slug: slugify(title),
    ext: extFor(type),
    type,
    bytes: bytes.byteLength,
    submitted: new Date().toISOString(),
  };

  await env.PENDING.put(`img:${id}`, bytes, { expirationTtl: PENDING_TTL });
  await env.PENDING.put(`meta:${id}`, JSON.stringify(meta), {
    expirationTtl: PENDING_TTL,
    metadata: { title, date },
  });

  await notify(env, url, meta);

  return json({ ok: true, id, message: "Sent to Dad for approval." });
}

// --- email ------------------------------------------------------------------

async function notify(env, url, meta) {
  if (!env.RESEND_KEY || !env.NOTIFY_TO) return;

  const exp = Date.now() + LINK_TTL;
  const [aTok, rTok, iTok] = await Promise.all([
    sign(env.APPROVAL_SECRET, meta.id, "approve", exp),
    sign(env.APPROVAL_SECRET, meta.id, "reject", exp),
    sign(env.APPROVAL_SECRET, meta.id, "image", exp),
  ]);

  const base = `${url.protocol}//${url.host}`;
  const t = escapeHtml(meta.title);

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#2b2622">
  <p style="font-size:17px">Octember submitted a comic.</p>
  <h2 style="font-size:22px;margin:.2em 0">${t}</h2>
  ${meta.note ? `<p style="color:#6d635a">${escapeHtml(meta.note)}</p>` : ""}
  <p><img src="${base}/p/${meta.id}/image?t=${encodeURIComponent(iTok)}"
      alt="${escapeHtml(meta.alt)}"
      style="max-width:100%;border:2px solid #2b2622;border-radius:6px"></p>
  <p style="margin:28px 0">
    <a href="${base}/a/${meta.id}?t=${encodeURIComponent(aTok)}"
       style="background:#e4572e;color:#fff;text-decoration:none;padding:14px 26px;border-radius:8px;font-size:17px;font-weight:600">Publish it</a>
    &nbsp;&nbsp;
    <a href="${base}/r/${meta.id}?t=${encodeURIComponent(rTok)}"
       style="color:#6d635a;text-decoration:underline;padding:14px 10px;font-size:15px">Not yet</a>
  </p>
  <p style="color:#9a9086;font-size:13px">These links work once and expire in a week.
  The full queue is always at <a href="${base}/review" style="color:#9a9086">${base.replace(/^https?:\/\//, "")}/review</a>.</p>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.NOTIFY_FROM || "Comics Cuz Yes <comics@comicscuzyes.com>",
      to: [env.NOTIFY_TO],
      subject: `New comic: ${meta.title}`,
      html,
    }),
  });
  // A failed email must not fail the upload — the comic is safely in the queue
  // either way, and she should not see an error for something on our side.
  if (!res.ok) console.error("resend", res.status, await res.text());
}

// --- pending image ----------------------------------------------------------

async function pendingImage(id, request, env, url) {
  const tok = url.searchParams.get("t");
  const viaAccess = await accessOk(request, env);
  if (!viaAccess && !(await verify(env.APPROVAL_SECRET, id, "image", tok))) {
    return text("Nope.", 403);
  }
  const [img, metaRaw] = await Promise.all([
    env.PENDING.get(`img:${id}`, "arrayBuffer"),
    env.PENDING.get(`meta:${id}`),
  ]);
  if (!img || !metaRaw) return text("That one's gone.", 404);
  return new Response(img, {
    headers: {
      "content-type": JSON.parse(metaRaw).type,
      "cache-control": "private, max-age=300",
    },
  });
}

// --- approve / reject -------------------------------------------------------

async function linkAction(action, id, request, env, url) {
  const tok = url.searchParams.get("t");
  if (!(await verify(env.APPROVAL_SECRET, id, action, tok))) {
    return page("Link expired", `<p>That link has expired or was already used.</p>
      <p><a href="/review">Open the queue</a> to deal with it there.</p>`);
  }
  return reviewAction(action, id, request, env, false);
}

async function reviewAction(action, id, request, env, requireAccess) {
  if (requireAccess && !(await accessOk(request, env))) return text("Nope.", 403);

  const metaRaw = await env.PENDING.get(`meta:${id}`);
  if (!metaRaw) {
    return page("Already handled", `<p>That comic isn't in the queue any more — someone
      (probably you) already dealt with it.</p><p><a href="/review">Back to the queue</a></p>`);
  }
  const meta = JSON.parse(metaRaw);

  if (action === "reject") {
    await Promise.all([env.PENDING.delete(`meta:${id}`), env.PENDING.delete(`img:${id}`)]);
    return page("Sent back", `<p>&ldquo;${escapeHtml(meta.title)}&rdquo; was not published,
      and is out of the queue.</p><p><a href="/review">Back to the queue</a></p>`);
  }

  const imageBytes = await env.PENDING.get(`img:${id}`, "arrayBuffer");
  if (!imageBytes) return page("Missing image", `<p>The image for that one expired. Ask her to send it again.</p>`);

  // Delete only after the commit lands. If GitHub errors, the item stays in the
  // queue and can be retried, rather than vanishing unpublished.
  await commitComic(env, { ...meta, imageBytes });
  await Promise.all([env.PENDING.delete(`meta:${id}`), env.PENDING.delete(`img:${id}`)]);

  return page("Published", `<p>&ldquo;${escapeHtml(meta.title)}&rdquo; is live in about a minute,
    once the site finishes rebuilding.</p>
    <p><a href="https://comicscuzyes.com/">See the site</a> &middot; <a href="/review">Back to the queue</a></p>`);
}

// --- the queue page ---------------------------------------------------------

async function reviewPage(request, env) {
  if (!(await accessOk(request, env))) return text("Nope.", 403);

  const list = await env.PENDING.list({ prefix: "meta:" });
  const metas = (await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.PENDING.get(k.name);
      return raw ? JSON.parse(raw) : null;
    })
  )).filter(Boolean).sort((a, b) => (a.submitted < b.submitted ? 1 : -1));

  const items = metas.map((m) => `
    <article class="card">
      <h2>${escapeHtml(m.title)}</h2>
      <p class="when">submitted ${escapeHtml(m.submitted.replace("T", " ").slice(0, 16))} &middot;
        ${(m.bytes / 1024).toFixed(0)} KB</p>
      ${m.note ? `<p class="note">${escapeHtml(m.note)}</p>` : ""}
      <img src="/p/${m.id}/image" alt="${escapeHtml(m.alt)}">
      <form method="POST" action="/review/${m.id}/approve"><button class="go">Publish it</button></form>
      <form method="POST" action="/review/${m.id}/reject"><button class="no">Not yet</button></form>
    </article>`).join("");

  return page("The queue", metas.length
    ? items
    : `<p class="empty">Nothing waiting. The queue is empty.</p>`);
}

// --- Cloudflare Access ------------------------------------------------------

/**
 * Cloudflare Access sits in front of this Worker, but we verify its JWT
 * ourselves rather than trusting that it ran. Without this, anyone who learns
 * the worker's *.workers.dev hostname reaches /review directly, bypassing
 * Access entirely — the policy only guards the custom domain.
 */
let certsCache = { at: 0, keys: null };

async function accessOk(request, env) {
  if (env.DEV_BYPASS_ACCESS === "1") return true;
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return false;

  const jwt = request.headers.get("Cf-Access-Jwt-Assertion") ||
    (request.headers.get("cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  if (!jwt) return false;

  const [h, pl, sg] = jwt.split(".");
  if (!h || !pl || !sg) return false;

  let header, payload;
  try {
    header = JSON.parse(b64urlToText(h));
    payload = JSON.parse(b64urlToText(pl));
  } catch { return false; }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return false;
  if (payload.nbf && now < payload.nbf - 60) return false;
  if (payload.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return false;

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return false;

  const keys = await accessCerts(env);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;

  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);

  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
    b64urlToBytes(sg), new TextEncoder().encode(`${h}.${pl}`));
}

async function accessCerts(env) {
  if (certsCache.keys && Date.now() - certsCache.at < 3600_000) return certsCache.keys;
  const res = await fetch(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs -> ${res.status}`);
  const { keys } = await res.json();
  certsCache = { at: Date.now(), keys };
  return keys;
}

function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function b64urlToText(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

// --- tiny helpers -----------------------------------------------------------

function text(body, status = 200) {
  return new Response(body + "\n", { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
function page(title, body) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
 body{background:#fbf6ea;color:#2b2622;font:17px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
   margin:0;padding:2rem 1rem 5rem}
 main{max-width:44rem;margin:0 auto}
 h1{font-size:1.9rem;margin:0 0 1.4rem}
 a{color:#e4572e}
 .card{background:#fffdf7;border:2.5px solid #2b2622;border-radius:10px;padding:1rem;margin:0 0 2rem;
   box-shadow:4px 5px 0 rgba(43,38,34,.13)}
 .card h2{margin:.1rem 0 .2rem;font-size:1.3rem}
 .when{color:#6d635a;font-size:.85rem;margin:0 0 .6rem}
 .note{color:#6d635a;border-left:3px solid #ffd93d;padding-left:.7rem;margin:.6rem 0}
 .card img{display:block;width:100%;height:auto;border:1px solid #d8d0c2;border-radius:5px;margin:.7rem 0 1rem}
 form{display:inline}
 button{font:inherit;font-size:1rem;padding:.7rem 1.4rem;border-radius:8px;cursor:pointer;
   border:2px solid #2b2622;margin-right:.6rem}
 .go{background:#e4572e;color:#fff;border-color:#e4572e;font-weight:600}
 .no{background:#fffdf7;color:#2b2622}
 .empty{color:#6d635a}
</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } });
}
