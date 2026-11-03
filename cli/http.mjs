/**
 * Shared HTTP helpers for the local dev servers (`cli/plugin/dev/server.mjs`
 * and `cli/workspace-server.mjs`).
 *
 * Both servers are developer-facing tools that must only ever be reachable from
 * the machine they run on. `isLoopbackRequest` backs a Host-header guard that
 * defeats DNS-rebinding (a malicious page resolving its own name to 127.0.0.1),
 * and `normalizeDevHost` refuses to bind to a routable address.
 */

/** Largest request body either dev endpoint will read (bytes). */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

export function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  res.end(body)
}

export function html(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
  res.end(body)
}

/**
 * Reads and JSON-parses a request body. Resolves `empty` (default `null`) for a
 * bodyless request and resolves the raw string when the payload is not JSON.
 * Rejects — and destroys the socket — once the body exceeds `MAX_BODY_BYTES`,
 * so a hostile or runaway client cannot pin the server on a partial request.
 */
export function readBody(req, { empty = null, limit = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let data = ""
    let bytes = 0
    let settled = false

    const fail = (error) => {
      if (settled) return
      settled = true
      req.destroy()
      reject(error)
    }

    req.on("data", (chunk) => {
      if (settled) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > limit) {
        fail(new Error(`Request body exceeds ${Math.round(limit / 1024 / 1024)} MB`))
        return
      }
      data += chunk
    })
    req.on("end", () => {
      if (settled) return
      settled = true
      if (!data) return resolve(empty)
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve(data)
      }
    })
    req.on("error", fail)
  })
}

/** True for any address a browser on this machine reaches as "local". */
export function isLoopbackHostname(hostname) {
  const name = String(hostname ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
  if (!name) return false
  if (name === "localhost" || name === "::1" || name === "0:0:0:0:0:0:0:1") return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name)
}

/** Extracts the hostname from a `Host`/`Origin` header (IPv6 brackets handled). */
export function hostnameFromHeader(header) {
  const raw = String(header ?? "").trim()
  if (!raw) return ""
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]")
    return end === -1 ? raw.slice(1) : raw.slice(1, end)
  }
  return raw.split(":")[0]
}

/**
 * True when a request was addressed to a loopback hostname. Used to reject
 * requests whose Host header points at a real hostname that merely resolves to
 * 127.0.0.1 (DNS rebinding), which a loopback bind alone does not stop.
 */
export function isLoopbackRequest(req) {
  return isLoopbackHostname(hostnameFromHeader(req?.headers?.host))
}

/**
 * Resolves the address the dev server should listen on. Anything that is not a
 * loopback address (notably `0.0.0.0`, `::`, or a LAN hostname) is refused and
 * replaced with the loopback fallback, with a one-line explanation. The local
 * dev servers expose file write, `npm install` and a terminal — never routable.
 */
export function normalizeDevHost(host, { fallback = "127.0.0.1", log } = {}) {
  const value = String(host ?? "").trim()
  if (!value) return fallback
  if (isLoopbackHostname(value)) return value
  log?.(`ignoring host "${value}" — the dev server only listens on localhost (${fallback})`)
  return fallback
}
