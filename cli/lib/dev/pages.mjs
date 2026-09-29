/**
 * Server-rendered preview pages for `selldesk-plugin dev`.
 * Plain HTML + a little inline JS — no build step, no dependencies.
 *
 * Styled with the SellDesk dashboard's design tokens (see the app's
 * globals.css): light background, white cards, orange primary, Plus Jakarta
 * Sans, 12px radii. Light + dark follow the OS preference.
 */

/** Default input for the parse tester and other known job types. */
const SAMPLE_INPUTS = {
  "preview-product": { url: "https://www.otrcat.com/p/sam-spade" },
}

/** Sensible tick caps for the quick-run buttons. */
const SAMPLE_TICKS = {
  "test-fetch": 3,
  "preview-product": 2,
  "probe-capabilities": 2,
  "import-products": 10,
  "refresh-products": 10,
}

function defaultInput(type) {
  return SAMPLE_INPUTS[type] ?? {}
}

function defaultTicks(type) {
  return SAMPLE_TICKS[type] ?? 5
}

const STYLES = `
  :root {
    color-scheme: light;
    --background: hsl(0 0% 98%);
    --foreground: hsl(240 10% 10%);
    --card: hsl(0 0% 100%);
    --border: hsl(240 5.9% 90%);
    --muted: hsl(240 4.8% 95.9%);
    --muted-foreground: hsl(240 3.8% 46.1%);
    --primary: hsl(12 100% 60%);
    --primary-foreground: hsl(0 0% 100%);
    --destructive: hsl(0 84.2% 60.2%);
    --success: hsl(161 94% 30%);
    --radius: 0.75rem;
    --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --background: hsl(240 10% 4%);
      --foreground: hsl(0 0% 98%);
      --card: hsl(240 10% 6%);
      --border: hsl(240 5% 15%);
      --muted: hsl(240 5% 15%);
      --muted-foreground: hsl(240 5% 65%);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font: 14px/1.55 var(--font-sans); background: var(--background); color: var(--foreground);
         -webkit-font-smoothing: antialiased; }
  a { color: inherit; }

  header.app { position: sticky; top: 0; z-index: 20; background: var(--card); border-bottom: 1px solid var(--border); }
  header.app .bar { max-width: 1160px; margin: 0 auto; display: flex; align-items: center; gap: 18px; padding: 0 24px; height: 62px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -0.01em; white-space: nowrap; }
  .brand .logo { width: 30px; height: 30px; border-radius: 9px; background: var(--primary); display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .brand small { font-weight: 500; color: var(--muted-foreground); font-size: 12px; }
  nav { display: flex; gap: 2px; margin-left: auto; flex-wrap: wrap; }
  nav a { padding: 7px 12px; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--muted-foreground); text-decoration: none; }
  nav a:hover { background: var(--muted); color: var(--foreground); }
  nav a.active { background: var(--muted); color: var(--foreground); }
  .version { flex: none; }

  main { max-width: 1160px; margin: 0 auto; padding: 28px 24px 72px; }
  h2.page { margin: 0 0 4px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  p.page { margin: 0 0 22px; color: var(--muted-foreground); font-size: 13px; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; align-items: start; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
  .card + .card { margin-top: 16px; }
  .card h3 { margin: 0 0 8px; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
  .muted { color: var(--muted-foreground); font-size: 13px; margin: 6px 0; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .row.tight { gap: 6px; }
  .spacer { flex: 1; }
  .steps { margin: 10px 0 0; padding-left: 20px; }
  .steps li { margin: 7px 0; }
  .callout { display: flex; gap: 10px; align-items: flex-start; border: 1px solid hsl(12 100% 60% / .30);
             background: hsl(12 100% 60% / .07); border-radius: var(--radius); padding: 13px 16px; font-size: 13px; }

  .btn { display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 16px; border-radius: 10px;
         border: 1px solid transparent; background: transparent; color: var(--foreground);
         font: 500 14px var(--font-sans); cursor: pointer; text-decoration: none; }
  .btn:disabled { opacity: .5; cursor: default; }
  .btn-primary { background: var(--primary); color: var(--primary-foreground); }
  .btn-primary:hover:not(:disabled) { filter: brightness(.95); }
  .btn-outline { background: var(--card); border-color: var(--border); }
  .btn-outline:hover:not(:disabled) { background: var(--muted); }
  .btn-ghost:hover:not(:disabled) { background: var(--muted); }
  .btn-sm { height: 31px; padding: 0 11px; font-size: 13px; border-radius: 9px; }

  .badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px;
           font-size: 11px; font-weight: 600; border: 1px solid var(--border); color: var(--muted-foreground);
           background: var(--card); white-space: nowrap; }
  .badge-green { background: hsl(152 76% 94%); color: hsl(161 94% 24%); border-color: transparent; }
  .badge-red { background: hsl(0 93% 94%); color: hsl(0 74% 42%); border-color: transparent; }
  .badge-amber { background: hsl(48 96% 89%); color: hsl(26 90% 37%); border-color: transparent; }
  .badge-blue { background: hsl(214 95% 93%); color: hsl(221 83% 40%); border-color: transparent; }
  @media (prefers-color-scheme: dark) {
    .badge-green { background: hsl(161 60% 14%); color: hsl(152 70% 72%); }
    .badge-red { background: hsl(0 60% 16%); color: hsl(0 90% 78%); }
    .badge-amber { background: hsl(36 60% 15%); color: hsl(43 90% 70%); }
    .badge-blue { background: hsl(221 60% 18%); color: hsl(213 90% 78%); }
  }

  label.field { display: block; font-size: 12px; font-weight: 600; color: var(--muted-foreground); margin: 14px 0 6px; }
  input, select, textarea { width: 100%; background: var(--card); color: var(--foreground);
                            border: 1px solid var(--border); border-radius: 10px; padding: 9px 12px; font: 14px var(--font-sans); }
  input:focus, select:focus, textarea:focus { outline: 2px solid hsl(12 100% 60% / .35); outline-offset: 1px; border-color: var(--primary); }
  textarea { min-height: 84px; resize: vertical; font-family: var(--font-mono); font-size: 12.5px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
       color: var(--muted-foreground); padding: 8px 10px; border-bottom: 1px solid var(--border); }
  td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }

  pre { background: var(--muted); border: 1px solid var(--border); border-radius: 10px; padding: 14px; overflow: auto;
        max-height: 420px; font: 12px/1.6 var(--font-mono); margin: 12px 0 0; white-space: pre-wrap; word-break: break-word; }
  code { font-family: var(--font-mono); font-size: 12px; background: var(--muted); padding: 1px 5px; border-radius: 5px; }
  pre code { background: none; padding: 0; }

  .progress { height: 8px; border-radius: 999px; background: var(--muted); overflow: hidden; margin: 10px 0 4px; }
  .progress > div { height: 100%; background: var(--primary); border-radius: 999px; }

  .frame { width: 100%; border: 1px solid var(--border); border-radius: var(--radius); background: #fff; }

  .storefront { position: relative; border: 1px solid var(--border); border-radius: var(--radius); background: #f9fafb;
                overflow: hidden; min-height: 520px; }
  .storefront .bar { display: flex; justify-content: space-between; align-items: center; padding: 13px 18px;
                     border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #111827; background: white; }
  .storefront .products { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; padding: 16px; }
  .storefront .product { border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; background: white; color: #111827; }
  .storefront .product .muted { color: #6b7280; }
  .storefront .product button { margin-top: 8px; border: 0; border-radius: 9px; padding: 7px 12px; background: hsl(12 100% 60%);
                                color: white; font: 500 13px var(--font-sans); cursor: pointer; }
  .widget-slot { position: fixed; right: 20px; bottom: 20px; z-index: 30; }
  .split { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
  @media (max-width: 900px) { .split { grid-template-columns: 1fr; } }
`

/** Inline scripts shared by the pages that run jobs. */
const CLIENT = `
  const $id = (value) => document.getElementById(value)
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
  async function runJob(payload) {
    const response = await fetch("/__dev/run-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    return response.json()
  }
  function progressBits(telemetry) {
    const list = telemetry.progress || []
    const last = list[list.length - 1]
    if (!last) return ""
    const bits = []
    if (last.processed !== undefined) bits.push(last.processed + (last.total !== undefined ? "/" + last.total : "") + " processed")
    if (last.failed) bits.push(last.failed + " failed")
    if (last.skipped) bits.push(last.skipped + " skipped")
    if (last.message) bits.push(last.message)
    return bits.join(" · ")
  }
  function renderRun(container, data) {
    const run = data.run || {}
    const telemetry = data.telemetry || {}
    let html = ""
    html += "<div class='row' style='margin-top:14px'><span class='badge " + (run.done ? "badge-green" : "badge-amber") + "'>" + (run.done ? "completed" : "paused at tick limit") + "</span>"
    html += "<span class='muted' style='margin:0'>" + esc(run.kind || "job") + " · " + (run.ticks || 0) + " tick(s)</span></div>"
    const bits = progressBits(telemetry)
    if (bits) {
      const last = (telemetry.progress || [])[(telemetry.progress || []).length - 1]
      const pct = last.total > 0 ? Math.min(100, Math.round((last.processed / last.total) * 100)) : 0
      html += "<div class='progress'><div style='width:" + pct + "%'></div></div><p class='muted'>" + esc(bits) + "</p>"
    }
    const items = telemetry.items || []
    if (items.length) {
      html += "<table><thead><tr><th>Item</th><th>Status</th><th>Detail</th></tr></thead><tbody>"
      items.slice(0, 20).forEach((item) => {
        const detail = item.error || (item.data ? JSON.stringify(item.data) : item.productId ? "#" + item.productId : "")
        html += "<tr><td><code>" + esc(item.ref) + "</code></td><td>" + esc(item.status) + "</td><td class='muted' style='margin:0'>" + esc(detail) + "</td></tr>"
      })
      html += "</tbody></table>"
      if (items.length > 20) html += "<p class='muted'>… " + (items.length - 20) + " more item(s)</p>"
    }
    const logs = telemetry.logs || []
    if (logs.length) {
      html += "<details style='margin-top:12px'><summary class='muted' style='cursor:pointer'>Show " + logs.length + " log line(s)</summary><pre>" + esc(logs.map((entry) => "[" + (entry.level || "info") + "] " + entry.message).join("\\n")) + "</pre></details>"
    }
    html += "<pre>" + esc(JSON.stringify(run.done ? run.result : run, null, 2)) + "</pre>"
    container.innerHTML = html
  }
`

const NAV = [
  ["overview", "/preview", "Start here"],
  ["dashboard", "/preview/dashboard", "Dashboard UI"],
  ["storefront", "/preview/storefront", "Storefront"],
  ["api", "/preview/api", "API console"],
  ["jobs", "/preview/jobs", "Jobs"],
  ["hooks", "/preview/hooks", "Hooks"],
  ["data", "/preview/data", "Data"],
  ["email", "/preview/email", "Email"],
  ["realtime", "/preview/realtime", "Realtime"],
]

const LOGO_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.1" stroke-linecap="round"><rect x="2.5" y="8.5" width="19" height="12" rx="3"/><circle cx="12" cy="14.5" r="2.6"/><path d="M6.5 8.5 15 4"/></svg>`

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%23ff5c33'/%3E%3Ctext x='16' y='22.5' font-family='sans-serif' font-size='17' font-weight='700' fill='white' text-anchor='middle'%3ES%3C/text%3E%3C/svg%3E"

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
}

export function layout({ manifest, active, body, script = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(manifest.name)} — SellDesk preview</title>
<link rel="icon" href="${FAVICON}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>${STYLES}</style>
</head>
<body>
<header class="app">
  <div class="bar">
    <span class="brand"><span class="logo">${LOGO_SVG}</span> SellDesk <small>plugin preview</small></span>
    <nav>${NAV.map(([key, href, label]) => `<a href="${href}" class="${key === active ? "active" : ""}">${label}</a>`).join("")}</nav>
    <span class="badge version">${escapeHtml(manifest.slug)} v${escapeHtml(manifest.version)}</span>
  </div>
</header>
<main>${body}</main>
${script ? `<script type="module">${script}</script>` : ""}
</body>
</html>`
}

export function overviewPage({ manifest }) {
  const permissions = (manifest.permissions ?? []).map((permission) => `<span class="badge">${permission}</span>`).join(" ")
  const jobs = manifest.jobs ?? []
  const quickJobs = jobs.map((job) => ({
    type: job.type,
    label: job.name ?? job.type,
    input: defaultInput(job.type),
    maxTicks: defaultTicks(job.type),
  }))

  const quickCard = jobs.length
    ? `<div class="card">
         <h3>Run it</h3>
         <p class="muted">Buttons run the declared jobs right here against the mock store. Results show below and stay in
         the <a href="/preview/jobs">Jobs</a> tab.</p>
         <div class="row" style="margin-top:12px">
           ${quickJobs
             .map(
               (job, index) =>
                 `<button class="btn ${index === 0 ? "btn-primary" : "btn-outline"}" data-quick="${escapeHtml(job.type)}">${escapeHtml(job.label)}</button>`,
             )
             .join("")}
         </div>
         <div id="quick-run"></div>
       </div>`
    : `<div class="card"><h3>Run it</h3><p class="muted">This plugin declares no jobs.</p></div>`

  const startHere =
    manifest.slug === "otrcat-scraper"
      ? `<div class="card">
           <h3>Start here</h3>
           <ol class="steps">
             <li><strong>Test the connection</strong> — runs <code>Test fetch</code>: downloads your listing URL a few times.</li>
             <li><strong>Check the parser</strong> — runs <code>Preview a product parse</code>: shows the exact title, price, variants and
               tracks it reads from one product page. Prefilled with a sample OTRCat product.</li>
             <li><strong>Import</strong> — runs <code>Import products</code>: walks the listing and creates products in the mock store
               (capped at 3 by <code>selldesk.config.json</code>).</li>
           </ol>
           <p class="muted">Everything is local and fake — no real store is touched. Reset the mock store from the
           <a href="/preview/data">Data</a> tab.</p>
         </div>`
      : `<div class="card">
           <h3>Start here</h3>
           <p class="muted">Use <strong>Run it</strong> for a quick job run, or open <strong>Jobs</strong> to pass JSON input and a
           higher tick cap. API routes can be tried in the <a href="/preview/api">API console</a>.</p>
         </div>`

  const body = `
    <h2 class="page">${escapeHtml(manifest.name)}</h2>
    <p class="page">${escapeHtml(manifest.description ?? "")}</p>
    <div class="grid">
      ${startHere}
      ${quickCard}
    </div>
    <div class="grid" style="margin-top:16px">
      <div class="card">
        <h3>Manifest</h3>
        <p><strong>${escapeHtml(manifest.name)}</strong> <span class="muted" style="margin:0">v${escapeHtml(manifest.version)}</span></p>
        <p class="muted">Permissions</p>
        <p>${permissions || '<span class="muted">none</span>'}</p>
        <p class="muted">${
          manifest.ui?.entry
            ? `Dashboard UI: <code>${escapeHtml(manifest.ui.entry)}</code>`
            : "No dashboard UI — the host shows the settings + jobs page"
        }</p>
      </div>
      <div class="card">
        <h3>Surface</h3>
        <p>${(manifest.apiRoutes ?? []).length} dashboard route(s) · ${(manifest.publicRoutes ?? []).length} public route(s)</p>
        <p>${jobs.length} job(s) · ${Object.keys(manifest.hooks ?? {}).length} hook(s)</p>
        <p>${(manifest.storefrontPages ?? []).length} storefront page(s)${manifest.storefrontWidget?.entry ? " · widget" : ""}</p>
        <div class="row" style="margin-top:10px"><button id="rebuild" class="btn btn-outline btn-sm">Rebuild bundle</button><span id="rebuild-result" class="muted" style="margin:0"></span></div>
      </div>
    </div>`

  const script = `
    ${CLIENT}
    const QUICK = ${JSON.stringify(quickJobs)}
    document.querySelectorAll("button[data-quick]").forEach((button) => {
      button.addEventListener("click", async () => {
        const job = QUICK.find((entry) => entry.type === button.dataset.quick)
        if (!job) return
        const output = $id("quick-run")
        const buttons = document.querySelectorAll("button[data-quick]")
        buttons.forEach((other) => { other.disabled = true })
        button.textContent = "Running…"
        output.innerHTML = ""
        try {
          const data = await runJob({ type: job.type, input: job.input, maxTicks: job.maxTicks })
          if (data.error) output.innerHTML = "<pre>" + esc(data.error) + "</pre>"
          else renderRun(output, data)
        } catch (error) {
          output.innerHTML = "<pre>" + esc(String(error)) + "</pre>"
        } finally {
          button.textContent = job.label
          buttons.forEach((other) => { other.disabled = false })
        }
      })
    })
    $id("rebuild").addEventListener("click", async () => {
      const button = $id("rebuild")
      button.disabled = true
      try {
        const response = await fetch("/__dev/rebuild", { method: "POST" })
        const data = await response.json()
        $id("rebuild-result").textContent = data.error ? data.error : "rebuilt ✓"
      } finally { button.disabled = false }
    })`

  return layout({ manifest, active: "overview", body, script })
}

export function dashboardPage({ manifest, storeId, storeSlug }) {
  if (!manifest.ui?.entry) {
    return layout({
      manifest,
      active: "dashboard",
      body: `<div class="card"><h3>No dashboard UI</h3><p class="muted">This plugin renders the host's standard settings + jobs page instead.
        Declare <code>"ui": { "entry": "ui/index.html" }</code> in plugin.json to add your own.</p></div>`,
    })
  }
  const src = `/api/plugins/${manifest.slug}/ui/${manifest.ui.entry}?storeId=${storeId}&storeSlug=${encodeURIComponent(storeSlug)}`
  return layout({
    manifest,
    active: "dashboard",
    body: `<h2 class="page">Dashboard UI</h2>
      <p class="page">Rendered exactly like the host does — a sandboxed iframe calling
        <code>/api/plugin-api/${manifest.slug}/…</code>.</p>
      <iframe class="frame" src="${src}" style="height: 780px"></iframe>`,
  })
}

function storefrontChrome({ manifest, storeSlug, storeId }) {
  const widget = manifest.storefrontWidget
  const pages = manifest.storefrontPages ?? []
  const widgetHtml = widget
    ? `<iframe id="widget-frame" class="frame"
         src="/api/plugin-public/${manifest.slug}/ui/${widget.entry}?storeSlug=${encodeURIComponent(storeSlug)}"
         style="width: 64px; height: 64px; background: transparent; border: 0;"></iframe>`
    : `<p class="muted">No storefront widget declared.</p>`
  const pagesHtml = pages.length
    ? pages
        .map(
          (page) =>
            `<a href="/preview/storefront?page=${encodeURIComponent(page.path)}">${escapeHtml(page.title)} <span class="muted">${escapeHtml(page.path)}</span></a>`,
        )
        .join("<br/>")
    : '<p class="muted">No storefront pages declared.</p>'
  return { widgetHtml, pagesHtml, widget, pages }
}

export function storefrontPage({ manifest, storeSlug, pagePath }) {
  const { widgetHtml, pagesHtml, widget, pages } = storefrontChrome({ manifest, storeSlug })
  const activePage = pagePath ? pages.find((page) => page.path === pagePath) : null
  const pageFrame = activePage
    ? `<div class="card" style="margin-bottom:16px">
         <h3>Storefront page: ${escapeHtml(activePage.title)} (${escapeHtml(activePage.path)})</h3>
         <p class="muted">Served by the app's storefrontPages host inside your real store's layout. The iframe is
           self-resizing via <code>selldesk:resize</code>.</p>
         <iframe id="page-frame" class="frame" style="height: 560px"
           src="/api/plugin-public/${manifest.slug}/ui/${activePage.entry}?storeSlug=${encodeURIComponent(storeSlug)}"></iframe>
       </div>`
    : ""
  const body = `
    ${pageFrame}
    <div class="split">
      <div class="card">
        <h3>Storefront pages</h3>
        ${pagesHtml}
      </div>
      <div class="card" style="padding:0; overflow:hidden">
        <div class="storefront">
          <div class="bar"><span>Demo Store</span><span class="muted" style="margin:0">cart (0)</span></div>
          <div class="products">
            ${["Classic Tee", "Canvas Tote", "Mug — Logo", "Sticker Pack"]
              .map((name) => `<div class="product"><strong>${name}</strong><p class="muted">$12.00 – $24.90</p><button>Add to cart</button></div>`)
              .join("")}
          </div>
          <div class="widget-slot">${widgetHtml}</div>
        </div>
      </div>
    </div>`
  const script = `
    window.addEventListener("message", (event) => {
      if (event.origin !== location.origin) return
      const data = event.data
      if (!data || data.type !== "selldesk:resize") return
      const frame = data.slug === ${JSON.stringify(manifest.slug)}
        ? (document.getElementById("widget-frame") || document.getElementById("page-frame"))
        : document.getElementById("page-frame")
      if (!frame) return
      if (typeof data.width === "number") frame.style.width = Math.max(40, Math.min(data.width, 900)) + "px"
      if (typeof data.height === "number") frame.style.height = Math.max(120, Math.min(data.height, 4000)) + "px"
    })`
  return layout({ manifest, active: "storefront", body, script })
}

export function apiPage({ manifest }) {
  const routes = [
    ...(manifest.apiRoutes ?? []).map((route) => ({ ...route, kind: "dashboard", base: `/api/plugin-api/${manifest.slug}` })),
    ...(manifest.publicRoutes ?? []).map((route) => ({ ...route, kind: "public", base: `/api/plugin-public/${manifest.slug}` })),
  ]
  const first = routes[0]
  const routeRows = routes
    .map(
      (route) =>
        `<tr><td><span class="badge">${route.kind}</span></td><td><code>${escapeHtml(route.base + route.path)}</code></td>
         <td class="row tight">${(route.methods ?? ["GET"]).map((method) => `<button class="btn btn-outline btn-sm" data-method="${method}" data-path="${escapeHtml(route.base + route.path)}">${method}</button>`).join("")}</td></tr>`,
    )
    .join("")
  const body = `
    <h2 class="page">API console</h2>
    <p class="page">Pick a declared route, send it, and inspect the JSON your handler returns. Requests are evaluated with the
      same permission checks as production.</p>
    <div class="split">
      <div class="card">
        <h3>Declared routes</h3>
        <table>${routeRows || '<tr><td class="muted">No routes declared.</td></tr>'}</table>
      </div>
      <div class="card">
        <h3>Try a request</h3>
        <div class="row">
          <select id="method" style="width:110px"><option>GET</option><option>POST</option><option>PATCH</option><option>PUT</option><option>DELETE</option></select>
          <input id="path" style="flex:1; min-width:240px" value="${first ? escapeHtml(first.base + first.path) : ""}" />
          <button id="send" class="btn btn-primary">Send</button>
        </div>
        <label class="field" for="query">Query string</label>
        <input id="query" placeholder="storeSlug=dev-store&amp;since=0" />
        <label class="field" for="body">JSON body (non-GET)</label>
        <textarea id="body" placeholder='{ "example": true }'></textarea>
        <pre id="result">—</pre>
      </div>
    </div>`
  const script = `
    ${CLIENT}
    document.querySelectorAll("button[data-path]").forEach((button) => {
      button.addEventListener("click", () => {
        $id("path").value = button.dataset.path
        $id("method").value = button.dataset.method
      })
    })
    $id("send").addEventListener("click", async () => {
      const method = $id("method").value
      const path = $id("path").value
      const query = $id("query").value.trim()
      const result = $id("result")
      result.textContent = "…"
      try {
        const response = await fetch(path + (query ? "?" + query : ""), {
          method,
          headers: { "Content-Type": "application/json" },
          body: method === "GET" ? undefined : $id("body").value || "{}",
        })
        result.textContent = response.status + "\\n" + JSON.stringify(await response.json().catch(() => null), null, 2)
      } catch (error) {
        result.textContent = String(error)
      }
    })`
  return layout({ manifest, active: "api", body, script })
}

export function jobsPage({ manifest }) {
  const jobs = manifest.jobs ?? []
  const rows = jobs
    .map(
      (job) =>
        `<div class="card">
           <div class="row">
             <h3 style="margin:0">${escapeHtml(job.name ?? job.type)}</h3>
             <span class="badge">${escapeHtml(job.type)}</span>
           </div>
           <p class="muted">${escapeHtml(job.description ?? "")}</p>
           <div class="split" style="grid-template-columns: 1fr 130px; margin-top:12px">
             <div>
               <label class="field" for="input-${escapeHtml(job.type)}">Input JSON</label>
               <textarea id="input-${escapeHtml(job.type)}">${escapeHtml(JSON.stringify(defaultInput(job.type), null, 2))}</textarea>
             </div>
             <div>
               <label class="field" for="ticks-${escapeHtml(job.type)}">Max ticks</label>
               <input id="ticks-${escapeHtml(job.type)}" type="number" min="1" max="500" value="${defaultTicks(job.type)}" />
             </div>
           </div>
           <div class="row" style="margin-top:12px">
             <button class="btn btn-primary" data-job="${escapeHtml(job.type)}">Run job</button>
             <span class="muted" style="margin:0" id="status-${escapeHtml(job.type)}"></span>
           </div>
           <div id="run-${escapeHtml(job.type)}"></div>
         </div>`,
    )
    .join("")
  const body = jobs.length
    ? `<h2 class="page">Jobs</h2>
       <p class="page">Jobs run against the locally built bundle and the mock store (persisted to
         <code>.selldesk-dev/db.json</code>). Chunked jobs advance one tick at a time, capped by <em>Max ticks</em>;
         raise it for bigger imports.</p>
       ${rows}`
    : `<div class="card"><h3>No jobs</h3><p class="muted">Declare jobs in plugin.json and export
        <code>jobs: { "type": { init, step, finalize } }</code> (or a legacy <code>async (input, ctx)</code> function).</p></div>`
  const script = `
    ${CLIENT}
    document.querySelectorAll("button[data-job]").forEach((button) => {
      button.addEventListener("click", async () => {
        const type = button.dataset.job
        const status = $id("status-" + type)
        const output = $id("run-" + type)
        status.textContent = "running…"
        output.innerHTML = ""
        try {
          const input = JSON.parse($id("input-" + type).value || "{}")
          const maxTicks = Number($id("ticks-" + type).value) || 50
          const data = await runJob({ type, input, maxTicks })
          if (data.error) {
            status.textContent = "failed"
            output.innerHTML = "<pre>" + esc(data.error) + "</pre>"
            return
          }
          status.textContent = data.run && data.run.done ? "done" : "paused"
          renderRun(output, data)
        } catch (error) {
          status.textContent = "failed"
          output.innerHTML = "<pre>" + esc(String(error)) + "</pre>"
        }
      })
    })`
  return layout({ manifest, active: "jobs", body, script })
}

export function hooksPage({ manifest }) {
  const hooks = Object.entries(manifest.hooks ?? {})
  const rows = hooks
    .map(
      ([name, declaration]) =>
        `<div class="card">
           <h3>${escapeHtml(name)}</h3>
           <p class="muted">${declaration.handler ? `handler: ${escapeHtml(declaration.handler)}` : declaration.component ? `component: ${escapeHtml(declaration.component)}` : declaration.types ? `types: ${escapeHtml((declaration.types || []).join(", "))}` : ""}</p>
           <label class="field" for="payload-${escapeHtml(name)}">Payload JSON</label>
           <textarea id="payload-${escapeHtml(name)}">{\n  "storeId": 1\n}</textarea>
           <div class="row" style="margin-top:12px">
             <button class="btn btn-primary" data-hook="${escapeHtml(name)}">Fire hook</button>
             <span class="muted" style="margin:0" id="status-${escapeHtml(name)}"></span>
           </div>
           <pre id="result-${escapeHtml(name)}">—</pre>
         </div>`,
    )
    .join("")
  const body = hooks.length
    ? `<h2 class="page">Hooks</h2>
       <p class="page">Hooks run against the bundle exports (<code>hooks["name"]</code>).</p>${rows}`
    : `<div class="card"><h3>No hooks</h3><p class="muted">Declare hooks in plugin.json and export them from the entry.</p></div>`
  const script = `
    ${CLIENT}
    document.querySelectorAll("button[data-hook]").forEach((button) => {
      button.addEventListener("click", async () => {
        const name = button.dataset.hook
        const status = $id("status-" + name)
        const result = $id("result-" + name)
        status.textContent = "running…"
        try {
          const payload = JSON.parse($id("payload-" + name).value || "{}")
          const response = await fetch("/__dev/run-hook", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hook: name, payload }),
          })
          const data = await response.json()
          status.textContent = data.error ? "failed" : "done"
          result.textContent = JSON.stringify(data.result ?? data, null, 2)
        } catch (error) {
          status.textContent = "failed"
          result.textContent = String(error)
        }
      })
    })`
  return layout({ manifest, active: "hooks", body, script })
}

export function dataPage({ manifest }) {
  const body = `
    <h2 class="page">Mock data</h2>
    <p class="page">Everything the plugin writes locally lives here (<code>.selldesk-dev/db.json</code>).</p>
    <div class="row" style="margin-bottom:16px">
      <button id="reset" class="btn btn-outline">Reset mock data</button>
      <span class="muted" style="margin:0" id="status"></span>
    </div>
    <div id="tables" class="grid"></div>`
  const script = `
    ${CLIENT}
    async function refresh() {
      const response = await fetch("/__dev/state")
      const data = await response.json()
      const container = $id("tables")
      const entries = Object.entries(data.tables)
      container.innerHTML = entries.map(([name, table]) =>
        "<div class='card'><h3>" + esc(name) + " <span class='badge'>" + table.rows + " rows</span></h3>" +
        "<p class='muted'>" + esc(table.columns.join(", ")) + "</p>" +
        "<pre>" + esc(JSON.stringify(table.sample, null, 2)) + "</pre></div>"
      ).join("") || "<div class='card'><p class='muted'>No tables yet.</p></div>"
    }
    $id("reset").addEventListener("click", async () => {
      await fetch("/__dev/reset-data", { method: "POST" })
      $id("status").textContent = "reset ✓"
      await refresh()
    })
    await refresh()`
  return layout({ manifest, active: "data", body, script })
}

export function emailPage({ manifest }) {
  const body = `<h2 class="page">Email outbox</h2>
    <p class="page">Emails sent through <code>ctx.email.send()</code> in this session. Nothing leaves your machine.</p>
    <div id="outbox"></div>`
  const script = `
    ${CLIENT}
    const response = await fetch("/__dev/outbox")
    const data = await response.json()
    $id("outbox").innerHTML = data.outbox.length
      ? data.outbox.slice().reverse().map((entry) =>
          "<div class='card'><h3>" + esc(entry.to) + "</h3>" +
          "<p><strong>" + esc(entry.subject) + "</strong></p>" +
          "<p class='muted'>" + esc(entry.at) + "</p>" +
          "<pre>" + esc(entry.text ?? entry.html ?? "") + "</pre></div>"
        ).join("")
      : "<div class='card'><p class='muted'>No emails sent yet.</p></div>"`
  return layout({ manifest, active: "email", body, script })
}

export function realtimePage({ manifest }) {
  const body = `<h2 class="page">Realtime events</h2>
    <p class="page">Events published through <code>ctx.realtime.publish()</code> in this session.</p>
    <pre id="events">…</pre>`
  const script = `
    ${CLIENT}
    const response = await fetch("/__dev/events")
    const data = await response.json()
    $id("events").textContent = JSON.stringify(data.events.slice().reverse(), null, 2)`
  return layout({ manifest, active: "realtime", body, script })
}
