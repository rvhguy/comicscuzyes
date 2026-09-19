# Comics Cuz Yes — project notes

A webcomic site at **comicscuzyes.com** for my daughter, who publishes under the pen
name **Octember**. She uploads; nothing goes live until I approve it.

**Status as of 2026-09-19: deployed and tested end to end.** Checklist steps 1–8 and 10
are done; step 9 (Access) was deliberately skipped; step 11 (her Mac and iPad) is next.

- Site: comicscuzyes.com + www, Cloudflare Pages, built from the private repo
  `rvhguy/comicscuzyes`. Remote is `git@github-personal:rvhguy/comicscuzyes.git` — never a
  plain `github.com` remote.
- Worker `comicscuzyes-publisher` at `publish.comicscuzyes.com` (custom domain, declared in
  `wrangler.toml`) and `comicscuzyes-publisher.rvhguy.workers.dev`. Preview URLs are off.
  Cloudflare account `c8fb671d6f0cdef2680387e0ff151755` — there's a second account, so run
  `npx wrangler whoami` before creating anything.
- KV `PENDING` = `9e72116d60804c869c9e9db441d7fce9`. Approval email goes to
  bowahandrobert@gmail.com via Resend.
- Wrangler is pinned (exact) in `worker/package.json`; `npm install` in `worker/` first.
- Four Worker secrets: `SUBMIT_SECRET`, `APPROVAL_SECRET`, `GH_TOKEN`, `RESEND_KEY`. Worker
  secrets are write-only — nothing can read them back. `SUBMIT_SECRET` is also in my macOS
  Keychain: `security find-generic-password -s comicscuzyes-SUBMIT_SECRET -w`. If a secret
  is lost, generate a new one and `wrangler secret put` it again.
- **The GitHub token expires 2027-08-01. Publishing stops silently then** — approve links
  will fail at the commit step. Make a new fine-grained token (Contents: read/write, this
  repo only) and `npx wrangler secret put GH_TOKEN`.

`DEPLOY-CHECKLIST.html` / `SETUP.md` describe the original setup. The Cloudflare dashboard
has moved since: a Worker's custom domains are now on its own **Domains** tab.

---

## How it works

```
her Mac/iPad  ──►  publish.comicscuzyes.com  ──►  Cloudflare KV (pending)
 droplet app          (Cloudflare Worker)              │
 or Shortcut                                           ▼
                                          email to me + /review queue page
                                                       │  I approve
                                                       ▼
                                    one GitHub commit ──► Pages build ──► live
```

Pending comics live in KV and never touch the repo. Approving writes the image and its
markdown in a **single** commit — two commits would trigger two Pages builds and briefly
publish a comic whose image hadn't landed yet. Rejecting deletes it from KV.

## Layout

```
src/                 Eleventy site (comics are markdown + an image, nothing else)
  comics/*.md        one file per strip: title, date, slug, image, alt
  static/            css, self-hosted fonts, comic images
worker/              the Cloudflare Worker: submit, approve, reject, /review
  test.mjs           22 checks, no network needed: `node test.mjs`
clients/             the macOS droplet app + its build script
```

## Decisions, and why

**She has no account anywhere.** No GitHub, no CMS login, no Cloudflare Access seat. A
drag-and-drop app on her Mac holds a submit secret, and that *is* the credential. This
was chosen over Decap CMS + GitHub OAuth (would require her to have a GitHub account,
which has a 13+ age floor), DecapBridge (a third party in the publish path), Decap Turbo
($37/mo minimum), and WordPress with a Contributor role (a maintenance treadmill — the
whole point of the Bluehost migration was escaping exactly that).

**The client apps never hold the GitHub token.** They carry only `SUBMIT_SECRET`, which
means "may add something to the approval queue" and nothing more. The real token is a
Worker secret. If her laptop leaks the submit secret, rotate one string and rebuild her
app; the repo was never exposed.

**Not hosted on the Hetzner box.** Deliberately — this keeps the comic's uptime
independent of the wiki farm, and there's no server to patch.

**Git repo rather than an R2 bucket** for the archive, so her body of work stays as plain
files with history that can be cloned anywhere.

## Traps I already fell into — don't re-introduce these

**A Worker is reachable at its raw `*.workers.dev` hostname, where the Cloudflare Access
policy does not apply.** Configuring Access on `publish.comicscuzyes.com` is *not*
sufficient; without the JWT check inside the Worker, the approval queue is open to anyone
who guesses that hostname. `accessOk()` in `worker/src/index.js` verifies the Access JWT
against Cloudflare's public certs, checking issuer, audience, and expiry. Keep it.

**`ACCESS_TEAM` and `ACCESS_AUD` are baked in at deploy time.** Until you redeploy after
creating the Access app, the Worker rejects every request to `/review` — including yours,
even after a successful login. This looks exactly like a permissions bug and is not one.

**Access was skipped on purpose (2026-09-19), so `/review` returns 403 to everyone.** That's
by design, not a bug. Approvals happen only through the signed Publish/Not yet links in
each email — per-comic, no login, valid one week. The catch: a comic whose email link has
expired can't be approved (it stays in KV until its 60-day TTL); ask her to send it again.
If that gets annoying, the considered fix was a `REVIEW_KEY` secret that unlocks the queue
page at a bookmarkable URL, with the page's buttons using the same signed per-comic tokens.
Keep `accessOk()` either way; it's what keeps `/review` shut on every hostname.

**Worker secrets must be set before the first deploy.** With `SUBMIT_SECRET` unset, the
submit check compares against the literal `Bearer undefined`.

**Multipart form encoding converts a typed newline to CRLF.** A stray carriage return
inside YAML front matter breaks the Eleventy build, so a comic could be approved and then
silently never appear. `yamlStr()` flattens control characters. There's a regression test.

**MailChannels' free email-from-Workers tier is end-of-life.** Most tutorials still tell
you to use it. This uses Resend instead.

**Gloria Hallelujah (the title font) has very tall ascenders.** At tight line spacing the
Y of "Yes" collides with the line above. `.logo` needs generous `line-height`. Also:
Gochi Hand was rejected because its lowercase z reads as a 3 — "Cu3 Yes".

## Still untested

- **The AppleScript droplet has never been compiled.** It was written on Linux, where
  `osacompile` doesn't exist. Expect to fix a syntax error or two on the first build.
- **The Shortcut can't be generated** — Shortcuts files are signed binaries. SETUP.md §7
  has the six manual steps. Worth doing: it's what makes publishing from an iPad work.

## Open questions

- Comments are off. That was my call, not a discussed decision.
- Whether the site should be publicly listed or quietly unlisted was never settled.
- The placeholder stick-figure comics in `src/comics/` are mine, not hers. Delete all
  three the moment she uploads a real one.
