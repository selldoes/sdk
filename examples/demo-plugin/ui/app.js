/**
 * Dashboard UI for Demo Plugin (plain JS — no build step).
 *
 * The host renders this file in a sandboxed, same-origin iframe and appends
 * `?storeId=…&storeSlug=…`. Calls go to the plugin's declared API routes where
 * the server enforces store ownership and permissions.
 */
const params = new URLSearchParams(location.search)
const storeId = params.get("storeId")
const storeSlug = params.get("storeSlug")
const scope = storeId ? `storeId=${encodeURIComponent(storeId)}` : `storeSlug=${encodeURIComponent(storeSlug ?? "")}`
const BASE = "/api/plugin-api/demo-plugin"

const $ = (id) => document.getElementById(id)
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}?${scope}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.ok === false) throw new Error(body.error || `Request failed (${response.status})`)
  return body
}

function showError(message) {
  const element = $("error")
  element.textContent = message ?? ""
  element.hidden = !message
}

async function refresh() {
  showError(null)
  try {
    const stats = await api("/stats")
    $("greeting").textContent = `${stats.settings.greeting} · store #${stats.storeId}`
    $("stats").innerHTML = [
      ["Notes", stats.notes],
      ["Products in catalog", stats.productCount],
      ["Items per tick", stats.settings.maxPerRun],
      ["Log progress", stats.settings.notify ? "on" : "off"],
    ]
      .map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
      .join("")

    $("products").innerHTML = stats.products.length
      ? stats.products
          .map(
            (product) => `<li>
              <span><strong>${escapeHtml(product.name)}</strong> <code>${escapeHtml(product.sku ?? "")}</code> <span class="muted">$${escapeHtml(product.price ?? "")}</span></span>
              <button type="button" data-blurb="${product.id}">Blurb</button>
            </li>`,
          )
          .join("")
      : '<li class="empty muted">No products in the mock store.</li>'

    const { notes } = await api("/notes")
    $("notes").innerHTML = notes.length
      ? notes
          .map(
            (note) => `<li><span>${escapeHtml(note.body)}</span><button type="button" title="Delete" data-id="${note.id}">×</button></li>`,
          )
          .join("")
      : '<li class="empty muted">No notes yet.</li>'
  } catch (error) {
    showError(error.message)
  }
}

$("add").addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = $("note").value.trim()
  if (!body) return
  $("note").value = ""
  try {
    await api("/notes", { method: "POST", body: JSON.stringify({ body }) })
    await refresh()
  } catch (error) {
    showError(error.message)
  }
})

$("notes").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]")
  if (!button) return
  try {
    await api(`/notes?id=${button.dataset.id}`, { method: "DELETE" })
    await refresh()
  } catch (error) {
    showError(error.message)
  }
})

$("products").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-blurb]")
  if (!button) return
  const original = button.textContent
  button.disabled = true
  button.textContent = "…"
  try {
    const data = await api("/blurb", { method: "POST", body: JSON.stringify({ productId: Number(button.dataset.blurb) }) })
    alert(data.blurb)
  } catch (error) {
    showError(error.message)
  } finally {
    button.disabled = false
    button.textContent = original
  }
})

$("refresh").addEventListener("click", refresh)
refresh()
