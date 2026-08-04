// Minimal cookie helpers. Deliberately dependency-free — the cookie format
// we use (name=value pairs; our value has no special characters) doesn't
// need a full parser.

const { COOKIE_NAME, MAX_AGE_SEC } = require("./auth");

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

// Builds a Set-Cookie header value for the session cookie. `Secure` is only
// added when the request is actually HTTPS, so local http://localhost dev
// keeps working.
function buildSessionSetCookie(req, value) {
  const isHttps =
    req.secure || (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${MAX_AGE_SEC}`,
  ];
  if (isHttps) parts.push("Secure");
  return parts.join("; ");
}

module.exports = { parseCookies, buildSessionSetCookie };
