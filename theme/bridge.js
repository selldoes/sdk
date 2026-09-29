const PROTOCOL_SOURCE = "selldesk"

/**
 * Connects this template to its host (the storefront page in production, the
 * local dev server's preview in development). Both implement the same protocol:
 *
 * - host → template: `{ source: "selldesk", type: "init", payload }`
 * - template → host: `{ source: "selldesk", type: "fetch", id, url, method, body }`
 * - host → template: `{ source: "selldesk", type: "fetch:result", id, ok, status, data }`
 *
 * The template never makes its own network requests — all data flows through
 * the host, which only allows /api/store/* paths.
 */
export function createStorefrontBridge() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Bridge timeout: the host did not initialize the template")),
      15000
    )

    let payload = null
    const pendingFetches = new Map()
    let fetchId = 0

    function send(message) {
      window.parent.postMessage({ source: PROTOCOL_SOURCE, ...message }, "*")
    }

    function apiFetch(url, options = {}) {
      return new Promise((res, rej) => {
        const id = String(++fetchId)
        pendingFetches.set(id, { resolve: res, reject: rej })
        send({
          type: "fetch",
          id,
          url,
          method: options.method || "GET",
          body: options.body || undefined,
          headers: options.headers || {},
        })
      })
    }

    function handleMessage(event) {
      const data = event.data || {}
      if (data.source !== PROTOCOL_SOURCE) return

      if (data.type === "init") {
        payload = data.payload || {}
        clearTimeout(timeout)
        window.removeEventListener("message", handleMessage)
        resolve({ payload, apiFetch })
      } else if (data.type === "fetch:result") {
        const entry = pendingFetches.get(data.id)
        if (!entry) return
        pendingFetches.delete(data.id)
        if (!data.ok) entry.reject(new Error(`Request failed (${data.status})`))
        else entry.resolve(data.data)
      }
    }

    window.addEventListener("message", handleMessage)
    send({ type: "ready" })
  })
}
