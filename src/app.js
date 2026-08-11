// The whole site — static dashboard page, login, and (any future) API
// routes — is served through this one Express app so the passcode gate can
// run in front of literally everything. See vercel.json: every request is
// routed to this same app as a single serverless function, rather than
// letting Vercel serve static files separately from functions (which would
// make "every route is gated" impossible to guarantee).

const express = require("express");
const {
  COOKIE_NAME,
  checkPasscode,
  makeSessionCookieValue,
  isValidSessionCookie,
} = require("./auth");
const { parseCookies, buildSessionSetCookie } = require("./cookies");
const { renderLoginPage } = require("./loginPage");
const { ROBOTS_TXT } = require("./robotsTxt");
const dashboards = require("./db");

// Paths reachable with no session at all.
const LOGIN_PATH = "/login";
const ROBOTS_PATH = "/robots.txt";

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (e) {
    return false;
  }
}

// Validates/normalizes a dashboard add/edit request body. Mirrors the
// client-side checks in public/shared.js (the Add/Edit modal shared by
// index.html and tracker.html) — this is the version that actually
// matters, since the client can't be trusted.
function parseDashboardBody(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const desc = typeof body.desc === "string" ? body.desc.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const sitePassword = typeof body.sitePassword === "string" ? body.sitePassword.trim() : "";
  const walkthrough = typeof body.walkthrough === "string" ? body.walkthrough.trim() : "";
  const lastUpdated = typeof body.lastUpdated === "string" ? body.lastUpdated.trim() : "";
  const nextUpdateDue = typeof body.nextUpdateDue === "string" ? body.nextUpdateDue.trim() : "";
  const sources = typeof body.sources === "string" ? body.sources.trim() : "";
  // Every dashboard is owned by exactly one person for now (see
  // db.DEFAULT_OWNER) — an empty owner falls back to that rather than
  // being stored blank, so the Tracker's Owner column is never empty for
  // a dashboard nobody explicitly reassigned.
  const owner = (typeof body.owner === "string" ? body.owner.trim() : "") || dashboards.DEFAULT_OWNER;

  if (!name || !url) return { error: "Name and URL are required." };
  if (name.length > 80) return { error: "Name must be 80 characters or fewer." };
  if (url.length > 500) return { error: "URL must be 500 characters or fewer." };
  if (!isHttpUrl(url)) return { error: "URL must start with http:// or https://" };
  if (desc.length > 200) return { error: "Description must be 200 characters or fewer." };
  if (note.length > 80) return { error: "Note must be 80 characters or fewer." };
  if (sitePassword.length > 80) return { error: "Site password must be 80 characters or fewer." };
  if (lastUpdated.length > 40) return { error: "Last updated must be 40 characters or fewer." };
  if (nextUpdateDue.length > 40) return { error: "Next update due must be 40 characters or fewer." };
  if (owner.length > 80) return { error: "Owner must be 80 characters or fewer." };
  if (sources.length > 300) return { error: "Sources must be 300 characters or fewer." };
  if (walkthrough) {
    if (walkthrough.length > 500) return { error: "Walkthrough link must be 500 characters or fewer." };
    if (!isHttpUrl(walkthrough)) return { error: "Walkthrough link must start with http:// or https://" };
  }

  return { fields: { name, url, desc, note, sitePassword, walkthrough, lastUpdated, nextUpdateDue, owner, sources } };
}

function createApp({ staticDir }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Unconditional, before any auth check: tell crawlers (and AI scrapers)
  // to stay away, on every single response including the login page and
  // error responses.
  app.use((req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    next();
  });

  // Public: robots.txt itself has to be reachable without a session for it
  // to do anything.
  app.get(ROBOTS_PATH, (req, res) => {
    res.type("text/plain").send(ROBOTS_TXT);
  });

  // Public: the login page and the passcode-check endpoint.
  app.get(LOGIN_PATH, (req, res) => {
    res.status(200).type("html").send(renderLoginPage());
  });

  app.post(LOGIN_PATH, (req, res) => {
    const passcode = req.body && req.body.passcode;
    if (checkPasscode(passcode)) {
      res.setHeader("Set-Cookie", buildSessionSetCookie(req, makeSessionCookieValue()));
      return res.redirect(302, "/");
    }
    res.status(401).type("html").send(renderLoginPage({ error: "Incorrect passcode. Try again." }));
  });

  // The gate. Everything below this line requires a valid session cookie.
  app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionCookie = cookies[COOKIE_NAME];

    if (isValidSessionCookie(sessionCookie)) {
      // Slide the expiry forward on every authenticated request so a
      // visitor who returns at least once a month is never re-prompted.
      res.setHeader("Set-Cookie", buildSessionSetCookie(req, sessionCookie));
      return next();
    }

    const wantsJson =
      req.path.startsWith("/api/") ||
      (req.headers.accept || "").includes("application/json");
    if (wantsJson) {
      return res.status(401).json({ error: "unauthorized" });
    }
    return res.status(401).type("html").send(renderLoginPage());
  });

  // Everything past this point is authenticated.

  // The dashboards API backs the "Add Dashboard" button and the pencil-icon
  // edit UI (see public/index.html). Backed by one shared Postgres table
  // (src/db.js) rather than per-browser storage, so everyone sees the same
  // list.
  app.get("/api/dashboards", async (req, res) => {
    try {
      const list = await dashboards.listDashboards();
      res.json(list);
    } catch (err) {
      console.error("GET /api/dashboards failed:", err);
      res.status(500).json({ error: "Could not load dashboards." });
    }
  });

  app.post("/api/dashboards", async (req, res) => {
    const { fields, error } = parseDashboardBody(req.body || {});
    if (error) return res.status(400).json({ error });
    try {
      const created = await dashboards.createDashboard(fields);
      res.status(201).json(created);
    } catch (err) {
      console.error("POST /api/dashboards failed:", err);
      res.status(500).json({ error: "Could not add the dashboard." });
    }
  });

  app.put("/api/dashboards/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id." });
    const { fields, error } = parseDashboardBody(req.body || {});
    if (error) return res.status(400).json({ error });
    try {
      const updated = await dashboards.updateDashboard(id, fields);
      if (!updated) return res.status(404).json({ error: "Dashboard not found." });
      res.json(updated);
    } catch (err) {
      console.error("PUT /api/dashboards/:id failed:", err);
      res.status(500).json({ error: "Could not save changes." });
    }
  });

  app.delete("/api/dashboards/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id." });
    try {
      const removed = await dashboards.deleteDashboard(id);
      if (!removed) return res.status(404).json({ error: "Dashboard not found." });
      res.status(204).end();
    } catch (err) {
      console.error("DELETE /api/dashboards/:id failed:", err);
      res.status(500).json({ error: "Could not remove the dashboard." });
    }
  });

  app.use(express.static(staticDir, { extensions: ["html"] }));

  app.use((req, res) => {
    res.status(404).type("html").send("Not found");
  });

  return app;
}

module.exports = { createApp };
