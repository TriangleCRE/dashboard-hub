// Minimal login page. Plain <form method="POST"> — no JS required, degrades
// gracefully.

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderLoginPage({ error } = {}) {
  const errorHtml = error
    ? `<p class="err">${escapeHtml(error)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Triangle Investment Group — Sign in</title>
<style>
  :root{
    --green:#33a63f;
    --green-dark:#2b8a34;
    --ink:#2b2f33;
    --ink-soft:#565b60;
    --line:#e6e8ea;
    --bg:#f5f6f7;
    --card:#ffffff;
    --shadow:0 1px 3px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.06);
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
    color:var(--ink);
    background:var(--bg);
    -webkit-font-smoothing:antialiased;
  }
  #gate{
    position:fixed;inset:0;
    display:flex;align-items:center;justify-content:center;
    padding:24px;
  }
  .gate-card{
    width:100%;max-width:380px;background:var(--card);
    border:1px solid var(--line);border-radius:16px;
    box-shadow:var(--shadow);
    padding:34px 30px 30px;text-align:center;
  }
  .gate-card h1{font-size:17px;margin:6px 0 2px;font-weight:700;letter-spacing:.2px}
  .gate-card p.sub{font-size:13px;color:var(--ink-soft);margin:0 0 20px}
  .gate-card input{
    width:100%;padding:13px 14px;font-size:16px;text-align:center;letter-spacing:3px;
    border:1.5px solid var(--line);border-radius:10px;outline:none;transition:border .15s;
  }
  .gate-card input:focus{border-color:var(--green)}
  .gate-card button{
    width:100%;margin-top:12px;padding:13px 14px;font-size:15px;font-weight:600;
    color:#fff;background:var(--green);border:none;border-radius:10px;cursor:pointer;
    transition:background .15s;
  }
  .gate-card button:hover{background:var(--green-dark)}
  .gate-card .err{color:#c0392b;font-size:13px;margin:14px 0 0}
</style>
</head>
<body>
  <div id="gate">
    <form class="gate-card" method="POST" action="/login">
      <h1>Triangle Investment Group</h1>
      <p class="sub">Dashboard Hub — enter passcode to continue</p>
      <input name="passcode" type="password" inputmode="numeric" placeholder="Passcode" autocomplete="off" autofocus />
      <button type="submit">Unlock</button>
      ${errorHtml}
    </form>
  </div>
</body>
</html>`;
}

module.exports = { renderLoginPage };
