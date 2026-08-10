# Comics Cuz Yes — setup

Everything here is built and tested except the two macOS clients, which need a
Mac to compile and a live endpoint to talk to.

```
her Mac/iPad  ──►  publish.comicscuzyes.com  ──►  KV (pending)
   droplet app        (Cloudflare Worker)            │
   or Shortcut                                       ▼
                                            email to you + /review
                                                     │  approve
                                                     ▼
                                      GitHub commit ──► Pages build ──► live
```

Nothing reaches the site without an approval. Rejected comics are deleted from
the queue and never touch the repo.

---

## 1. GitHub

1. New **private** repo, e.g. `yourname/comicscuzyes`. Push this project to it.
2. Settings → Developer settings → **Fine-grained tokens** → new token:
   - Repository access: **only that repo**
   - Permissions: **Contents → Read and write** (nothing else)
   - Expiry: set a real one and diary it; the publish button stops working when
     it lapses.

## 2. Cloudflare Pages

1. Workers & Pages → Create → **Pages** → connect the repo.
2. Build command `npx @11ty/eleventy`, output directory `_site`.
3. Custom domains: `comicscuzyes.com` and `www.comicscuzyes.com`.

## 3. Resend (email)

1. Sign up, add `comicscuzyes.com` as a sending domain.
2. It gives you DKIM/SPF records — add them in Cloudflare DNS.
   **Leave every other domain's mail records alone.**
3. Create an API key.

## 4. The Worker

```bash
cd worker
npx wrangler kv namespace create PENDING     # paste the id into wrangler.toml
```

Fill in `wrangler.toml`: `GH_REPO`, `NOTIFY_TO`, `ACCESS_TEAM`, `ACCESS_AUD`.

```bash
npx wrangler secret put SUBMIT_SECRET        # openssl rand -hex 24
npx wrangler secret put APPROVAL_SECRET      # openssl rand -hex 32, different
npx wrangler secret put GH_TOKEN
npx wrangler secret put RESEND_KEY
npx wrangler deploy
```

Then add `publish.comicscuzyes.com` as a custom domain on the Worker.

## 5. Cloudflare Access — so you're not typing PINs

Zero Trust → Access → Applications → **Add a self-hosted application**:

- Domain: `publish.comicscuzyes.com`, path `review`
- **Session duration: 1 month** (the default is 24 hours)
- Policy: Allow → Emails → your address

Then Settings → Authentication → add **Google** as a login method. A plain
Gmail account works; Workspace is not required. Once Google is the login method
and the session is a month long, you'll effectively never see a prompt — and
the one-click links in the notification email skip it entirely anyway.

Copy the application's **Audience (AUD) tag** into `wrangler.toml` as
`ACCESS_AUD`, and your team name (`<team>.cloudflareaccess.com`) as
`ACCESS_TEAM`, then redeploy. The Worker verifies the Access JWT itself, so the
queue stays shut even if someone finds the raw `*.workers.dev` hostname.

## 6. Her Mac — the droplet

```bash
cd clients
./build-droplet.sh <the SUBMIT_SECRET you set above>
```

Drag **Send to Comics Cuz Yes.app** into her Dock. Drop a PNG on it: it asks
for a title, asks if she wants to say anything about it, sends, and tells her
it's waiting for you. First launch may need a right-click → Open.

**Untested on macOS** — this was written in Linux, where `osacompile` doesn't
exist. Expect to shake out a syntax error or two on the first build.

## 7. Her Mac and iPad — the Shortcut

Shortcuts files are signed binaries, so this one has to be built by hand. Six
steps, once, and it syncs to her iPad through iCloud:

1. Shortcuts → **+** → name it **Send to Comics Cuz Yes**.
2. Shortcut Details (ⓘ) → tick **Show in Share Sheet**; set accepted input to
   **Images only**.
3. Add **Ask for Input** → Text → prompt "What's this comic called?" → the
   result is `Provided Input`.
4. Add **Get Contents of URL**:
   - URL `https://publish.comicscuzyes.com/submit`
   - Method **POST**
   - Headers: `Authorization` = `Bearer <SUBMIT_SECRET>`
   - Request Body **Form**:
     - `image` → type **File** → Shortcut Input
     - `title` → type **Text** → Provided Input
5. Add **Show Notification** with the text "Sent to Dad!".
6. Run it once from Photos via the share sheet to grant permissions.

Now she can publish from Procreate, Photos, or Preview: Share → Send to Comics
Cuz Yes.

---

## Rotating the secret

If the app's secret ever leaks, it can submit comics to your queue — that's
all. It cannot publish, and it cannot touch the repo.

```bash
cd worker && npx wrangler secret put SUBMIT_SECRET   # new value
cd ../clients && ./build-droplet.sh <new value>      # rebuild her app
```

Then update the header in her Shortcut.

## Running the tests

```bash
cd worker && node test.mjs     # 22 checks, no network needed
```
