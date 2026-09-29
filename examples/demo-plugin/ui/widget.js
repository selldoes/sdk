/**
 * Storefront widget for Demo Plugin.
 *
 * Mounted by the host in a small sandboxed iframe on every storefront page.
 * It may call the plugin's `publicRoutes` (no dashboard session); the store is
 * resolved from the `storeSlug` query param. Ask the host to resize the iframe
 * with a `selldesk:resize` postMessage when opening/closing.
 */
const params = new URLSearchParams(location.search)
const storeSlug = params.get("storeSlug") ?? ""
const segments = location.pathname.split("/").filter(Boolean)
const slug = segments[2] === "plugin-public" ? segments[3] : "demo-plugin"

const bubble = document.getElementById("bubble")
const panel = document.getElementById("panel")
let open = false
let greeting = null

function resize(width, height) {
  parent.postMessage({ type: "selldesk:resize", slug, width, height }, "*")
}

async function loadGreeting() {
  if (greeting) return greeting
  const response = await fetch(`/api/plugin-public/${slug}/hello?storeSlug=${encodeURIComponent(storeSlug)}`)
  const data = await response.json()
  greeting = data.greeting ?? "Hello!"
  return greeting
}

function render() {
  if (!open) {
    panel.hidden = true
    bubble.hidden = false
    resize(64, 64)
    return
  }
  bubble.hidden = true
  panel.hidden = false
  panel.innerHTML = `
    <strong>Demo Plugin</strong>
    <p>${greeting ?? "Loading…"}</p>
    <button type="button" id="close">Close</button>
  `
  document.getElementById("close")?.addEventListener("click", () => {
    open = false
    render()
  })
  resize(280, 150)
}

bubble.addEventListener("click", async () => {
  open = true
  render()
  try {
    await loadGreeting()
  } catch {
    greeting = "Could not reach the plugin route."
  }
  render()
})

render()
