/** Builds the mock `ctx.http` capability (permission-gated `fetch` with a 60s cap). */
export function createHttp({ requirePermission }) {
  async function httpRequest(method, url, body, headers, opts) {
    requirePermission("api:external", "ctx.http")
    // 60s default/cap — scraping via apiraven (waitUntil=load) needs the headroom.
    const requested = Number(opts?.timeoutMs)
    const timeoutMs = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : 60_000, 1_000), 60_000)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method,
        headers: { ...(headers ?? {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      const text = await response.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
      return { status: response.status, data }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async get(url, headers, opts) {
      return httpRequest("GET", url, undefined, headers, opts)
    },
    async post(url, body, headers, opts) {
      return httpRequest("POST", url, body, headers, opts)
    },
  }
}
