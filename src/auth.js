// Shared-passcode session logic.
//
// There is no session store and no database. The cookie itself IS the
// session: it carries an issued-at timestamp plus an HMAC of that timestamp,
// keyed off PASSCODE. Anyone holding a cookie whose signature checks out and
// whose timestamp is still within the max-age window is considered logged
// in. Rotating PASSCODE invalidates every existing session automatically,
// since the HMAC key changes.

const crypto = require("node:crypto");

const COOKIE_NAME = "session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
const MAX_AGE_SEC = Math.floor(MAX_AGE_MS / 1000);

function secret() {
  return process.env.PASSCODE || "";
}

function hmac(input) {
  return crypto.createHmac("sha256", secret()).update(input).digest("base64url");
}

// Constant-time string comparison (hash both sides first so differing
// lengths don't leak timing information, then use timingSafeEqual).
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return ha.length === hb.length && crypto.timingSafeEqual(ha, hb);
}

function checkPasscode(candidate) {
  const expected = secret();
  if (!expected) return false; // PASSCODE not configured -> refuse everyone
  return typeof candidate === "string" && candidate.length > 0 && safeEqual(candidate, expected);
}

function makeSessionCookieValue() {
  const payload = String(Date.now());
  return `${payload}.${hmac(payload)}`;
}

function isValidSessionCookie(value) {
  if (!secret()) return false;
  if (!value || typeof value !== "string" || !value.includes(".")) return false;
  const i = value.lastIndexOf(".");
  const payload = value.slice(0, i);
  const sig = value.slice(i + 1);
  if (!safeEqual(sig, hmac(payload))) return false;
  const issuedAt = Number(payload);
  return Number.isFinite(issuedAt) && Date.now() - issuedAt < MAX_AGE_MS;
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_MS,
  MAX_AGE_SEC,
  checkPasscode,
  makeSessionCookieValue,
  isValidSessionCookie,
};
