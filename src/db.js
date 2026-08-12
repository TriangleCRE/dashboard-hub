// Postgres access for the dashboards list. Backed by the Neon database
// connected to this Vercel project (env var POSTGRES_URL / DATABASE_URL —
// whichever the Storage integration named it). One `dashboards` table is
// the single source of truth: every visitor reads and writes the same
// rows, so additions and edits are shared across the whole team instead
// of living in one browser's localStorage.

const { Pool } = require("pg");
const crypto = require("node:crypto");

let pool;
function getPool() {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "POSTGRES_URL (or DATABASE_URL) is not set — the dashboards list has nowhere to read/write."
      );
    }
    // Local dev Postgres has no TLS listener; Neon (and most hosted
    // Postgres) requires it. Detect local by hostname rather than trusting
    // an env flag, so a real deploy always gets SSL even if misconfigured.
    const isLocal = /(^|@)(localhost|127\.0\.0\.1)([:/]|$)/.test(connectionString);
    pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

// Matches the "Aug 5, 2026" style every other date in this app is stored
// as, so a checklist-derived date reads the same as a hand-typed one and
// Date.parse() on the client can still parse it back out.
function formatShortDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// A dashboard's "next update due" is derived from its checklist once it
// has one (see the checklist functions below): the soonest due date among
// items not yet checked off. Items with no due date, or a due date that
// isn't a real date (both allowed — a checklist can track "as needed"
// items too), just don't count toward this.
function computeNextUpdateDue(checklist) {
  const upcoming = (checklist || [])
    .filter((item) => !item.done && item.dueDate && !isNaN(Date.parse(item.dueDate)))
    .map((item) => Date.parse(item.dueDate))
    .sort((a, b) => a - b);
  return upcoming.length ? formatShortDate(new Date(upcoming[0])) : "";
}

// The dashboards this hub shipped with, before it had a database. Seeded
// once via a stable seed_key so re-running this on every cold start never
// creates duplicates (ON CONFLICT DO NOTHING) and never overwrites edits
// someone's since made to them.
// Every dashboard is owned by exactly one person for now — the only one
// who edits it in Claude Code. See the Tracker (public/tracker.html).
const DEFAULT_OWNER = "Sarah Dahl";

// One-time checklist seed for "Quarterly Property Reports" (see the
// migration in ensureSchema below) — the monthly/quarterly/annual pull
// schedule from the "Property Reports Update Timeline" doc. Monthly items
// are due the 15th of the following month (pushed to the next Monday when
// the 15th lands on a weekend); quarterly/annual dates come straight from
// that doc rather than being derived, since they don't follow a fixed
// day-count rule.
function checklistItem(label, dueDate) {
  return { id: crypto.randomUUID(), label, dueDate, done: false, completedDate: "" };
}

const PROPERTY_REPORTS_CHECKLIST = [
  checklistItem("Create/update the Aug 2026 report", "2026-09-15"),
  checklistItem("Create/update the Sep 2026 report", "2026-10-15"),
  checklistItem("Create/update the Oct 2026 report", "2026-11-16"),
  checklistItem("Create/update the Nov 2026 report", "2026-12-15"),
  checklistItem("Create/update the Dec 2026 report", "2027-01-15"),
  checklistItem("Create/update the Jan 2027 report", "2027-02-15"),
  checklistItem("Create/update the Feb 2027 report", "2027-03-15"),
  checklistItem("Create/update the Mar 2027 report", "2027-04-15"),
  checklistItem("Create/update the Apr 2027 report", "2027-05-17"),
  checklistItem("Create/update the May 2027 report", "2027-06-15"),
  checklistItem("Create/update the Jun 2027 report", "2027-07-15"),
  checklistItem("Create/update the Jul 2027 report", "2027-08-16"),
  checklistItem("Create/update the Q3 2026 (Jul–Sep) report", "2026-10-19"),
  checklistItem("Create/update the Q4 2026 (Oct–Dec) report", "2027-01-27"),
  checklistItem("Create/update the Q1 2027 (Jan–Mar) report", "2027-04-19"),
  checklistItem("Create/update the Q2 2027 (Apr–Jun) report", "2027-07-19"),
  checklistItem("Create/update the Q3 2027 (Jul–Sep) report", "2027-10-18"),
  checklistItem("Create/update the FY2026 (Jan–Dec) report", "2027-02-24"),
];

// One-time checklist seed for "Utility Usage Tracker" (see the migration
// in ensureSchema below) — added directly through the Hub, so unlike the
// dashboards below there's no seed_key to match on; the migration matches
// by name instead. Unlike Property Reports, the "Utility Tracker Update
// Prompt" doc doesn't give a fixed list of future dates — it's an ongoing
// monthly pull, best run after the ~8th–10th (once bills from all three
// vendors have posted), so this seeds the next 12 months on that cadence
// rather than a doc-given list; add more from the Tracker as they come up.
const UTILITY_TRACKER_CHECKLIST = [
  checklistItem("Update Aug 2026 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2026-09-10"),
  checklistItem("Update Sep 2026 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2026-10-10"),
  checklistItem("Update Oct 2026 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2026-11-10"),
  checklistItem("Update Nov 2026 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2026-12-10"),
  checklistItem("Update Dec 2026 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2027-01-10"),
  checklistItem("Update Jan 2027 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2027-02-10"),
  checklistItem("Update Feb 2027 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2027-03-10"),
  checklistItem("Update Mar 2027 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2027-04-10"),
  checklistItem("Update Apr 2027 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2027-05-10"),
  checklistItem("Update May 2027 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2027-06-10"),
  checklistItem("Update Jun 2027 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2027-07-10"),
  checklistItem("Update Jul 2027 usage — Dominion VA electric, Columbia Gas, SVEC electric", "2027-08-10"),
];

const UTILITY_TRACKER_SOURCES =
  "Yardi Breeze vendor ledgers — Dominion VA electric (#10456), Columbia Gas (#10380), " +
  "SVEC Coop electric (#10922). Update via Claude Code/Cowork with " +
  "Utility_Usage_Tracker.xlsx attached, Chrome logged into Yardi. Run after the " +
  "~8th–10th of the month once bills post.";

const SEED_DASHBOARDS = [
  {
    seedKey: "how-to-create-a-claude-dashboard",
    name: "How to Create a Claude Dashboard",
    description: "Step-by-step guide for building your own dashboard and adding it to this hub.",
    url: "https://dashboard-guide.vercel.app/",
    lastUpdated: "Aug 5, 2026",
    nextUpdateDue: "As needed",
    owner: DEFAULT_OWNER,
    note: "",
    sitePassword: "2903",
    sources: "",
    walkthrough: "",
    pinned: true,
  },
  {
    seedKey: "quarterly-property-reports",
    name: "Quarterly Property Reports",
    description: "Quarterly performance reports across the property portfolio.",
    url: "https://triangle-property-reports.vercel.app/",
    lastUpdated: "Jul 31, 2026",
    nextUpdateDue: computeNextUpdateDue(PROPERTY_REPORTS_CHECKLIST),
    owner: DEFAULT_OWNER,
    note: "",
    sitePassword: "2903",
    sources: "",
    walkthrough: "",
    checklist: PROPERTY_REPORTS_CHECKLIST,
  },
  {
    seedKey: "deal-pipeline",
    name: "Deal Pipeline",
    description: "Tracker for deals moving through the acquisition pipeline.",
    url: "https://triangle-deal-pipeline-tracker.vercel.app/",
    lastUpdated: "Aug 4, 2026",
    nextUpdateDue: "As needed",
    owner: DEFAULT_OWNER,
    note: "",
    sitePassword: "",
    sources: "",
    walkthrough: "",
  },
  {
    seedKey: "hoy-billing-tool",
    name: "Hoy Billing Tool",
    description: "Water billing tool for the Hoy property.",
    url: "https://hoy-water-tool.vercel.app/",
    lastUpdated: "Jul 31, 2026",
    nextUpdateDue: "",
    owner: DEFAULT_OWNER,
    note: "",
    sitePassword: "",
    sources: "",
    walkthrough: "",
  },
  {
    seedKey: "harbor-freight-billing-tool",
    name: "Harbor Freight Billing Tool",
    description: "Billing tool for the Harbor Freight tenant.",
    url: "https://harbor-freight-billing-tool.vercel.app/",
    lastUpdated: "Jul 31, 2026",
    nextUpdateDue: "",
    owner: DEFAULT_OWNER,
    note: "",
    sitePassword: "",
    sources: "",
    walkthrough: "",
  },
  {
    seedKey: "211-213-n-lewis-billing-tool",
    name: "211/213 N Lewis Billing Tool",
    description: "Water billing tracker for 211/213 N Lewis. Built by Oliver.",
    url: "https://211-213-water-tracker.vercel.app/",
    lastUpdated: "Jul 2, 2026",
    nextUpdateDue: "",
    owner: "Oliver Dahl",
    note: "",
    sitePassword: "",
    sources: "",
    walkthrough: "https://www.loom.com/share/63547bf0c9954445af19ed6249d1b6d6",
  },
  {
    seedKey: "loan-database",
    name: "Loan Database",
    description: "Loan database for Triangle Investment Group.",
    url: "https://triangle-loan-database.vercel.app/",
    lastUpdated: "Jul 7, 2026",
    nextUpdateDue: "As needed",
    owner: DEFAULT_OWNER,
    note: "",
    sitePassword: "",
    sources: "",
    walkthrough: "",
  },
];

let ensureSchemaPromise = null;

// Creates the table (if missing) and seeds the original dashboards (if not
// already present). Safe to call on every request — cheap, idempotent, and
// memoized per warm process so it only actually hits the DB once per cold
// start rather than once per request.
function ensureSchema() {
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS dashboards (
          id BIGSERIAL PRIMARY KEY,
          seed_key TEXT UNIQUE,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          site_password TEXT NOT NULL DEFAULT '',
          walkthrough TEXT NOT NULL DEFAULT '',
          last_updated TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          pinned BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      // Older deployments created this table before the `pinned` /
      // `site_password` columns existed — add them on cold start if
      // they're missing rather than requiring a manual migration.
      await query(`
        ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
      `);
      await query(`
        ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS site_password TEXT NOT NULL DEFAULT '';
      `);
      // Tracker columns (public/tracker.html): who owns/edits the dashboard
      // in Claude Code, when it's next due for an update, and what sources
      // feed that update. Same "add if missing" pattern as the columns
      // above, so older deployments pick them up on their next cold start.
      await query(`
        ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT '';
      `);
      await query(`
        ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS next_update_due TEXT NOT NULL DEFAULT '';
      `);
      await query(`
        ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS sources TEXT NOT NULL DEFAULT '';
      `);
      // The update checklist (public/tracker.html): a list of {id, label,
      // dueDate, done, completedDate} items you check off as you do each
      // update. Checking one off bumps last_updated and recomputes
      // next_update_due from whatever's left — see the checklist functions
      // below.
      await query(`
        ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
      `);
      // Every dashboard added before the Tracker existed has no owner yet.
      // They're all Sarah's for now (see DEFAULT_OWNER above) — backfill
      // rather than leaving the Tracker's Owner column blank for everything
      // that predates it. Never overwrites a real (non-empty) owner.
      await query(
        `UPDATE dashboards SET owner = $1 WHERE owner = ''`,
        [DEFAULT_OWNER]
      );
      // The three migrations below only matter for a database that was
      // seeded before these values existed (a production deploy that
      // already has these 7 rows under their old defaults) — a genuinely
      // fresh install gets all of this straight from SEED_DASHBOARDS below
      // instead, so these are no-ops there. Each is guarded on the column
      // still holding whatever the old default was, so none of them ever
      // overwrite a reassignment made since (from here, or from the
      // Tracker).

      // Oliver Dahl owns the N Lewis billing tool, not the default owner.
      await query(
        `UPDATE dashboards SET owner = 'Oliver Dahl' WHERE seed_key = '211-213-n-lewis-billing-tool' AND owner = $1`,
        [DEFAULT_OWNER]
      );
      // These dashboards aren't on any schedule — they're updated as new
      // deals/properties/tenants/loans show up, not on a cadence.
      await query(`
        UPDATE dashboards SET next_update_due = 'As needed'
        WHERE seed_key IN ('deal-pipeline', 'loan-database', 'how-to-create-a-claude-dashboard')
          AND next_update_due = '';
      `);
      // Property Portfolio, same "as needed" cadence as the three above,
      // but added through the Hub rather than seeded — no seed_key to
      // match on, so this one keys off name instead (same pattern as the
      // Utility Usage Tracker migration below).
      await query(`
        UPDATE dashboards SET next_update_due = 'As needed'
        WHERE name = 'Property Portfolio' AND next_update_due = '';
      `);
      // The monthly/quarterly/annual pull schedule for Quarterly Property
      // Reports (see PROPERTY_REPORTS_CHECKLIST above).
      await query(
        `UPDATE dashboards SET checklist = $1::jsonb, next_update_due = $2
         WHERE seed_key = 'quarterly-property-reports' AND checklist = '[]'::jsonb`,
        [JSON.stringify(PROPERTY_REPORTS_CHECKLIST), computeNextUpdateDue(PROPERTY_REPORTS_CHECKLIST)]
      );
      // The monthly pull schedule for Utility Usage Tracker (see
      // UTILITY_TRACKER_CHECKLIST above). This dashboard was added through
      // the Hub, not seeded, so there's no seed_key to key off — match by
      // name instead. Sources only fills in if still blank, independent of
      // the checklist guard, so it doesn't clobber a note someone's since
      // written by hand.
      await query(
        `UPDATE dashboards
         SET checklist = $1::jsonb,
             next_update_due = $2,
             sources = CASE WHEN sources = '' THEN $3 ELSE sources END
         WHERE name = 'Utility Usage Tracker' AND checklist = '[]'::jsonb`,
        [JSON.stringify(UTILITY_TRACKER_CHECKLIST), computeNextUpdateDue(UTILITY_TRACKER_CHECKLIST), UTILITY_TRACKER_SOURCES]
      );
      // "Site password" used to just be a convention for the freeform Note
      // field (e.g. note = "Site password: 2903"). Now that it's its own
      // column, pull any note already written that way into site_password
      // and clear it out of note. Only touches rows that still look like
      // that convention, so it's a no-op once it's run.
      await query(`
        UPDATE dashboards
        SET site_password = trim(substring(note from '(?i)^site password:?\\s*(.*)$')),
            note = ''
        WHERE site_password = '' AND note ~* '^site password:?\\s*\\S';
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS dashboards_sort_order_idx ON dashboards (sort_order, id);
      `);

      for (let i = 0; i < SEED_DASHBOARDS.length; i++) {
        const s = SEED_DASHBOARDS[i];
        await query(
          `INSERT INTO dashboards (seed_key, name, url, description, note, site_password, walkthrough, last_updated, next_update_due, owner, sources, checklist, sort_order, pinned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
           ON CONFLICT (seed_key) DO NOTHING`,
          [s.seedKey, s.name, s.url, s.description, s.note, s.sitePassword, s.walkthrough, s.lastUpdated, s.nextUpdateDue, s.owner, s.sources, JSON.stringify(s.checklist || []), i, Boolean(s.pinned)]
        );
      }
    })().catch((err) => {
      // Let the next call retry instead of caching a failed attempt forever
      // (e.g. a transient connection error on a cold start).
      ensureSchemaPromise = null;
      throw err;
    });
  }
  return ensureSchemaPromise;
}

function rowToDashboard(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    desc: row.description,
    note: row.note,
    sitePassword: row.site_password,
    walkthrough: row.walkthrough,
    lastUpdated: row.last_updated,
    nextUpdateDue: row.next_update_due,
    owner: row.owner,
    sources: row.sources,
    checklist: row.checklist || [],
    pinned: row.pinned,
  };
}

async function listDashboards() {
  await ensureSchema();
  // Pinned dashboards (currently just the "how to add a dashboard" guide)
  // always lead the list, regardless of sort_order, so they stay top-left
  // in the grid no matter how many other dashboards get added.
  const { rows } = await query(
    `SELECT * FROM dashboards ORDER BY pinned DESC, sort_order ASC, id ASC`
  );
  return rows.map(rowToDashboard);
}

async function createDashboard(fields) {
  await ensureSchema();
  const { rows: orderRows } = await query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM dashboards`
  );
  const nextOrder = orderRows[0].next_order;
  const { rows } = await query(
    `INSERT INTO dashboards (name, url, description, note, site_password, walkthrough, last_updated, next_update_due, owner, sources, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [fields.name, fields.url, fields.desc, fields.note, fields.sitePassword, fields.walkthrough, fields.lastUpdated, fields.nextUpdateDue, fields.owner, fields.sources, nextOrder]
  );
  return rowToDashboard(rows[0]);
}

async function updateDashboard(id, fields) {
  await ensureSchema();
  const { rows } = await query(
    `UPDATE dashboards
     SET name = $1, url = $2, description = $3, note = $4, site_password = $5, walkthrough = $6, last_updated = $7, next_update_due = $8, owner = $9, sources = $10, updated_at = now()
     WHERE id = $11
     RETURNING *`,
    [fields.name, fields.url, fields.desc, fields.note, fields.sitePassword, fields.walkthrough, fields.lastUpdated, fields.nextUpdateDue, fields.owner, fields.sources, id]
  );
  return rows[0] ? rowToDashboard(rows[0]) : null;
}

async function deleteDashboard(id) {
  await ensureSchema();
  const { rowCount } = await query(`DELETE FROM dashboards WHERE id = $1`, [id]);
  return rowCount > 0;
}

/* =========================================================================
   UPDATE CHECKLIST
   -------------------------------------------------------------------------
   A dashboard's checklist is just a JSON array on its row, not a separate
   table — there's no reporting/joining need that would justify one, and
   keeping it on the row means a single RETURNING * still hands back the
   whole dashboard after every change. Every mutation re-reads the current
   array, edits it in JS, and recomputes next_update_due from what's left
   (see computeNextUpdateDue above) before writing back.
   ========================================================================= */

async function getChecklist(id) {
  const { rows } = await query(`SELECT checklist FROM dashboards WHERE id = $1`, [id]);
  return rows[0] ? rows[0].checklist || [] : null;
}

// Writes back a dashboard's whole checklist plus the next_update_due that
// falls out of it. `justCompleted` also bumps last_updated to today — only
// checking an item off counts as "the update happened"; adding, editing,
// or deleting an item, or un-checking one, doesn't.
async function persistChecklist(id, checklist, justCompleted) {
  const nextUpdateDue = computeNextUpdateDue(checklist);
  const { rows } = justCompleted
    ? await query(
        `UPDATE dashboards
         SET checklist = $1::jsonb, next_update_due = $2, last_updated = $3, updated_at = now()
         WHERE id = $4
         RETURNING *`,
        [JSON.stringify(checklist), nextUpdateDue, formatShortDate(new Date()), id]
      )
    : await query(
        `UPDATE dashboards
         SET checklist = $1::jsonb, next_update_due = $2, updated_at = now()
         WHERE id = $3
         RETURNING *`,
        [JSON.stringify(checklist), nextUpdateDue, id]
      );
  return rows[0] ? rowToDashboard(rows[0]) : null;
}

async function addChecklistItem(id, { label, dueDate }) {
  await ensureSchema();
  const checklist = await getChecklist(id);
  if (checklist === null) return null;
  if (checklist.length >= 200) {
    throw new Error("This dashboard's checklist is full (200 items) — remove some before adding more.");
  }
  const item = { id: crypto.randomUUID(), label, dueDate, done: false, completedDate: "" };
  return persistChecklist(id, [...checklist, item]);
}

// `patch` may include any of label/dueDate/done. Checking an item that's
// already checked off (or vice versa) is a no-op on last_updated — only an
// actual done:false -> true transition counts as "the update happened".
// An unknown itemId is quietly a no-op rather than a 404: the checklist is
// still returned as-is, since there's nothing useful to do with a stale id
// besides leave everything unchanged.
async function updateChecklistItem(id, itemId, patch) {
  await ensureSchema();
  const checklist = await getChecklist(id);
  if (checklist === null) return null;
  let justCompleted = false;
  const updated = checklist.map((item) => {
    if (item.id !== itemId) return item;
    const next = { ...item };
    if (typeof patch.label === "string") next.label = patch.label;
    if (typeof patch.dueDate === "string") next.dueDate = patch.dueDate;
    if (typeof patch.done === "boolean" && patch.done !== item.done) {
      next.done = patch.done;
      next.completedDate = patch.done ? formatShortDate(new Date()) : "";
      justCompleted = patch.done;
    }
    return next;
  });
  return persistChecklist(id, updated, justCompleted);
}

async function deleteChecklistItem(id, itemId) {
  await ensureSchema();
  const checklist = await getChecklist(id);
  if (checklist === null) return null;
  return persistChecklist(id, checklist.filter((item) => item.id !== itemId));
}

module.exports = {
  listDashboards,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  DEFAULT_OWNER,
};
