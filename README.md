# Dashboard Hub

Internal links page for Triangle Investment Group dashboards, gated behind a
single shared passcode.

## How the login gate works

- One passcode, stored in the `PASSCODE` environment variable. No user
  accounts, no auth provider, no database.
- The whole app (dashboard page, login page, static assets) is served by a
  single Express app (`src/app.js`), deployed on Vercel as one serverless
  function (`api/index.js`, wired up via `vercel.json`) so every route is
  gated the same way — nothing can be reached by hitting Vercel's static
  file hosting directly.
- Sessions are a signed cookie, not a session store: the cookie value is
  `<issuedAtMs>.<hmac-sha256(issuedAtMs)>`, keyed off `PASSCODE` itself.
  Verifying just means recomputing the HMAC and checking it with a
  timing-safe comparison — no lookup anywhere. Rotating `PASSCODE`
  invalidates every existing session for free.
- The cookie lasts 30 days and **slides forward on every authenticated
  request** (a fresh `Set-Cookie` with a reset `Max-Age` is sent each time),
  so anyone who visits at least once a month is never re-prompted.
- `/robots.txt` is served un-gated and disallows all crawlers (including
  known AI scrapers), and every response — including the login page and
  error pages — carries `X-Robots-Tag: noindex, nofollow, noarchive`. This
  is defense-in-depth; the passcode is what actually keeps the site
  private.

## Adding dashboards

There are two ways to add a dashboard to the hub:

- **"+ Add Dashboard" button** (in the app itself): any team member can add a
  link without touching code. These are saved to that browser's
  `localStorage`, so they persist across reloads on that device, but — since
  there's no database behind this hub — they aren't automatically visible to
  other people's browsers. Use this for a quick personal addition, or as a
  way to draft the entry before someone adds it permanently below.
- **Editing `SITES` in `public/index.html`**: for a dashboard everyone on the
  team should see, add a `{ ... }` block to the `SITES` array (see the
  comment above it in the file) and deploy. This is the only way to add a
  dashboard for every visitor, since the hub has no backend storage.

## Local development

```bash
npm install
PASSCODE=your-local-passcode npm run dev
```

Then visit `http://localhost:3000`.

## Deploying

Set `PASSCODE` in the Vercel project's Environment Variables (Project
Settings → Environment Variables) — that's the only env var this app needs.
