/**
 * __PLUGIN_NAME__ — status page.
 *
 * The host renders this file in a sandboxed, same-origin iframe and appends
 * `?storeId=…&storeSlug=…`. All data comes from the plugin's declared API
 * routes (`/status`, `/recent`), where the server enforces permissions and
 * store ownership. Jobs are started from the main dashboard page (the kit job
 * runner) — the status page only reads.
 */
const params = new URLSearchParams(location.search)
const storeId = params.get("storeId")
const storeSlug = params.get("storeSlug")
const scope = storeId ? `storeId=${encodeURIComponent(storeId)}` : `storeSlug=${encodeURIComponent(storeSlug ?? "")}`
const BASE = "/api/plugin-api/__PLUGIN_SLUG__"

const $ = (id) => document.getElementById(id)

async function api(path) {
  const response = await fetch(`${BASE}${path}?${scope}`)
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.ok === false) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
}

function relativeTime(iso) {
  if (!iso) return "never"
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return String(iso)
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

async function refresh() {
  $("error").hidden = true
  try {
    const [status, recent] = await Promise.all([api("/status"), api("/recent")])
    const summary = status.lastImport ?? {}

    $("total").textContent = String(status.totalProducts ?? 0)
    $("last-when").textContent = relativeTime(summary.finishedAt)
    $("last-counts").textContent = `${summary.created ?? 0} / ${summary.updated ?? 0}`
    $("last-issues").textContent = `${summary.skipped ?? 0} / ${summary.failed ?? 0}`

    const rows = recent.rows ?? []
    $("empty").hidden = rows.length > 0
    $("recent").querySelector("tbody").innerHTML = rows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.sku)}</td>
          <td>${escapeHtml(row.price)}</td>
          <td>${escapeHtml(row.status)}</td>
        </tr>`,
      )
      .join("")
  } catch (error) {
    $("error").textContent = error.message
    $("error").hidden = false
  }
}

$("refresh").addEventListener("click", refresh)
void refresh()
