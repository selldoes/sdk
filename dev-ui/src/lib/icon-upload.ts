import { readFileBase64 } from "@/lib/api"

/**
 * Client-side prep for a custom project icon: validates the file, reads it as
 * base64 (what the workspace create/asset endpoints expect) and checks the
 * dimensions so we can warn before it ships.
 */

export const ICON_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml"
export const MAX_ICON_BYTES = 1024 * 1024
export const ICON_GUIDE = "Square PNG, WebP or SVG — 512 × 512 px recommended (min 128 × 128), max 1 MB. Shown at 40 × 40."

const ALLOWED = /\.(png|jpe?g|webp|svg)$/i

export interface PreparedIcon {
  name: string
  /** base64 without the data: prefix. */
  data: string
  /** data: URL for previews. */
  preview: string
  warning?: string
}

export async function prepareIconFile(file: File): Promise<PreparedIcon> {
  if (!ALLOWED.test(file.name)) throw new Error("Use a PNG, WebP, JPEG or SVG image")
  if (file.size > MAX_ICON_BYTES) throw new Error("Icons must be 1 MB or smaller")
  const data = await readFileBase64(file)
  const preview = `data:${file.type || "image/png"};base64,${data}`
  const warning = await dimensionWarning(preview, file.name)
  return { name: file.name, data, preview, warning }
}

function dimensionWarning(preview: string, name: string): Promise<string | undefined> {
  // SVGs are resolution-independent; skip the pixel check.
  if (/\.svg$/i.test(name)) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (width && height && width !== height) resolve(`Icons look best square — this one is ${width} × ${height} px.`)
      else if (width && width < 128) resolve(`That image is small (${width} px wide); 512 × 512 is recommended.`)
      else resolve(undefined)
    }
    image.onerror = () => resolve(undefined)
    image.src = preview
  })
}
