import fs from "node:fs"
import path from "node:path"

/**
 * Builds the mock `ctx.files` capability. Files are written under
 * `<devDir>/files`; in live store mode `importFromUrl` passes the source URL
 * through so the platform can re-host it.
 */
export function createFiles({ filesDir, baseUrl, requirePermission, liveProducts, log }) {
  // Production hands out absolute media URLs (S3/CDN). The preview does the
  // same when it knows its own origin — a Node job that re-fetches the
  // artwork (a resize, a re-upload) needs a URL it can fetch.
  const base = () => {
    const value = typeof baseUrl === "function" ? baseUrl() : baseUrl
    return String(value ?? "").replace(/\/+$/, "")
  }
  const filesUrl = (key) => `${base()}/__dev/files/${encodeURIComponent(key)}`

  return {
    async upload({ name, data, folder }) {
      requirePermission("files:write", "ctx.files.upload")
      fs.mkdirSync(filesDir, { recursive: true })
      const safe = `${folder ? `${String(folder).replace(/[^a-z0-9_-]/gi, "_")}/` : ""}${String(name).replace(/[^a-z0-9._-]/gi, "_")}`
      const base64 = String(data).replace(/^data:[^;]+;base64,/, "")
      fs.mkdirSync(path.dirname(path.join(filesDir, safe)), { recursive: true })
      fs.writeFileSync(path.join(filesDir, safe), Buffer.from(base64, "base64"))
      const key = safe.replace(/\\/g, "/")
      return { url: filesUrl(key), key, size: fs.statSync(path.join(filesDir, safe)).size }
    },
    async importFromUrl({ url, name, folder }) {
      requirePermission("files:write", "ctx.files.importFromUrl")
      // Live store mode: keep the source URL — the platform re-hosts it
      // into store media when the product is written; a localhost dev URL
      // would be unreachable from there.
      if (liveProducts()) {
        log(`[live] files.importFromUrl → passthrough ${url}`)
        return { url, key: null, size: 0, passthrough: true }
      }
      const response = await fetch(url)
      const buffer = Buffer.from(await response.arrayBuffer())
      fs.mkdirSync(filesDir, { recursive: true })
      const safe = `${folder ? `${String(folder).replace(/[^a-z0-9_-]/gi, "_")}/` : ""}${String(name ?? path.basename(new URL(url).pathname)).replace(/[^a-z0-9._-]/gi, "_")}`
      fs.mkdirSync(path.dirname(path.join(filesDir, safe)), { recursive: true })
      fs.writeFileSync(path.join(filesDir, safe), buffer)
      const key = safe.replace(/\\/g, "/")
      return { url: filesUrl(key), key, size: buffer.length }
    },
    async list(prefix = "") {
      requirePermission("files:read", "ctx.files.list")
      if (!fs.existsSync(filesDir)) return []
      const out = []
      const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name)
          if (entry.isDirectory()) walk(full)
          else {
            const key = path.relative(filesDir, full).replace(/\\/g, "/")
            if (!prefix || key.startsWith(prefix)) out.push({ key, url: filesUrl(key), size: fs.statSync(full).size })
          }
        }
      }
      walk(filesDir)
      return out
    },
    async delete(key) {
      requirePermission("files:write", "ctx.files.delete")
      const target = path.join(filesDir, String(key))
      if (!target.startsWith(filesDir) || !fs.existsSync(target)) return { deleted: false }
      fs.rmSync(target)
      return { deleted: true }
    },
  }
}
