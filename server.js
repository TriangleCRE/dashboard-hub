// Local dev entry point: `node server.js` (or `npm start`).
const path = require("node:path");
const { createApp } = require("./src/app");

const app = createApp({ staticDir: path.join(__dirname, "public") });
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Dashboard hub listening on http://localhost:${port}`);
  if (!process.env.PASSCODE) {
    console.warn(
      "WARNING: PASSCODE env var is not set. The login gate will reject every passcode until it is set."
    );
  }
});
