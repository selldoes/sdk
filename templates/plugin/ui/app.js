/**
 * Dashboard UI for __PLUGIN_NAME__.
 *
 * The host renders this file in a sandboxed, same-origin iframe and appends
 * `?storeId=…&storeSlug=…`. API calls go to the plugin's declared routes where
 * the server enforces store ownership and permissions.
 *
 * This is plain JS — no build step. If you prefer a framework, put sources in
 * `ui/src/` and `npm run build` will bundle them to `ui/assets/index.js`.
 */
const params = new URLSearchParams(location.search)
const storeId = params.get("storeId")
const storeSlug = params.get("storeSlug")
const scope = storeId ? `storeId=${encodeURIComponent(storeId)}` : `storeSlug=${encodeURIComponent(storeSlug ?? "")}`
const BASE = "/api/plugin-api/__PLUGIN_SLUG__"

const $ = (id) => document.getElementById(id)

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}?${scope}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.ok === false) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
}

async function refresh() {
  const { notes } = await api("/notes")
  $("notes").innerHTML =
    notes.length === 0
      ? '<li class="muted empty">No notes yet.</li>'
      : notes
          .map(
            (note) => `<li><span>${escapeHtml(note.body)}</span><button data-id="${note.id}" title="Delete">×</button></li>`,
          )
          .join("")
}

$("add").addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = $("note").value.trim()
  if (!body) return
  $("note").value = ""
  await api("/notes", { method: "POST", body: JSON.stringify({ body }) })
  await refresh()
})

$("notes").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]")
  if (!button) return
  await api(`/notes?id=${button.dataset.id}`, { method: "DELETE" })
  await refresh()
})

refresh().catch((error) => {
  document.body.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`
})
