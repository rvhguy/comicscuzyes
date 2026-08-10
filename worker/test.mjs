// Exercises the Worker end to end with an in-memory KV and a stubbed network.
import worker from "./src/index.js";
import { sign } from "./src/lib.js";
import { readFileSync } from "fs";

const kv = new Map();
const PENDING = {
  async put(k, v) { kv.set(k, v); },
  async get(k, type) {
    if (!kv.has(k)) return null;
    const v = kv.get(k);
    return type === "arrayBuffer" ? v : v;
  },
  async delete(k) { kv.delete(k); },
  async list({ prefix }) {
    return { keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
  },
};

const env = {
  PENDING,
  SUBMIT_SECRET: "s3cret-from-the-mac-app",
  APPROVAL_SECRET: "approval-signing-key",
  GH_REPO: "test/comicscuzyes",
  GH_TOKEN: "ghp_fake",
  RESEND_KEY: "re_fake",
  NOTIFY_TO: "dad@example.com",
  DEV_BYPASS_ACCESS: "0",
};

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  sent.push({ u, init });
  if (u.startsWith("https://api.resend.com")) return new Response("{}", { status: 200 });
  if (u.includes("/git/ref/heads/")) return Response.json({ object: { sha: "headsha" } });
  if (u.includes("/git/commits/headsha")) return Response.json({ tree: { sha: "treesha" } });
  if (u.endsWith("/git/blobs")) return Response.json({ sha: "blob" + sent.length });
  if (u.endsWith("/git/trees")) return Response.json({ sha: "newtree" });
  if (u.endsWith("/git/commits")) return Response.json({ sha: "newcommit" });
  if (u.includes("/git/refs/heads/")) return Response.json({ ok: true });
  return realFetch(url, init);
};

const png = readFileSync("../src/static/images/comics/hello-world.png");
const BASE = "https://publish.comicscuzyes.com";
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

function upload(secret, type = "image/png", bytes = png) {
  const fd = new FormData();
  fd.set("image", new File([bytes], "c.png", { type }));
  fd.set("title", "The Cat Situation!");
  fd.set("note", "she was under the couch");
  return new Request(`${BASE}/submit`, {
    method: "POST", body: fd, headers: { authorization: `Bearer ${secret}` },
  });
}

console.log("\nsubmission");
let r = await worker.fetch(upload("wrong-secret"), env);
check("wrong secret is rejected", r.status === 401, r.status);

r = await worker.fetch(upload(env.SUBMIT_SECRET, "application/pdf", png), env);
check("non-image is rejected", r.status === 415, r.status);

r = await worker.fetch(upload(env.SUBMIT_SECRET, "image/png", Buffer.alloc(0)), env);
check("empty file is rejected", r.status === 400, r.status);

r = await worker.fetch(upload(env.SUBMIT_SECRET), env);
const body = await r.json();
check("good upload accepted", r.status === 200 && body.ok, r.status);
const id = body.id;
check("id carries a date and slug", /^\d{4}-\d{2}-\d{2}-the-cat-situation-/.test(id), id);
check("notification email sent", sent.some((s) => s.u.includes("resend.com")));
check("nothing committed to GitHub yet", !sent.some((s) => s.u.includes("api.github.com")));

console.log("\naccess control");
r = await worker.fetch(new Request(`${BASE}/review`), env);
check("queue is closed without Access", r.status === 403, r.status);

r = await worker.fetch(new Request(`${BASE}/p/${id}/image`), env);
check("pending image is closed without Access or token", r.status === 403, r.status);

const imgTok = await sign(env.APPROVAL_SECRET, id, "image", Date.now() + 60000);
r = await worker.fetch(new Request(`${BASE}/p/${id}/image?t=${encodeURIComponent(imgTok)}`), env);
check("pending image opens with a signed token", r.status === 200, r.status);

const wrongTok = await sign("some-other-key", id, "approve", Date.now() + 60000);
r = await worker.fetch(new Request(`${BASE}/a/${id}?t=${encodeURIComponent(wrongTok)}`), env);
check("token signed with the wrong key is refused", (await r.text()).includes("expired"));

const expired = await sign(env.APPROVAL_SECRET, id, "approve", Date.now() - 1000);
r = await worker.fetch(new Request(`${BASE}/a/${id}?t=${encodeURIComponent(expired)}`), env);
check("expired token is refused", (await r.text()).includes("expired"));

const rejTok = await sign(env.APPROVAL_SECRET, id, "reject", Date.now() + 60000);
r = await worker.fetch(new Request(`${BASE}/a/${id}?t=${encodeURIComponent(rejTok)}`), env);
check("a reject token cannot approve", (await r.text()).includes("expired"));

console.log("\nthe queue page");
r = await worker.fetch(new Request(`${BASE}/review`), { ...env, DEV_BYPASS_ACCESS: "1" });
const html = await r.text();
check("queue lists the pending comic", r.status === 200 && html.includes("The Cat Situation!"), r.status);
check("queue shows the note", html.includes("under the couch"));

console.log("\napproval");
const okTok = await sign(env.APPROVAL_SECRET, id, "approve", Date.now() + 60000);
r = await worker.fetch(new Request(`${BASE}/a/${id}?t=${encodeURIComponent(okTok)}`), env);
const okText = await r.text();
check("approve publishes", okText.includes("live in about a minute"), okText.slice(0, 120));
check("a commit was pushed", sent.some((s) => s.u.endsWith("/git/commits") && s.init.method === "POST"));

const treeCall = sent.find((s) => s.u.endsWith("/git/trees"));
const tree = JSON.parse(treeCall.init.body).tree;
check("commit writes exactly 2 files in one commit", tree.length === 2, tree.length);
check("image path is right", tree[0].path.startsWith("src/static/images/comics/the-cat-situation."), tree[0].path);
check("markdown path is right", /^src\/comics\/\d{4}-\d{2}-\d{2}-the-cat-situation\.md$/.test(tree[1].path), tree[1].path);

r = await worker.fetch(new Request(`${BASE}/a/${id}?t=${encodeURIComponent(okTok)}`), env);
check("the same link cannot publish twice", (await r.text()).includes("already dealt with"));

console.log("\nyaml safety");
const fd = new FormData();
fd.set("image", new File([png], "c.png", { type: "image/png" }));
fd.set("title", 'He said "hi"\nthen left: really');
r = await worker.fetch(new Request(`${BASE}/submit`, {
  method: "POST", body: fd, headers: { authorization: `Bearer ${env.SUBMIT_SECRET}` } }), env);
const id2 = (await r.json()).id;
const tok2 = await sign(env.APPROVAL_SECRET, id2, "approve", Date.now() + 60000);
await worker.fetch(new Request(`${BASE}/a/${id2}?t=${encodeURIComponent(tok2)}`), env);
const mdBlob = sent.filter((s) => s.u.endsWith("/git/blobs")).at(-1);
const md = JSON.parse(mdBlob.init.body).content;
check("quotes and newlines in a title stay valid YAML",
  md.includes('title: "He said \\"hi\\" then left: really"'), md.split("\n")[1]);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
