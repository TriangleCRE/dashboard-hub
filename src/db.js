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
  checklistItem("Aug 2026 report", "2026-09-15"),
  checklistItem("Sep 2026 report", "2026-10-15"),
  checklistItem("Oct 2026 report", "2026-11-16"),
  checklistItem("Nov 2026 report", "2026-12-15"),
  checklistItem("Dec 2026 report", "2027-01-15"),
  checklistItem("Jan 2027 report", "2027-02-15"),
  checklistItem("Feb 2027 report", "2027-03-15"),
  checklistItem("Mar 2027 report", "2027-04-15"),
  checklistItem("Apr 2027 report", "2027-05-17"),
  checklistItem("May 2027 report", "2027-06-15"),
  checklistItem("Jun 2027 report", "2027-07-15"),
  checklistItem("Jul 2027 report", "2027-08-16"),
  checklistItem("Q3 2026 (Jul–Sep) report", "2026-10-19"),
  checklistItem("Q4 2026 (Oct–Dec) report", "2027-01-27"),
  checklistItem("Q1 2027 (Jan–Mar) report", "2027-04-19"),
  checklistItem("Q2 2027 (Apr–Jun) report", "2027-07-19"),
  checklistItem("Q3 2027 (Jul–Sep) report", "2027-10-18"),
  checklistItem("FY2026 (Jan–Dec) report", "2027-02-24"),
];

// One-time checklist seed for "Utility Usage Tracker" (see the migration
// in ensureSchema below) — added directly through the Hub, so unlike the
// dashboards below there's no seed_key to match on; the migration matches
// by name instead. Unlike Property Reports, the "Utility Tracker Update
// Prompt" doc doesn't give a fixed list of future dates — it's an ongoing
// monthly pull, so this seeds the next 12 months on a monthly cadence
// rather than a doc-given list; add more from the Tracker as they come up.
// Due the 15th of the following month (the doc's own "best run after the
// ~8th–10th" guidance became the 15th instead, to line up with every
// other monthly checklist in this file).
const UTILITY_TRACKER_CHECKLIST = [
  checklistItem("Aug 2026 usage", "2026-09-15"),
  checklistItem("Sep 2026 usage", "2026-10-15"),
  checklistItem("Oct 2026 usage", "2026-11-16"),
  checklistItem("Nov 2026 usage", "2026-12-15"),
  checklistItem("Dec 2026 usage", "2027-01-15"),
  checklistItem("Jan 2027 usage", "2027-02-15"),
  checklistItem("Feb 2027 usage", "2027-03-15"),
  checklistItem("Mar 2027 usage", "2027-04-15"),
  checklistItem("Apr 2027 usage", "2027-05-17"),
  checklistItem("May 2027 usage", "2027-06-15"),
  checklistItem("Jun 2027 usage", "2027-07-15"),
  checklistItem("Jul 2027 usage", "2027-08-16"),
];

// Superseded by OLD_UTILITY_TRACKER_SOURCES_V2, then by the bracket-linked
// UTILITY_TRACKER_SOURCES below — kept only so the fix-up migrations in
// ensureSchema can find rows still holding this exact text and replace
// them, without touching a sources note anyone's written by hand since.
const OLD_UTILITY_TRACKER_SOURCES =
  "Yardi Breeze vendor ledgers — Dominion VA electric (#10456), Columbia Gas (#10380), " +
  "SVEC Coop electric (#10922). Update via Claude Code/Cowork with " +
  "Utility_Usage_Tracker.xlsx attached, Chrome logged into Yardi. Run after the " +
  "~8th–10th of the month once bills post.";

// Superseded in turn by the bracket-linked UTILITY_TRACKER_SOURCES below —
// same "kept for the fix-up migration to match against" reason as above.
const OLD_UTILITY_TRACKER_SOURCES_V2 = [
  "Yardi Breeze https://100115409.breeze.cafe/content/#/app/dashboard — images attached to invoices from:",
  "Electricity: Dominion Energy VA (#10456), Dominion Energy NC (v0000553), Harrisonburg Electric Commission (v0000813), SVEC (#10922)",
  "Natural gas: Columbia Gas of Virginia (#10380), City of Charlottesville (v0000367)",
  "Water: City of Staunton Utilities (v0001913)",
  "Combined electric+gas+water: City of Danville Utilities (v0002097)",
].join("\n");

// Links use "[label](url)" — see linkifySources() in public/tracker.html,
// which turns that into a real anchor with the label as the link text
// (falling back to linking a bare URL as-is when it isn't wrapped that way).
const UTILITY_TRACKER_SOURCES = [
  "[Yardi Breeze](https://100115409.breeze.cafe/content/#/app/dashboard) — images attached to invoices from:",
  "Electricity: Dominion Energy VA (#10456), Dominion Energy NC (v0000553), Harrisonburg Electric Commission (v0000813), SVEC (#10922)",
  "Natural gas: Columbia Gas of Virginia (#10380), City of Charlottesville (v0000367)",
  "Water: City of Staunton Utilities (v0001913)",
  "Combined electric+gas+water: City of Danville Utilities (v0002097)",
].join("\n");

// One-time checklist seed for "Property Basis Record" (see the migration
// in ensureSchema below) — added through the Hub, so matched by name like
// Utility Usage Tracker above. (Two earlier PRs guessed this dashboard's
// name as "Property Basis Tracker" — confirmed by screenshot to actually
// be "Property Basis Record", hence the labels/match below and not
// "...Tracker".) A given month's basis record is due the 15th of the
// following month (e.g. the Jul 2026 one is due Aug 15, 2026), pushed to
// the next Monday when the 15th lands on a weekend — same rule and same
// weekday shifts as Property Reports' monthly items.
const PROPERTY_BASIS_TRACKER_CHECKLIST = [
  checklistItem("Jul 2026 Basis Record", "2026-08-17"),
  checklistItem("Aug 2026 Basis Record", "2026-09-15"),
  checklistItem("Sep 2026 Basis Record", "2026-10-15"),
  checklistItem("Oct 2026 Basis Record", "2026-11-16"),
  checklistItem("Nov 2026 Basis Record", "2026-12-15"),
  checklistItem("Dec 2026 Basis Record", "2027-01-15"),
  checklistItem("Jan 2027 Basis Record", "2027-02-15"),
  checklistItem("Feb 2027 Basis Record", "2027-03-15"),
  checklistItem("Mar 2027 Basis Record", "2027-04-15"),
  checklistItem("Apr 2027 Basis Record", "2027-05-17"),
  checklistItem("May 2027 Basis Record", "2027-06-15"),
  checklistItem("Jun 2027 Basis Record", "2027-07-15"),
  checklistItem("Jul 2027 Basis Record", "2027-08-16"),
  checklistItem("Aug 2027 Basis Record", "2027-09-15"),
];

// Superseded by the bracket-linked PROPERTY_REPORTS_SOURCES below — kept
// for the fix-up migration to match against.
const OLD_PROPERTY_REPORTS_SOURCES = [
  "GIS — Staunton https://gis.vgsi.com/stauntonva/Search.aspx ; Charlottesville https://gisweb.charlottesville.org/GISViewer/ ; Harrisonburg https://gis.vgsi.com/harrisonburgva/Search.aspx ; Danville https://experience.arcgis.com/experience/31951e30986b44a1aa066c3b2f636a1f/page/Map#data_s=id%3AdataSource_9-19a5fd2bf82-layer-12%3A20662 ; Albemarle County https://gis.albemarle.org/gisviewer/#data_s=id%3AdataSource_4-19833a845ac-layer-12-19833a84680-layer-14%3A42039%2Cid%3AdataSource_4-19cb6994ab7-layer-36~dataSource_4-19cb6a26d2a-layer-37~dataSource_4-19cb6b1c343-layer-39~dataSource_4-19ce96fbfac-layer-42~dataSource_4-19cb6ead2d6-layer-102%3A50638&widget_10=active_datasource_id:dataSource_4,center:-8735076.871299999%2C4592059.696100004%2C102100,scale:4534.736842100625,rotation:0,viewpoint:%7B%22rotation%22%3A0%2C%22scale%22%3A4534.736842100625%2C%22targetGeometry%22%3A%7B%22spatialReference%22%3A%7B%22latestWkid%22%3A3857%2C%22wkid%22%3A102100%7D%2C%22x%22%3A-8735076.871299999%2C%22y%22%3A4592059.696100004%7D%7D ; Augusta https://gis.vgsi.com/augustava/Search.aspx",
  "Yardi Pull Prompt (on dashboard) https://triangle-property-reports.vercel.app/",
  "Yardi Breeze — Income Statement (Account Tree = Property Report); AR Analytics – Aging Summary; Tenancy Schedule; Property list/picker; Dashboard (portfolio-level Open AR / Vacancy) https://100115409.breeze.cafe/content/#/app/dashboard",
  "Loan Database https://triangle-loan-database.vercel.app/ (dashboard) — V1_Triangle_Loan_Database_260707.xlsx https://docs.google.com/spreadsheets/d/1m597i2XhPTuMPWaDR2k39BnevTZnvGN2/edit?usp=sharing&ouid=115725780764828123803&rtpof=true&sd=true",
  "Lease information (PDFs exported from Yardi Breeze tenant info) https://drive.google.com/drive/folders/1PtLPxWVypvKgLZVuw4q0EYoaqKQtM0ix?usp=sharing",
  "Download a completed report from the dashboard for reference when creating a new one https://triangle-property-reports.vercel.app/",
].join("\n");

const PROPERTY_REPORTS_SOURCES = [
  "GIS — [Staunton](https://gis.vgsi.com/stauntonva/Search.aspx) ; [Charlottesville](https://gisweb.charlottesville.org/GISViewer/) ; [Harrisonburg](https://gis.vgsi.com/harrisonburgva/Search.aspx) ; [Danville](https://experience.arcgis.com/experience/31951e30986b44a1aa066c3b2f636a1f/page/Map#data_s=id%3AdataSource_9-19a5fd2bf82-layer-12%3A20662) ; [Albemarle County](https://gis.albemarle.org/gisviewer/#data_s=id%3AdataSource_4-19833a845ac-layer-12-19833a84680-layer-14%3A42039%2Cid%3AdataSource_4-19cb6994ab7-layer-36~dataSource_4-19cb6a26d2a-layer-37~dataSource_4-19cb6b1c343-layer-39~dataSource_4-19ce96fbfac-layer-42~dataSource_4-19cb6ead2d6-layer-102%3A50638&widget_10=active_datasource_id:dataSource_4,center:-8735076.871299999%2C4592059.696100004%2C102100,scale:4534.736842100625,rotation:0,viewpoint:%7B%22rotation%22%3A0%2C%22scale%22%3A4534.736842100625%2C%22targetGeometry%22%3A%7B%22spatialReference%22%3A%7B%22latestWkid%22%3A3857%2C%22wkid%22%3A102100%7D%2C%22x%22%3A-8735076.871299999%2C%22y%22%3A4592059.696100004%7D%7D) ; [Augusta](https://gis.vgsi.com/augustava/Search.aspx)",
  "[Yardi Pull Prompt](https://triangle-property-reports.vercel.app/) (on dashboard)",
  "[Yardi Breeze](https://100115409.breeze.cafe/content/#/app/dashboard) — Income Statement (Account Tree = Property Report); AR Analytics – Aging Summary; Tenancy Schedule; Property list/picker; Dashboard (portfolio-level Open AR / Vacancy)",
  "[Loan Database](https://triangle-loan-database.vercel.app/) (dashboard) — [V1_Triangle_Loan_Database_260707.xlsx](https://docs.google.com/spreadsheets/d/1m597i2XhPTuMPWaDR2k39BnevTZnvGN2/edit?usp=sharing&ouid=115725780764828123803&rtpof=true&sd=true)",
  "[Lease information](https://drive.google.com/drive/folders/1PtLPxWVypvKgLZVuw4q0EYoaqKQtM0ix?usp=sharing) (PDFs exported from Yardi Breeze tenant info)",
  "[Download a completed report](https://triangle-property-reports.vercel.app/) from the dashboard for reference when creating a new one",
].join("\n");

// One-time checklist + sources seed for "CAM, Taxes, & Insurance" — added
// through the Hub, matched by name like the others above. (An earlier PR
// guessed this dashboard's name as "CAM Insurance Taxes Tracker" —
// confirmed by screenshot to actually be "CAM, Taxes, & Insurance", hence
// the label/match below.) Only one item so far: the 2026 update, due the
// same date (Feb 24, 2027) as Property Reports' FY2026 annual report —
// add the 2027 item and beyond from the Tracker once its own due date is
// known.
const CAM_TRACKER_CHECKLIST = [
  checklistItem("2026 CAM, Taxes, & Insurance tracker", "2027-02-24"),
];

// Superseded by the bracket-linked CAM_TRACKER_SOURCES below — kept for
// the fix-up migration to match against.
const OLD_CAM_TRACKER_SOURCES = [
  "Template/structure: CAM_per_SF_Example.xlsx https://docs.google.com/spreadsheets/d/135TaNpidcR-kiefz1Damp43PpfSUPO7s/edit?usp=sharing&ouid=115725780764828123803&rtpof=true&sd=true",
  "Yardi Breeze https://100115409.breeze.cafe/content/#/app/dashboard — \"Annual Statement\" report (Book = Cash); \"Property Directory\" report",
].join("\n");

const CAM_TRACKER_SOURCES = [
  "Template/structure: [CAM_per_SF_Example.xlsx](https://docs.google.com/spreadsheets/d/135TaNpidcR-kiefz1Damp43PpfSUPO7s/edit?usp=sharing&ouid=115725780764828123803&rtpof=true&sd=true)",
  "[Yardi Breeze](https://100115409.breeze.cafe/content/#/app/dashboard) — \"Annual Statement\" report (Book = Cash); \"Property Directory\" report",
].join("\n");

const DEAL_PIPELINE_SOURCES = [
  "GIS — [Staunton](https://gis.vgsi.com/stauntonva/Search.aspx) ; [Charlottesville](https://gisweb.charlottesville.org/GISViewer/) ; [Harrisonburg](https://gis.vgsi.com/harrisonburgva/Search.aspx) ; [Danville](https://experience.arcgis.com/experience/31951e30986b44a1aa066c3b2f636a1f/page/Map#data_s=id%3AdataSource_9-19a5fd2bf82-layer-12%3A20662) ; [Albemarle County](https://gis.albemarle.org/gisviewer/#data_s=id%3AdataSource_4-19833a845ac-layer-12-19833a84680-layer-14%3A42039%2Cid%3AdataSource_4-19cb6994ab7-layer-36~dataSource_4-19cb6a26d2a-layer-37~dataSource_4-19cb6b1c343-layer-39~dataSource_4-19ce96fbfac-layer-42~dataSource_4-19cb6ead2d6-layer-102%3A50638&widget_10=active_datasource_id:dataSource_4,center:-8735076.871299999%2C4592059.696100004%2C102100,scale:4534.736842100625,rotation:0,viewpoint:%7B%22rotation%22%3A0%2C%22scale%22%3A4534.736842100625%2C%22targetGeometry%22%3A%7B%22spatialReference%22%3A%7B%22latestWkid%22%3A3857%2C%22wkid%22%3A102100%7D%2C%22x%22%3A-8735076.871299999%2C%22y%22%3A4592059.696100004%7D%7D) ; [Augusta](https://gis.vgsi.com/augustava/Search.aspx)",
  "Base Financial Model: [Financing_Model_v7_Base_6968_Seminole_260731.xlsx](https://docs.google.com/spreadsheets/d/128uLim1FlabbCQWVT2Z_9SJjUdn6oQ5o/edit?gid=1957072128#gid=1957072128)",
  "[Development Scoring Sheet_Weighted.xlsx](https://docs.google.com/spreadsheets/d/1D2WGVghswwvyqmYr95IB15sMfMVyBgRo/edit?usp=sharing&ouid=115725780764828123803&rtpof=true&sd=true)",
  "[Triangle Developments_Opportunities Lists](https://docs.google.com/spreadsheets/d/1T5NM7vDkwPZQSAF4auMaCFSprn1Pg-BbkbB6w9XoiLg/edit?usp=sharing)",
].join("\n");

const LOAN_DATABASE_SOURCES = [
  "[Loan Analysis_251001.xls](https://docs.google.com/spreadsheets/d/1WHC0LCYZ-TEodNZFGSnLBIo5cZ_SnP38/edit?usp=sharing&ouid=115725780764828123803&rtpof=true&sd=true)",
  "[Loan Master Spreadsheet.xlsx](https://docs.google.com/spreadsheets/d/1IuK40UXjbiwfrJDwaGhBDrdM4uAztYzY/edit?usp=sharing&ouid=115725780764828123803&rtpof=true&sd=true)",
  "[V1_Triangle_Loan_Database_260707.xlsx](https://docs.google.com/spreadsheets/d/1m597i2XhPTuMPWaDR2k39BnevTZnvGN2/edit?usp=sharing&ouid=115725780764828123803&rtpof=true&sd=true)",
  "[Loan Documents folder](https://drive.google.com/drive/folders/1pGPaJ8q-qMXJfu_R2xMnVYNcr55RDNPZ?usp=sharing)",
].join("\n");

// Bimonthly billing cycle for Hoy Billing Tool and 211/213 N Lewis Billing
// Tool — both on the exact same cadence (a bill covering a 2-month period
// gets updated on the 1st of the month after that period ends). Neither
// of these dates need a weekend-shift rule; they're given as fixed dates,
// not derived.
function bimonthlyBillingChecklist(){
  return [
    checklistItem("May '26 – Jul '26 bill", "2026-08-01"),
    checklistItem("Jul '26 – Sep '26 bill", "2026-10-01"),
    checklistItem("Sep '26 – Nov '26 bill", "2026-12-01"),
    checklistItem("Nov '26 – Jan '27 bill", "2027-02-01"),
    checklistItem("Jan '27 – Mar '27 bill", "2027-04-01"),
    checklistItem("Mar '27 – May '27 bill", "2027-06-01"),
    checklistItem("May '27 – Jul '27 bill", "2027-08-01"),
  ];
}
const HOY_BILLING_CHECKLIST = bimonthlyBillingChecklist();
const N_LEWIS_BILLING_CHECKLIST = bimonthlyBillingChecklist();

// Monthly billing cycle for Harbor Freight Billing Tool — a bill covering
// one month gets updated on the 1st of the following month.
const HARBOR_FREIGHT_BILLING_CHECKLIST = [
  checklistItem("May '26 – Jun '26 bill", "2026-07-01"),
  checklistItem("Jun '26 – Jul '26 bill", "2026-08-01"),
  checklistItem("Jul '26 – Aug '26 bill", "2026-09-01"),
  checklistItem("Aug '26 – Sep '26 bill", "2026-10-01"),
  checklistItem("Sep '26 – Oct '26 bill", "2026-11-01"),
  checklistItem("Oct '26 – Nov '26 bill", "2026-12-01"),
  checklistItem("Nov '26 – Dec '26 bill", "2027-01-01"),
  checklistItem("Dec '26 – Jan '27 bill", "2027-02-01"),
  checklistItem("Jan '27 – Feb '27 bill", "2027-03-01"),
  checklistItem("Feb '27 – Mar '27 bill", "2027-04-01"),
  checklistItem("Mar '27 – Apr '27 bill", "2027-05-01"),
  checklistItem("Apr '27 – May '27 bill", "2027-06-01"),
  checklistItem("May '27 – Jun '27 bill", "2027-07-01"),
  checklistItem("Jun '27 – Jul '27 bill", "2027-08-01"),
];

const N_LEWIS_BILLING_SOURCES = [
  "Bill Invoices — log into 211 and 213 N Lewis St on [City of Staunton Utility Billing](https://services.ci.staunton.va.us/mss/citizens/UtilityBilling/Default.aspx). See the dashboard's \"Step-by-step guide\" to log in, or watch the walkthrough video.",
  "Submeter Usage Report (CSV) — [Next Century Meters](https://app.nextcenturymeters.com/login)",
].join("\n");

const HOY_BILLING_SOURCES = [
  "Bill Invoices — [Yardi Breeze](https://100115409.breeze.cafe/content/#/app/dashboard), images attached to invoices for City of Staunton Utilities (vendor #v0001913), OR log into [City of Staunton Utility Billing](https://services.ci.staunton.va.us/mss/citizens/UtilityBilling/Default.aspx)",
  "Water meter readings from [Prism](https://connect.buildingengines.com/)",
].join("\n");

const HARBOR_FREIGHT_BILLING_SOURCES = [
  "Bill Invoices (source TBD)",
  "Meter Readings (source TBD)",
].join("\n");

// Property Basis Record was added through the Hub (see the checklist
// migration further down) — no checklist-seeding Sources constant existed
// for it yet, so this is a plain addition rather than a rewrite of an
// earlier value.
const PROPERTY_BASIS_RECORD_SOURCES = [
  "Monthly Balance Sheet — [Yardi Breeze](https://100115409.breeze.cafe/content/#/app/dashboard)",
  "[V2_Property_Basis_Tracker_May_2026.xlsx](https://docs.google.com/spreadsheets/d/1EQEqtbrKFnqpw_l0ZD2j_j0dVmWwBT1T/edit?usp=sharing&ouid=115725780764828123803&rtpof=true&sd=true)",
].join("\n");

// "How to update this dashboard" copy for the Tracker's Instructions
// column (public/tracker.html) — same shape as the *_SOURCES constants
// above, but describing the actual update workflow rather than where the
// underlying data comes from. Most dashboards share one of two workflows
// almost word-for-word, so those shared sentences are their own constants
// rather than being retyped (and risking drifting out of sync) on every
// dashboard that uses them.
const ANYONE_CAN_UPDATE = "Anyone on the team can make this update.";
const SARAH_ONLY_YARDI_PULL_INSTRUCTIONS =
  "Only Sarah can make this update. Run the \"Yardi Pull Prompt\" feature on the dashboard, " +
  "then paste Claude's response into the Claude Code session connected to this dashboard to commit it.";
const SARAH_ONLY_CLAUDE_CODE_INSTRUCTIONS =
  "Only Sarah can make updates, through Claude Code commands as needed.";

const HARBOR_FREIGHT_BILLING_INSTRUCTIONS =
  `Use the "Import a bill & reading with AI" feature on the dashboard to add each new bill and meter reading. ${ANYONE_CAN_UPDATE}`;
// Hoy uses the exact same feature, on the exact same kind of dashboard.
const HOY_BILLING_INSTRUCTIONS = HARBOR_FREIGHT_BILLING_INSTRUCTIONS;
const N_LEWIS_BILLING_INSTRUCTIONS =
  `Follow the first three steps on the dashboard to enter the bill invoice and meter readings. ${ANYONE_CAN_UPDATE}`;
const PROPERTY_BASIS_RECORD_INSTRUCTIONS =
  `Use the "Add Period with Claude" feature on the dashboard to add each new period. ${ANYONE_CAN_UPDATE}`;
const DEAL_PIPELINE_INSTRUCTIONS =
  `Use the "Add Property" feature on the dashboard to add a new deal. ${ANYONE_CAN_UPDATE}`;
const PROPERTY_REPORTS_INSTRUCTIONS = SARAH_ONLY_YARDI_PULL_INSTRUCTIONS;
const UTILITY_TRACKER_INSTRUCTIONS = SARAH_ONLY_YARDI_PULL_INSTRUCTIONS;
const CAM_TRACKER_INSTRUCTIONS = SARAH_ONLY_YARDI_PULL_INSTRUCTIONS;
const HOW_TO_CREATE_DASHBOARD_INSTRUCTIONS = SARAH_ONLY_CLAUDE_CODE_INSTRUCTIONS;
const LOAN_DATABASE_INSTRUCTIONS = SARAH_ONLY_CLAUDE_CODE_INSTRUCTIONS;
const PROPERTY_PORTFOLIO_INSTRUCTIONS = SARAH_ONLY_CLAUDE_CODE_INSTRUCTIONS;

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
    instructions: HOW_TO_CREATE_DASHBOARD_INSTRUCTIONS,
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
    sources: PROPERTY_REPORTS_SOURCES,
    instructions: PROPERTY_REPORTS_INSTRUCTIONS,
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
    sources: DEAL_PIPELINE_SOURCES,
    instructions: DEAL_PIPELINE_INSTRUCTIONS,
    walkthrough: "",
  },
  {
    seedKey: "hoy-billing-tool",
    name: "Hoy Billing Tool",
    description: "Water billing tool for the Hoy property.",
    url: "https://hoy-water-tool.vercel.app/",
    lastUpdated: "Jul 31, 2026",
    nextUpdateDue: computeNextUpdateDue(HOY_BILLING_CHECKLIST),
    owner: DEFAULT_OWNER,
    note: "",
    sitePassword: "",
    sources: HOY_BILLING_SOURCES,
    instructions: HOY_BILLING_INSTRUCTIONS,
    walkthrough: "",
    checklist: HOY_BILLING_CHECKLIST,
  },
  {
    seedKey: "harbor-freight-billing-tool",
    name: "Harbor Freight Billing Tool",
    description: "Billing tool for the Harbor Freight tenant.",
    url: "https://harbor-freight-billing-tool.vercel.app/",
    lastUpdated: "Jul 31, 2026",
    nextUpdateDue: computeNextUpdateDue(HARBOR_FREIGHT_BILLING_CHECKLIST),
    owner: DEFAULT_OWNER,
    note: "",
    sitePassword: "",
    sources: HARBOR_FREIGHT_BILLING_SOURCES,
    instructions: HARBOR_FREIGHT_BILLING_INSTRUCTIONS,
    walkthrough: "",
    checklist: HARBOR_FREIGHT_BILLING_CHECKLIST,
  },
  {
    seedKey: "211-213-n-lewis-billing-tool",
    name: "211/213 N Lewis Billing Tool",
    description: "Water billing tracker for 211/213 N Lewis. Built by Oliver.",
    url: "https://211-213-water-tracker.vercel.app/",
    lastUpdated: "Jul 2, 2026",
    nextUpdateDue: computeNextUpdateDue(N_LEWIS_BILLING_CHECKLIST),
    owner: "Oliver Dahl",
    note: "",
    sitePassword: "",
    sources: N_LEWIS_BILLING_SOURCES,
    instructions: N_LEWIS_BILLING_INSTRUCTIONS,
    walkthrough: "https://www.loom.com/share/63547bf0c9954445af19ed6249d1b6d6",
    checklist: N_LEWIS_BILLING_CHECKLIST,
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
    sources: LOAN_DATABASE_SOURCES,
    instructions: LOAN_DATABASE_INSTRUCTIONS,
    walkthrough: "",
  },
];

// One-time, narrowly-targeted fix for rows that already ran the old
// Utility Usage Tracker checklist seed (see the migration in ensureSchema
// that calls this). Rewrites the label and due date of any item matching
// BOTH the old label suffix and an old "-10" due date at once — that pair
// only ever came from this migration's own earlier seed, so nothing else
// can accidentally match it. A no-op once every matching row has been
// corrected, since there's nothing left for it to find.
const OLD_UTILITY_LABEL_SUFFIX = " — Dominion VA electric, Columbia Gas, SVEC electric";

// Maps each old "-10" due date to the correct new one, derived from
// UTILITY_TRACKER_CHECKLIST itself (year/month always matches — shifting
// the 15th to the next Monday never crosses a month boundary) rather than
// just swapping the day, since a few of the new dates are the 16th/17th,
// not a flat 15th, once the weekend shift applies.
const OLD_TO_NEW_UTILITY_DUE_DATE = new Map(
  UTILITY_TRACKER_CHECKLIST.map((item) => {
    const [year, month] = item.dueDate.split("-");
    return [`${year}-${month}-10`, item.dueDate];
  })
);

async function migrateUtilityTrackerChecklistFormat() {
  const { rows } = await query(
    `SELECT id, checklist FROM dashboards WHERE name = 'Utility Usage Tracker'`
  );
  for (const row of rows) {
    const checklist = row.checklist || [];
    let changed = false;
    const updated = checklist.map((item) => {
      const newDueDate = OLD_TO_NEW_UTILITY_DUE_DATE.get(item.dueDate);
      if (!item.label.endsWith(OLD_UTILITY_LABEL_SUFFIX) || !newDueDate) return item;
      changed = true;
      return {
        ...item,
        label: item.label.slice(0, -OLD_UTILITY_LABEL_SUFFIX.length),
        dueDate: newDueDate,
      };
    });
    if (changed) {
      await query(
        `UPDATE dashboards SET checklist = $1::jsonb, next_update_due = $2, updated_at = now() WHERE id = $3`,
        [JSON.stringify(updated), computeNextUpdateDue(updated), row.id]
      );
    }
  }
}

// Every checklist item above used to read "Create/update the X" / "Update
// the X" / "Update X" — the verb was redundant, since checking an item off
// only ever means "I created/updated X" in the first place. Requested
// directly: just list X itself (e.g. "May '26 – Jul '26 bill"), across
// every dashboard's checklist, not only the ones seeded above (a
// hand-added item on some other dashboard could happen to start with one
// of these same words too, and stripping it there is just as correct).
// Checked longest-prefix-first so "Update the X" doesn't get only its
// "Update " shaved off, leaving a stray "the X".
const CHECKLIST_LABEL_PREFIXES = ["Create/update the ", "Update the ", "Update "];

function stripChecklistLabelPrefix(label) {
  const prefix = CHECKLIST_LABEL_PREFIXES.find((p) => label.startsWith(p));
  return prefix ? label.slice(prefix.length) : label;
}

// Runs across every dashboard, not just ones matched by seed_key/name —
// there's no "which dashboards have this old format" list to key off here,
// unlike the more targeted migrations above. Guarded per-item on the label
// actually starting with one of the prefixes, so a hand-typed item that
// never had one (or a row already migrated) is left untouched, and this
// is a no-op the next time it runs.
async function migrateChecklistLabelPrefixes() {
  const { rows } = await query(`SELECT id, checklist FROM dashboards WHERE checklist != '[]'::jsonb`);
  for (const row of rows) {
    const checklist = row.checklist || [];
    let changed = false;
    const updated = checklist.map((item) => {
      const newLabel = stripChecklistLabelPrefix(item.label);
      if (newLabel === item.label) return item;
      changed = true;
      return { ...item, label: newLabel };
    });
    if (changed) {
      await query(
        `UPDATE dashboards SET checklist = $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify(updated), row.id]
      );
    }
  }
}

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
      // The Tracker's Instructions column: how to actually perform an
      // update on this dashboard (which feature to use on it, and who's
      // allowed to). Same shape and same "add if missing" pattern as
      // sources above.
      await query(`
        ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS instructions TEXT NOT NULL DEFAULT '';
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
      // The migrations below only matter for a database that was seeded
      // before these values existed (a production deploy that already has
      // these 7 rows under their old defaults) — a genuinely fresh install
      // gets all of this straight from SEED_DASHBOARDS below instead, so
      // these are no-ops there. Each is guarded on the column still
      // holding whatever the old default was, so none of them ever
      // overwrite a reassignment made since (from here, or from the
      // Tracker).

      // Every seed_key-keyed migration below depends on that row's
      // seed_key actually being set — which turned out not to be true for
      // Hoy Billing Tool despite it being in SEED_DASHBOARDS from the
      // start (most likely that row predates the seed_key column, or was
      // re-added by hand at some point). Backfill it by name first, for
      // every dashboard that has a seed_key, one row at a time (LIMIT 1
      // via the subquery, so this can never try to stamp the same
      // seed_key onto two rows and trip the column's UNIQUE constraint
      // even if a genuine duplicate exists) — this also keeps the seed
      // loop further down (which relies on ON CONFLICT (seed_key) to
      // avoid re-inserting) from creating a duplicate row on this same
      // cold start.
      async function backfillSeedKeyByName(seedKey, name) {
        await query(
          `UPDATE dashboards SET seed_key = $1
           WHERE seed_key IS NULL AND id = (
             SELECT id FROM dashboards WHERE seed_key IS NULL AND name = $2 ORDER BY id LIMIT 1
           )`,
          [seedKey, name]
        );
      }
      for (const s of SEED_DASHBOARDS) {
        await backfillSeedKeyByName(s.seedKey, s.name);
      }

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
      // Triangle Property Portfolio, same "as needed" cadence as the three
      // above, but added through the Hub rather than seeded — no seed_key
      // to match on, so this one keys off name instead (same pattern as
      // the Utility Usage Tracker migration below). Matches both the name
      // it's actually under and the shorter guess an earlier migration
      // used, in case that one's still floating around unmatched.
      await query(`
        UPDATE dashboards SET next_update_due = 'As needed'
        WHERE name IN ('Triangle Property Portfolio', 'Property Portfolio') AND next_update_due = '';
      `);
      // The monthly/quarterly/annual pull schedule for Quarterly Property
      // Reports (see PROPERTY_REPORTS_CHECKLIST above).
      await query(
        `UPDATE dashboards SET checklist = $1::jsonb, next_update_due = $2
         WHERE seed_key = 'quarterly-property-reports' AND checklist = '[]'::jsonb`,
        [JSON.stringify(PROPERTY_REPORTS_CHECKLIST), computeNextUpdateDue(PROPERTY_REPORTS_CHECKLIST)]
      );
      // Sources for Quarterly Property Reports (see PROPERTY_REPORTS_SOURCES
      // above) — separate from the checklist migration above so it still
      // fills in even on a row that already has a checklist (e.g. one
      // where items have since been checked off), guarded independently on
      // sources still being blank.
      await query(
        `UPDATE dashboards SET sources = $1
         WHERE seed_key = 'quarterly-property-reports' AND sources = ''`,
        [PROPERTY_REPORTS_SOURCES]
      );
      // A production row that already got the plain-text version of these
      // Sources (from the migration above, back before it was rewritten
      // with "[label](url)" links — see linkifySources() in
      // public/tracker.html) won't pick up the new version from that same
      // migration a second time, since Sources isn't blank there anymore.
      // Replace only an exact match on the old text.
      await query(
        `UPDATE dashboards SET sources = $1
         WHERE seed_key = 'quarterly-property-reports' AND sources = $2`,
        [PROPERTY_REPORTS_SOURCES, OLD_PROPERTY_REPORTS_SOURCES]
      );
      // Sources for Deal Pipeline and Loan Database (see
      // DEAL_PIPELINE_SOURCES / LOAN_DATABASE_SOURCES above) — both have
      // been in SEED_DASHBOARDS since the start with blank Sources, so
      // this is a plain "fill in if still blank" like Property Reports'.
      await query(
        `UPDATE dashboards SET sources = $1 WHERE seed_key = 'deal-pipeline' AND sources = ''`,
        [DEAL_PIPELINE_SOURCES]
      );
      await query(
        `UPDATE dashboards SET sources = $1 WHERE seed_key = 'loan-database' AND sources = ''`,
        [LOAN_DATABASE_SOURCES]
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
      // A production database that already ran the migration above before
      // UTILITY_TRACKER_CHECKLIST was revised (dropping the vendor list
      // from each label, moving every due date from the 10th to the 15th)
      // has those original items sitting in its checklist column already,
      // so the checklist-still-empty guard above won't touch them. Fix
      // those specific items in place instead of reseeding: only items
      // that still have both the old label suffix AND a "-10" due date —
      // i.e. exactly the ones this migration itself created — get
      // corrected, so a real "due the 10th" item added later some other
      // way is never touched.
      await migrateUtilityTrackerChecklistFormat();
      // Same idea for Sources: a production row that already got the old,
      // short blurb (from the migration above, back when its checklist was
      // still empty) won't pick up the fuller UTILITY_TRACKER_SOURCES from
      // that same migration a second time. Replace only an exact match on
      // the old text, so a sources note written by hand since is untouched.
      await query(
        `UPDATE dashboards SET sources = $1
         WHERE name = 'Utility Usage Tracker' AND sources = $2`,
        [UTILITY_TRACKER_SOURCES, OLD_UTILITY_TRACKER_SOURCES]
      );
      // ...and again for OLD_UTILITY_TRACKER_SOURCES_V2 — the plain-text
      // version these Sources were rewritten from into "[label](url)"
      // links, same reasoning as the Property Reports fix-up above.
      await query(
        `UPDATE dashboards SET sources = $1
         WHERE name = 'Utility Usage Tracker' AND sources = $2`,
        [UTILITY_TRACKER_SOURCES, OLD_UTILITY_TRACKER_SOURCES_V2]
      );
      // The monthly pull schedule for Property Basis Record (see
      // PROPERTY_BASIS_TRACKER_CHECKLIST above) — same "match by name,
      // seed once" pattern as Utility Usage Tracker. Two earlier guesses
      // at this dashboard's name ("Property Basis Tracker", then a looser
      // "%Basis Tracker%") both missed — a screenshot confirmed the real
      // name is "Property Basis Record", with no "Tracker" in it at all.
      // Matching both the confirmed name and the old guesses costs
      // nothing (the guesses just never match anything) and means a
      // revert back to an old name wouldn't silently break this again.
      await query(
        `UPDATE dashboards SET checklist = $1::jsonb, next_update_due = $2
         WHERE name IN ('Property Basis Record', 'Property Basis Tracker', 'Triangle Property Basis Tracker')
           AND checklist = '[]'::jsonb`,
        [JSON.stringify(PROPERTY_BASIS_TRACKER_CHECKLIST), computeNextUpdateDue(PROPERTY_BASIS_TRACKER_CHECKLIST)]
      );
      // Sources for Property Basis Record (see PROPERTY_BASIS_RECORD_SOURCES
      // above) — separate migration from the checklist one, guarded
      // independently on Sources still being blank, same reasoning as the
      // Quarterly Property Reports Sources migration further up.
      await query(
        `UPDATE dashboards SET sources = $1
         WHERE name IN ('Property Basis Record', 'Property Basis Tracker', 'Triangle Property Basis Tracker')
           AND sources = ''`,
        [PROPERTY_BASIS_RECORD_SOURCES]
      );
      // Billing-cycle checklists for the three billing tools (seed_key is
      // now backfilled for all of them up top, so these can just match on
      // it directly).
      await query(
        `UPDATE dashboards SET checklist = $1::jsonb, next_update_due = $2
         WHERE seed_key = 'hoy-billing-tool' AND checklist = '[]'::jsonb`,
        [JSON.stringify(HOY_BILLING_CHECKLIST), computeNextUpdateDue(HOY_BILLING_CHECKLIST)]
      );
      await query(
        `UPDATE dashboards SET sources = $1 WHERE seed_key = 'hoy-billing-tool' AND sources = ''`,
        [HOY_BILLING_SOURCES]
      );
      await query(
        `UPDATE dashboards SET checklist = $1::jsonb, next_update_due = $2
         WHERE seed_key = 'harbor-freight-billing-tool' AND checklist = '[]'::jsonb`,
        [JSON.stringify(HARBOR_FREIGHT_BILLING_CHECKLIST), computeNextUpdateDue(HARBOR_FREIGHT_BILLING_CHECKLIST)]
      );
      await query(
        `UPDATE dashboards SET sources = $1 WHERE seed_key = 'harbor-freight-billing-tool' AND sources = ''`,
        [HARBOR_FREIGHT_BILLING_SOURCES]
      );
      await query(
        `UPDATE dashboards SET checklist = $1::jsonb, next_update_due = $2
         WHERE seed_key = '211-213-n-lewis-billing-tool' AND checklist = '[]'::jsonb`,
        [JSON.stringify(N_LEWIS_BILLING_CHECKLIST), computeNextUpdateDue(N_LEWIS_BILLING_CHECKLIST)]
      );
      await query(
        `UPDATE dashboards SET sources = $1 WHERE seed_key = '211-213-n-lewis-billing-tool' AND sources = ''`,
        [N_LEWIS_BILLING_SOURCES]
      );
      // The 2026 checklist item (and Sources) for CAM, Taxes, & Insurance
      // — same "match by name, seed once" pattern. Same story as Property
      // Basis Record above: two earlier guesses ("CAM Insurance Taxes
      // Tracker", then an ILIKE pattern assuming "Tracker" was in the
      // name) both missed — the real name is "CAM, Taxes, & Insurance".
      await query(
        `UPDATE dashboards
         SET checklist = $1::jsonb,
             next_update_due = $2,
             sources = CASE WHEN sources = '' THEN $3 ELSE sources END
         WHERE name IN ('CAM, Taxes, & Insurance', 'CAM Insurance Taxes Tracker', 'CAM Insurance Tax Tracker')
           AND checklist = '[]'::jsonb`,
        [JSON.stringify(CAM_TRACKER_CHECKLIST), computeNextUpdateDue(CAM_TRACKER_CHECKLIST), CAM_TRACKER_SOURCES]
      );
      // A production row that already got the plain-text version of these
      // Sources (from the migration above, before the "[label](url)"
      // rewrite) won't pick it up a second time now that Sources isn't
      // blank there anymore — same fix-up pattern as the others above.
      await query(
        `UPDATE dashboards SET sources = $1
         WHERE name IN ('CAM, Taxes, & Insurance', 'CAM Insurance Taxes Tracker', 'CAM Insurance Tax Tracker')
           AND sources = $2`,
        [CAM_TRACKER_SOURCES, OLD_CAM_TRACKER_SOURCES]
      );
      // One-time Instructions backfill (see the *_INSTRUCTIONS constants
      // above) for every dashboard, guarded independently on Instructions
      // still being blank so a note written by hand since is never
      // overwritten. The seed_key-keyed dashboards can match on seed_key
      // directly (it's backfilled for all of them up top); the ones added
      // through the Hub match by name, same variants as their
      // checklist/sources migrations above.
      await query(`UPDATE dashboards SET instructions = $1 WHERE seed_key = 'how-to-create-a-claude-dashboard' AND instructions = ''`, [HOW_TO_CREATE_DASHBOARD_INSTRUCTIONS]);
      await query(`UPDATE dashboards SET instructions = $1 WHERE seed_key = 'quarterly-property-reports' AND instructions = ''`, [PROPERTY_REPORTS_INSTRUCTIONS]);
      await query(`UPDATE dashboards SET instructions = $1 WHERE seed_key = 'deal-pipeline' AND instructions = ''`, [DEAL_PIPELINE_INSTRUCTIONS]);
      await query(`UPDATE dashboards SET instructions = $1 WHERE seed_key = 'hoy-billing-tool' AND instructions = ''`, [HOY_BILLING_INSTRUCTIONS]);
      await query(`UPDATE dashboards SET instructions = $1 WHERE seed_key = 'harbor-freight-billing-tool' AND instructions = ''`, [HARBOR_FREIGHT_BILLING_INSTRUCTIONS]);
      await query(`UPDATE dashboards SET instructions = $1 WHERE seed_key = '211-213-n-lewis-billing-tool' AND instructions = ''`, [N_LEWIS_BILLING_INSTRUCTIONS]);
      await query(`UPDATE dashboards SET instructions = $1 WHERE seed_key = 'loan-database' AND instructions = ''`, [LOAN_DATABASE_INSTRUCTIONS]);
      await query(
        `UPDATE dashboards SET instructions = $1
         WHERE name IN ('Property Basis Record', 'Property Basis Tracker', 'Triangle Property Basis Tracker')
           AND instructions = ''`,
        [PROPERTY_BASIS_RECORD_INSTRUCTIONS]
      );
      await query(
        `UPDATE dashboards SET instructions = $1 WHERE name = 'Utility Usage Tracker' AND instructions = ''`,
        [UTILITY_TRACKER_INSTRUCTIONS]
      );
      await query(
        `UPDATE dashboards SET instructions = $1
         WHERE name IN ('CAM, Taxes, & Insurance', 'CAM Insurance Taxes Tracker', 'CAM Insurance Tax Tracker')
           AND instructions = ''`,
        [CAM_TRACKER_INSTRUCTIONS]
      );
      await query(
        `UPDATE dashboards SET instructions = $1
         WHERE name IN ('Triangle Property Portfolio', 'Property Portfolio') AND instructions = ''`,
        [PROPERTY_PORTFOLIO_INSTRUCTIONS]
      );
      // Strips the redundant "Create/update the "/"Update the "/"Update "
      // verb phrase off every checklist item's label (see
      // CHECKLIST_LABEL_PREFIXES above) — runs last, after every other
      // checklist migration above has had a chance to seed/fix labels, so
      // it's cleaning up whatever the final label text actually is rather
      // than racing any of them.
      await migrateChecklistLabelPrefixes();
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
          `INSERT INTO dashboards (seed_key, name, url, description, note, site_password, walkthrough, last_updated, next_update_due, owner, sources, instructions, checklist, sort_order, pinned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
           ON CONFLICT (seed_key) DO NOTHING`,
          [s.seedKey, s.name, s.url, s.description, s.note, s.sitePassword, s.walkthrough, s.lastUpdated, s.nextUpdateDue, s.owner, s.sources, s.instructions || "", JSON.stringify(s.checklist || []), i, Boolean(s.pinned)]
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
    instructions: row.instructions,
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
    `INSERT INTO dashboards (name, url, description, note, site_password, walkthrough, last_updated, next_update_due, owner, sources, instructions, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [fields.name, fields.url, fields.desc, fields.note, fields.sitePassword, fields.walkthrough, fields.lastUpdated, fields.nextUpdateDue, fields.owner, fields.sources, fields.instructions, nextOrder]
  );
  return rowToDashboard(rows[0]);
}

async function updateDashboard(id, fields) {
  await ensureSchema();
  const { rows } = await query(
    `UPDATE dashboards
     SET name = $1, url = $2, description = $3, note = $4, site_password = $5, walkthrough = $6, last_updated = $7, next_update_due = $8, owner = $9, sources = $10, instructions = $11, updated_at = now()
     WHERE id = $12
     RETURNING *`,
    [fields.name, fields.url, fields.desc, fields.note, fields.sitePassword, fields.walkthrough, fields.lastUpdated, fields.nextUpdateDue, fields.owner, fields.sources, fields.instructions, id]
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
