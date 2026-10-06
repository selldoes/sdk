/**
 * __PLUGIN_NAME__ — storefront widget.
 *
 * Mounted by the host in a small sandboxed iframe on every storefront page.
 * It calls the plugin's `publicRoutes` (no dashboard session); the store is
 * resolved from the `storeSlug` query param. Ask the host to resize the iframe
 * with a `selldesk:resize` postMessage when opening/closing the panel.
 */
const params = new URLSearchParams(location.search)
const storeSlug = params.get("storeSlug") ?? ""
const segments = location.pathname.split("/").filter(Boolean)
const slug = segments[2] === "plugin-public" ? segments[3] : "__PLUGIN_SLUG__"

const bubble = document.getElementById("bubble")
const panel = document.getElementById("panel")
const status = document.getElementById("status")
let open = false

function resize(width, height) {
  parent.postMessage({ type: "selldesk:resize", slug, width, height }, "*")
}

function toggle(next) {
  open = next
  bubble.hidden = open
  panel.hidden = !open
  status.hidden = true
  resize(open ? 300 : 64, open ? 330 : 64)
}

bubble.addEventListener("click", () => toggle(true))
document.getElementById("close").addEventListener("click", () => toggle(false))

panel.addEventListener("submit", async (event) => {
  event.preventDefault()
  const submit = panel.querySelector('button[type="submit"]')
  submit.disabled = true
  try {
    const response = await fetch(`/api/plugin-public/${slug}/message?storeSlug=${encodeURIComponent(storeSlug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("name").value,
        email: document.getElementById("email").value,
        body: document.getElementById("body").value,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`)
    panel.reset()
    status.hidden = false
  } catch (error) {
    status.textContent = error.message
    status.style.color = "#dc2626"
    status.hidden = false
  } finally {
    submit.disabled = false
  }
})

resize(64, 64)
