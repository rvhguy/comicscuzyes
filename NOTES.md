# Comics Cuz Yes — project notes

A webcomic site at **comicscuzyes.com** for my daughter, who publishes under the pen
name **Octember**. She uploads; nothing goes live until I approve it.

**Status as of 2026-08-09: built and tested, not deployed.** No GitHub repo, Cloudflare
Pages project, Worker, Resend account, or Access application exists yet. Follow
`DEPLOY-CHECKLIST.html` (open it in a browser) or `SETUP.md` (same steps, plain text).

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
