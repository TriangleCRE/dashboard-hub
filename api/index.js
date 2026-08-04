// Vercel serverless entry point. vercel.json routes every request here so
// the passcode gate in src/app.js sees literally everything — pages,
// static assets, and any API routes alike.
const path = require("node:path");
const { createApp } = require("../src/app");

module.exports = createApp({ staticDir: path.join(__dirname, "..", "public") });
