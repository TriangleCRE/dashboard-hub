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

// Paths reachable with no session at all.
const LOGIN_PATH = "/login";
const ROBOTS_PATH = "/robots.txt";

function createApp({ staticDir }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));

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
  app.use(express.static(staticDir, { extensions: ["html"] }));

  app.use((req, res) => {
    res.status(404).type("html").send("Not found");
  });

  return app;
}

module.exports = { createApp };
