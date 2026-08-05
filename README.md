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

## Adding and editing dashboards

There are two ways to add or edit a dashboard on the hub:

- **In the app itself**: the "+ Add Dashboard" button adds a new card, and
  the pencil icon on any card (including the built-in ones) edits its name,
  URL, last-updated date, description, note, and walkthrough link. Any team
  member can do this without touching code. These changes are saved to that
  browser's `localStorage`, so they persist across reloads on that device,
  but — since there's no database behind this hub — they aren't
  automatically visible to other people's browsers. Editing a built-in
  dashboard this way doesn't change the code; it layers a local override on
  top, and the edit modal shows a "Reset to default" option to undo it.
  Use this for a quick personal addition/tweak, or to draft the change
  before someone makes it permanent below.
- **Editing `SITES` in `public/index.html`**: for an addition or edit
  everyone on the team should see, add or change a `{ ... }` block in the
  `SITES` array (see the comment above it in the file) and deploy. This is
  the only way to change what every visitor sees, since the hub has no
  backend storage. Each entry's `id` is what the in-app edit feature keys
  its local overrides on — don't reuse or rename an existing one.

## Local development

```bash
npm install
PASSCODE=your-local-passcode npm run dev
```

Then visit `http://localhost:3000`.

## Deploying

Set `PASSCODE` in the Vercel project's Environment Variables (Project
Settings → Environment Variables) — that's the only env var this app needs.
