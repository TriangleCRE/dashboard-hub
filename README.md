# Dashboard Hub

Internal links page for Triangle Investment Group dashboards, gated behind a
single shared passcode.

## How the login gate works

- One passcode, stored in the `PASSCODE` environment variable. No user
  accounts, no auth provider.
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

Every dashboard on the hub — the ones it launched with and anything added
since — is a row in a `dashboards` table in Postgres (Neon, attached to this
Vercel project). There's no code to edit anymore:

- The **"+ Add Dashboard"** button (on either page, see below) adds a new
  card/row.
- The **pencil icon** on any card/row edits its name, URL, last-updated
  date, next-update-due date, owner, description, sources, note, site
  password, and walkthrough link.
- The **Remove** button deletes it.

Any team member can do all three. Because they all go through the
`/api/dashboards` endpoints (`src/app.js`) to the same database (`src/db.js`),
a change one person makes shows up for everyone the next time they load the
page — this isn't per-browser storage.

The app creates the `dashboards` table itself, and seeds it with the
original dashboards, the first time it handles a request against a fresh
database — no manual migration step required, in local dev or in
production.

## Dashboard Hub vs. Tracker

There are two pages over the same underlying dashboard list:

- **`/` — the Hub.** The card grid people click through to open a
  dashboard.
- **`/tracker` — the Tracker.** A table-of-contents view for keeping the
  hub itself maintained: when each dashboard was last updated, when it's
  next due, who owns it, and what sources feed an update (hover or tab to
  the ⓘ to see them).

Both pages are just different renderings of the same `/api/dashboards` data
and share one Add/Edit modal (`public/shared.js`) — there's no separate
sync step to write. Add a dashboard on either page and it appears on both;
edit "Last updated" (or anything else) from the Tracker and the Hub reflects
it on its next load, because both pages read and write the exact same row.

On the Tracker, Owner, Last updated, Next update due, and Sources are also
editable right in the table — click a value (or tab to it and press Enter)
to turn it into a field, save with Enter/blur (Sources gets an explicit
Save/Cancel since it's multi-line), or back out with Escape. The pencil
icon in the last column still opens the full Add/Edit modal for everything
else (name, URL, description, site password, note, walkthrough link). The
Add/Edit modal itself is grouped into "Shown on the Hub" and "Tracked on
the Tracker" sections, so adding a dashboard from either page makes clear
you're filling out both at once.

Every dashboard currently has exactly one owner — the one person who can
edit it in Claude Code. For now that's Sarah Dahl for everything except the
211/213 N Lewis Billing Tool (Oliver Dahl), including anything added from
here on (the Owner field defaults to Sarah when left blank), but it's a
plain text field so a dashboard can be handed off to someone else later
just by editing it.

The Hub's pinned/"start here" card (currently just the "How to Create a
Claude Dashboard" guide) only pins and badges on the Hub — the Tracker
shows every dashboard the same way, sorted by whichever mode is selected,
since "start here" isn't a Tracker concept.

### Update checklist

Under "Next update due" on the Tracker, each dashboard can carry a
checklist of specific reports/tasks and their due dates — e.g. "Create/
update the Aug 2026 report" due Sep 15, 2026. Click the checklist toggle
to expand it, check items off as you do them, and add new ones as they
come up (`+` in the add row, or type the label and press Enter).

Checking an item off is what actually updates the dashboard's "Last
updated" (to today) — adding, editing, or deleting an item doesn't, since
those aren't "the update happened." Whatever's left unchecked also drives
"Next update due": it's always the soonest due date among items not yet
checked off, recomputed on every checklist change, so once a dashboard has
a checklist, "Next update due" stops being hand-typed and comes from the
checklist instead. A dashboard with no checklist yet keeps the plain
editable field (handy for "As needed" dashboards, or a quick hand-typed
date that doesn't need a whole checklist).

Deal Pipeline, Loan Database, and How to Create a Claude Dashboard are
set to "As needed" — they get updated as new deals/loans show up or the
guide needs a tweak, not on a schedule. Quarterly Property Reports has its
full monthly/quarterly/annual pull schedule seeded in as a checklist (see
`PROPERTY_REPORTS_CHECKLIST` in `src/db.js`), and Utility Usage Tracker has
the next 12 months of its monthly Yardi Breeze pull seeded in the same way
(`UTILITY_TRACKER_CHECKLIST`) — add more from the Tracker as they come up,
since neither checklist regenerates itself once it runs out.

Dashboards added through the Hub (rather than shipped in `SEED_DASHBOARDS`)
have no `seed_key`, so a migration seeding one of these has to match on
something else stable — Utility Usage Tracker's checklist migration
matches on its exact name for that reason.

## Local development

```bash
npm install
PASSCODE=your-local-passcode POSTGRES_URL=postgres://user:pass@localhost:5432/dashboard_hub npm run dev
```

`POSTGRES_URL` can point at any reachable Postgres — a local instance, a
Neon branch, whatever's convenient. The table and seed data are created
automatically on first request.

Then visit `http://localhost:3000`.

## Deploying

Set `PASSCODE` in the Vercel project's Environment Variables (Project
Settings → Environment Variables). `POSTGRES_URL` is set automatically by
the Neon integration under Storage — nothing to configure there by hand.
