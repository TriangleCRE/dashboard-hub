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
  date, next-update-due date, owner, description, sources, instructions,
  note, site password, and walkthrough link.
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
  next due, who owns it, what sources feed an update, and how to actually
  make one (click the "Sources"/"Instructions" buttons to see them).

Both pages are just different renderings of the same `/api/dashboards` data
and share one Add/Edit modal (`public/shared.js`) — there's no separate
sync step to write. Add a dashboard on either page and it appears on both;
edit "Last updated" (or anything else) from the Tracker and the Hub reflects
it on its next load, because both pages read and write the exact same row.

On the Tracker, Owner, Last updated, Next update due, Sources, and
Instructions are also editable right in the table — click a value (or tab
to it and press Enter) to turn it into a field, save with Enter/blur
(Sources and Instructions get an explicit Save/Cancel since they're
multi-line), or back out with Escape. The pencil icon in the last column
still opens the full Add/Edit modal for everything else (name, URL,
description, site password, note, walkthrough link). The Add/Edit modal
itself is grouped into "Shown on the Hub" and "Tracked on the Tracker"
sections, so adding a dashboard from either page makes clear you're
filling out both at once — and includes both Sources and Instructions as
fields, so editing a dashboard through that modal never wipes out either
one (they'd otherwise get reset to blank on save, since the modal submits
the dashboard's whole record).

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
checklist of specific reports/tasks and their due dates — e.g. "Aug 2026
report" due Sep 15, 2026. Just the thing itself, not "Create/update the
Aug 2026 report" — checking an item off only ever means you created or
updated it, so the verb in front was redundant. Click the checklist
toggle to expand it, check items off as you do them, and add new ones as
they come up (`+` in the add row, or type the label and press Enter).

Checking an item off is what actually updates the dashboard's "Last
updated" (to today) — adding, editing, or deleting an item doesn't, since
those aren't "the update happened." Whatever's left unchecked also drives
"Next update due": it's always the soonest due date among items not yet
checked off, recomputed on every checklist change, so once a dashboard has
a checklist, "Next update due" stops being hand-typed and comes from the
checklist instead. A dashboard with no checklist yet keeps the plain
editable field (handy for "As needed" dashboards, or a quick hand-typed
date that doesn't need a whole checklist).

An "As needed" dashboard can start a checklist too — handy for jotting
down each new deal/loan/property/lease as it comes up, with no due date
since there's no schedule to hang one on. Adding an item like that
doesn't blank out "As needed" (`computeNextUpdateDue()` in `src/db.js`
keeps it as-is whenever nothing in the checklist has a real due date) —
it only gets promoted to a real date once some item actually has one, the
same as it would for any other dashboard.

Deal Pipeline, Triangle Property Portfolio, Triangle Lease Book, and How
to Create a Claude Dashboard are set to "As needed" — they get updated as
new deals/properties/leases show up or the guide needs a tweak, not on a
schedule. The Tracker's "Show" filter has options
for both ends of that —
"As needed" and "Has a set update date" — alongside Overdue/Due soon. "As
needed" also gets its own subtly different status-pill color
(`.status-asneeded`) rather than reading as the same grey as "Not set" —
it's a deliberate choice, not a missing value.

Quarterly Property Reports, Property Basis Record, Utility Usage Tracker,
and CAM, Taxes, & Insurance each have their pull schedule seeded in as a
checklist — `PROPERTY_REPORTS_CHECKLIST`, `PROPERTY_BASIS_TRACKER_CHECKLIST`,
`UTILITY_TRACKER_CHECKLIST`, and `CAM_TRACKER_CHECKLIST` in `src/db.js`,
respectively (constant names don't always match the dashboard's current
display name — see the note on matching-by-name below). The first two are
both due the 15th of the following month (pushed to the next Monday on a
weekend); Utility Usage Tracker gets 12 months seeded on the same monthly
cadence since its source doc didn't give a fixed list of future dates;
CAM, Taxes, & Insurance so far just has its one 2026 item. Add more from
the Tracker as any of these run out, since none of them regenerate on
their own.

Loan Database moved off "As needed" once it got a real monthly cadence
seeded in as a checklist — `LOAN_DATABASE_CHECKLIST` in `src/db.js`, due
the 15th of every month (pushed to the next Monday on a weekend, same
rule as above) from Sep 2026 through Jul 2027, plus an Aug 28, 2026 item
for Jeryl/Tiffany to weigh in on adopting it as the live source of truth.
The last item, due Jul 15, 2027, is a reminder to add the next batch —
add more from the Tracker once this list runs out, since it doesn't
regenerate on its own.

Hoy Billing Tool, Harbor Freight Billing Tool, and 211/213 N Lewis Billing
Tool also have their bill cycles seeded in as a checklist —
`HOY_BILLING_CHECKLIST`, `HARBOR_FREIGHT_BILLING_CHECKLIST`, and
`N_LEWIS_BILLING_CHECKLIST` in `src/db.js`. Hoy and N Lewis are billed
bimonthly and share the same schedule (7 items, May '26–Jul '26 through
May '27–Jul '27, each due the 1st of the month after the bill period
ends); Harbor Freight is billed monthly (14 items, May '26–Jun '26 through
Jun '27–Jul '27, same "due the 1st of the following month" rule). Unlike
the checklists above, these three ship in `SEED_DASHBOARDS` with a stable
`seed_key`, so their migrations match on that instead of on name — except
that Hoy's Sources didn't show up after they first shipped, meaning its
production row's `seed_key` wasn't actually set (most likely it predates
that column, or was re-added by hand at some point). `ensureSchema()` now
backfills `seed_key` by name first, one row at a time, before the
checklist/sources migrations run, so this can't recur and can't create a
duplicate row on the same cold start either.

Sources and Instructions each support up to 3,000 characters and can hold
several lines with multiple links — the Sources/Instructions popovers on
the Tracker turn any `http(s)://` URL in the text into a clickable link
(`linkifyText()` in `public/tracker.html`, shared by both), so a note
doesn't have to stay short to include real links to the GIS sites, Yardi
Breeze, Google Drive/Sheets, etc. that a dashboard's update actually draws
from. Write `[a short label](https://...)` and the label becomes the
link's visible text instead of the raw URL — handy for the long,
parameter-heavy GIS links in particular; a bare `https://...` still links
too, just with the URL itself as the visible text. Quarterly Property
Reports, Deal Pipeline, Loan Database, Utility Usage Tracker, CAM, Taxes,
& Insurance, Property Basis Record, Hoy Billing Tool, Harbor Freight
Billing Tool, 211/213 N Lewis Billing Tool, and Triangle Lease Book all
have Sources filled in this way. Click a "Sources"/"Instructions" button
to open its popover —
it's click-to-toggle, not hover, so it stays open while you scroll to a
link and click it. The pencil that edits the list lives inside the
popover itself (next to the label at the top), not out in the table —
it's an action on the list you just opened.

Instructions is the same idea as Sources, but answers "how do I actually
make this update, and who's allowed to?" instead of "where does the data
come from?" Every dashboard has one: the ones anyone can update point at
whichever feature on that dashboard does it (e.g. "Import a bill & reading
with AI," "Add Period with Claude," "Add Property"); the ones only Sarah
can update either say so and point at the "Yardi Pull Prompt" feature
(Quarterly Property Reports, Utility Usage Tracker, CAM, Taxes, &
Insurance — Claude's response to that prompt gets pasted into the Claude
Code session connected to the dashboard to commit the update) or just note
that updates go through Claude Code commands as needed (How to Create a
Claude Dashboard, Loan Database, Triangle Property Portfolio, Triangle
Lease Book). See the `*_INSTRUCTIONS` constants in `src/db.js`.

Dashboards added through the Hub (rather than shipped in `SEED_DASHBOARDS`)
have no `seed_key`, so a migration seeding one of these has to match on
something else stable — name, for the checklists/sources/instructions
above and for the "As needed" dashboards not already in `SEED_DASHBOARDS`.
Guessing that name from context has gone wrong more than once (a dashboard
turned out to be called "CAM, Taxes, & Insurance," not "CAM Insurance
Taxes Tracker") — those migrations match on a short list of names (`WHERE
name IN (...)`) rather than a single guess, so a wrong early guess left in
the list costs nothing (it just never matches anything) and a future
rename doesn't need to break the one that already worked. Separately, a
report that Hoy Billing Tool's Sources weren't showing up despite having a
`seed_key` in `SEED_DASHBOARDS` turned out to mean its production row's
`seed_key` had never actually been set — so `ensureSchema()` now backfills
`seed_key` by name for every `SEED_DASHBOARDS` entry (one row at a time,
via a `LIMIT 1` subquery, so it can never violate the column's UNIQUE
constraint even where a genuine duplicate exists) before any seed_key-keyed
migration runs, closing off this whole class of bug rather than just the
one dashboard that happened to get reported.

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
