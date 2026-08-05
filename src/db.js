// Postgres access for the dashboards list. Backed by the Neon database
// connected to this Vercel project (env var POSTGRES_URL / DATABASE_URL —
// whichever the Storage integration named it). One `dashboards` table is
// the single source of truth: every visitor reads and writes the same
// rows, so additions and edits are shared across the whole team instead
// of living in one browser's localStorage.

const { Pool } = require("pg");

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

// The dashboards this hub shipped with, before it had a database. Seeded
// once via a stable seed_key so re-running this on every cold start never
// creates duplicates (ON CONFLICT DO NOTHING) and never overwrites edits
// someone's since made to them.
const SEED_DASHBOARDS = [
  {
    seedKey: "quarterly-property-reports",
    name: "Quarterly Property Reports",
    description: "Quarterly performance reports across the property portfolio.",
    url: "https://triangle-property-reports.vercel.app/",
    lastUpdated: "Jul 31, 2026",
    note: "Site password: 2903",
    walkthrough: "",
  },
  {
    seedKey: "deal-pipeline",
    name: "Deal Pipeline",
    description: "Tracker for deals moving through the acquisition pipeline.",
    url: "https://triangle-deal-pipeline-tracker.vercel.app/",
    lastUpdated: "Aug 4, 2026",
    note: "",
    walkthrough: "",
  },
  {
    seedKey: "hoy-billing-tool",
    name: "Hoy Billing Tool",
    description: "Water billing tool for the Hoy property.",
    url: "https://hoy-water-tool.vercel.app/",
    lastUpdated: "Jul 31, 2026",
    note: "",
    walkthrough: "",
  },
  {
    seedKey: "harbor-freight-billing-tool",
    name: "Harbor Freight Billing Tool",
    description: "Billing tool for the Harbor Freight tenant.",
    url: "https://harbor-freight-billing-tool.vercel.app/",
    lastUpdated: "Jul 31, 2026",
    note: "",
    walkthrough: "",
  },
  {
    seedKey: "211-213-n-lewis-billing-tool",
    name: "211/213 N Lewis Billing Tool",
    description: "Water billing tracker for 211/213 N Lewis. Built by Oliver.",
    url: "https://211-213-water-tracker.vercel.app/",
    lastUpdated: "Jul 2, 2026",
    note: "",
    walkthrough: "https://www.loom.com/share/63547bf0c9954445af19ed6249d1b6d6",
  },
  {
    seedKey: "loan-database",
    name: "Loan Database",
    description: "Loan database for Triangle Investment Group.",
    url: "https://triangle-loan-database.vercel.app/",
    lastUpdated: "Jul 7, 2026",
    note: "",
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
          walkthrough TEXT NOT NULL DEFAULT '',
          last_updated TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS dashboards_sort_order_idx ON dashboards (sort_order, id);
      `);

      for (let i = 0; i < SEED_DASHBOARDS.length; i++) {
        const s = SEED_DASHBOARDS[i];
        await query(
          `INSERT INTO dashboards (seed_key, name, url, description, note, walkthrough, last_updated, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (seed_key) DO NOTHING`,
          [s.seedKey, s.name, s.url, s.description, s.note, s.walkthrough, s.lastUpdated, i]
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
    walkthrough: row.walkthrough,
    lastUpdated: row.last_updated,
  };
}

async function listDashboards() {
  await ensureSchema();
  const { rows } = await query(
    `SELECT * FROM dashboards ORDER BY sort_order ASC, id ASC`
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
    `INSERT INTO dashboards (name, url, description, note, walkthrough, last_updated, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [fields.name, fields.url, fields.desc, fields.note, fields.walkthrough, fields.lastUpdated, nextOrder]
  );
  return rowToDashboard(rows[0]);
}

async function updateDashboard(id, fields) {
  await ensureSchema();
  const { rows } = await query(
    `UPDATE dashboards
     SET name = $1, url = $2, description = $3, note = $4, walkthrough = $5, last_updated = $6, updated_at = now()
     WHERE id = $7
     RETURNING *`,
    [fields.name, fields.url, fields.desc, fields.note, fields.walkthrough, fields.lastUpdated, id]
  );
  return rows[0] ? rowToDashboard(rows[0]) : null;
}

async function deleteDashboard(id) {
  await ensureSchema();
  const { rowCount } = await query(`DELETE FROM dashboards WHERE id = $1`, [id]);
  return rowCount > 0;
}

module.exports = {
  listDashboards,
  createDashboard,
  updateDashboard,
  deleteDashboard,
};
