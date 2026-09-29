import fs from "node:fs"
import path from "node:path"

/** Extensions the preview accepts for icons and screenshots. */
export const ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"])

export const ASSET_FOLDERS = new Set(["assets", "screenshots"])

function sanitizeName(name) {
  const base = path.basename(String(name ?? "file"))
  const extension = path.extname(base).toLowerCase()
  const stem = path.basename(base, extension).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "file"
  return `${stem}${extension}`
}

/**
 * Writes a base64 upload into `<pluginDir>/<folder>/<name>`.
 * Returns the plugin-relative path (e.g. "screenshots/shot.png").
 */
export function saveAsset({ pluginDir, folder, name, data }) {
  const safeFolder = ASSET_FOLDERS.has(folder) ? folder : "assets"
  const safeName = sanitizeName(name)
  const extension = path.extname(safeName).toLowerCase()
  if (!ASSET_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported image type "${extension || "unknown"}" — use PNG, JPG, WebP, GIF, AVIF or SVG`)
  }
  const base64 = String(data ?? "").replace(/^data:[^;]+;base64,/, "")
  if (!base64) throw new Error("No file data received")
  const relative = `${safeFolder}/${safeName}`
  const full = path.resolve(pluginDir, relative)
  if (!full.startsWith(path.resolve(pluginDir) + path.sep)) throw new Error("Invalid asset path")
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, Buffer.from(base64, "base64"))
  return { path: relative, url: `/__dev/assets/${relative.split("/").map(encodeURIComponent).join("/")}` }
}

/** Resolves a plugin-relative path safely (no traversal, no dotfolders). */
export function resolveAsset(pluginDir, relative) {
  const clean = String(relative ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
  if (!clean || clean.split("/").some((part) => part === ".." || part.startsWith("."))) return null
  const full = path.resolve(pluginDir, clean)
  if (!full.startsWith(path.resolve(pluginDir) + path.sep)) return null
  return full
}

/** Deletes an uploaded asset, but only inside the plugin's asset folders. */
export function deleteAsset({ pluginDir, relative }) {
  const clean = String(relative ?? "").replace(/\\/g, "/")
  const top = clean.split("/")[0]
  if (!ASSET_FOLDERS.has(top)) throw new Error("Only assets/ and screenshots/ files can be deleted")
  const full = resolveAsset(pluginDir, clean)
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return { deleted: false }
  fs.rmSync(full, { force: true })
  return { deleted: true }
}
