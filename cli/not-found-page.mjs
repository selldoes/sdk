/**
 * A styled, self-contained 404 page shared by the Selldoes dev servers
 * (workspace shell, plugin preview, theme preview).
 *
 * Browsers navigating to a missing page get this HTML page; API clients
 * (fetch/XHR) keep the JSON `{ error }` body they already parse.
 */

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  )
}

/** True when the request comes from a browser address-bar / link navigation. */
export function wantsHtmlPage(req) {
  if (req.method !== "GET" && req.method !== "HEAD") return false
  const accept = String(req.headers?.accept ?? "")
  if (accept.includes("text/html")) return true
  return String(req.headers?.["sec-fetch-mode"] ?? "") === "navigate"
}

/**
 * Renders the 404 page.
 *
 *   pathname  the URL that was not found (shown to the user)
 *   homeUrl   where "Open workspace" / "Back to preview" points
 *   homeLabel label for the home action
 *   links     optional [{ to, label }] quick-link chips
 *   hint      optional extra guidance line
 */
export function notFoundHtml({ pathname = "/", homeUrl = "/", homeLabel = "Open workspace", links = [], hint } = {}) {
  const path = escapeHtml(pathname)
  const home = escapeHtml(homeUrl)
  const label = escapeHtml(homeLabel)
  const chips = links
    .filter((link) => link && link.to)
    .map((link) => `<a class="chip" href="${escapeHtml(link.to)}">${escapeHtml(link.label ?? link.to)}</a>`)
    .join("")
  const hintHtml = hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ""
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page not found — Selldoes</title>
    <style>
      :root {
        color-scheme: light;
        --bg: hsl(0 0% 98%);
        --card: hsl(0 0% 100%);
        --border: hsl(240 5.9% 90%);
        --fg: hsl(240 10% 10%);
        --muted: hsl(240 3.8% 46.1%);
        --chip-bg: hsl(240 4.8% 95.9%);
        --primary: hsl(12 100% 60%);
        --primary-fg: hsl(0 0% 100%);
        --ghost: hsl(240 5.9% 90%);
      }
      html.dark {
        color-scheme: dark;
        --bg: hsl(240 10% 4%);
        --card: hsl(240 10% 6%);
        --border: hsl(240 5% 15%);
        --fg: hsl(0 0% 98%);
        --muted: hsl(240 5% 65%);
        --chip-bg: hsl(240 5% 15%);
        --primary: hsl(12 100% 60%);
        --primary-fg: hsl(0 0% 100%);
        --ghost: hsl(240 5% 15%);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(1000px 500px at 50% -10%, hsl(12 100% 60% / 0.08), transparent 60%),
          var(--bg);
        color: var(--fg);
        font: 14px/1.55 "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .card {
        position: relative;
        overflow: hidden;
        width: 100%;
        max-width: 520px;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 36px 32px 28px;
        text-align: center;
        box-shadow: 0 1px 2px hsl(240 10% 10% / 0.04), 0 12px 32px hsl(240 10% 10% / 0.06);
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: var(--muted);
      }
      .brand svg { display: block; }
      .big {
        margin: 18px 0 0;
        font-size: 84px;
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.04em;
        color: var(--ghost);
        user-select: none;
      }
      h1 { margin: 10px 0 6px; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
      .path {
        display: inline-block;
        max-width: 100%;
        margin: 10px 0 2px;
        padding: 4px 10px;
        border-radius: 8px;
        background: var(--chip-bg);
        border: 1px solid var(--border);
        font: 500 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        color: var(--fg);
        overflow-wrap: anywhere;
      }
      p.copy { margin: 12px auto 0; max-width: 400px; color: var(--muted); font-size: 13.5px; }
      p.hint { margin: 8px auto 0; max-width: 420px; color: var(--muted); font-size: 12px; }
      .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 20px; }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border-radius: 10px;
        padding: 10px 16px;
        font: 600 13px/1 "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
        text-decoration: none;
        cursor: pointer;
        border: 1px solid transparent;
        transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
      }
      .btn:active { transform: translateY(1px); }
      .btn.primary { background: var(--primary); color: var(--primary-fg); }
      .btn.primary:hover { filter: brightness(1.05); }
      .btn.ghost { background: transparent; color: var(--fg); border-color: var(--border); }
      .btn.ghost:hover { background: var(--chip-bg); }
      .chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 22px; }
      .chips .label {
        flex-basis: 100%;
        margin-bottom: 2px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .chip {
        display: inline-flex;
        padding: 5px 11px;
        border-radius: 999px;
        background: var(--chip-bg);
        border: 1px solid var(--border);
        color: var(--fg);
        font-size: 12px;
        font-weight: 600;
        text-decoration: none;
      }
      .chip:hover { border-color: var(--primary); color: var(--primary); }
      footer { margin-top: 22px; font-size: 12px; color: var(--muted); }
      footer a { color: var(--muted); }
      footer a:hover { color: var(--primary); }
    </style>
    <script>
      // Mirror the dev UI's stored theme (selldoes-dev-theme) before paint.
      try {
        var stored = localStorage.getItem("selldoes-dev-theme")
        if (stored === "dark") document.documentElement.classList.add("dark")
      } catch (e) {}
    </script>
  </head>
  <body>
    <main class="card">
      <span class="brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(12 100% 60%)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
          <path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
        Selldoes dev
      </span>
      <div class="big">404</div>
      <h1>Page not found</h1>
      <code class="path">${path}</code>
      <p class="copy">This address doesn't match a page in the Selldoes workspace. The link may be stale, the page may have been renamed, or the URL was typed by hand.</p>
      ${hintHtml}
      <div class="actions">
        <button class="btn ghost" type="button" onclick="history.length > 1 ? history.back() : (location.href = ${JSON.stringify(home)})">Go back</button>
        <a class="btn primary" href="${home}">${label}</a>
      </div>
      ${
        chips
          ? `<div class="chips"><span class="label">Jump to</span>${chips}</div>`
          : ""
      }
      <footer>
        Need help? See the <a href="https://selldoes.com/docs/plugins" target="_blank" rel="noreferrer">Selldoes plugin docs</a>.
      </footer>
    </main>
  </body>
</html>
`
}

/**
 * Writes a 404 response: styled HTML for browser navigations, JSON for API
 * clients (the JSON body shape is unchanged — `{ error: "Not found: …" }`).
 */
export function sendNotFound(req, res, options = {}) {
  const pathname = options.pathname ?? req.url ?? "/"
  if (wantsHtmlPage(req)) {
    res.writeHead(404, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    })
    res.end(req.method === "HEAD" ? undefined : notFoundHtml({ ...options, pathname }))
    return
  }
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  res.end(JSON.stringify({ error: `Not found: ${pathname}` }))
}
