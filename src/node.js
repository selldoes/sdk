// @ts-check
/**
 * `selldoes/node` — helpers for `"runtime": "node"` job entries.
 *
 * These functions use real Node packages (`sharp`, `playwright-core`,
 * `@sparticuz/chromium`) that the platform installs from your plugin's
 * lockfile. Import them **only** from a Node entry (`server/*.js`); the CLI
 * rejects `selldoes/node` inside the QuickJS bundle with a clear error.
 *
 * Add the packages a helper needs before using it:
 *
 *   selldoes add sharp
 *   selldoes add playwright-core @sparticuz/chromium
 */

/**
 * @typedef {object} NormalizeImageOptions
 * @property {number} [size=1600]            Output edge length in pixels.
 * @property {number} [quality=92]           Codec quality (webp/jpeg).
 * @property {"webp" | "png" | "jpeg"} [format="webp"]
 * @property {string} [background="#ffffff"] Letterbox / flatten color.
 */

/**
 * @typedef {object} FetchOptions
 * @property {Record<string, string>} [headers]
 * @property {number} [timeoutMs=30000]
 * @property {number} [maxBytes=15 * 1024 * 1024]
 * @property {string} [userAgent]
 */

/**
 * @typedef {object} FetchResult
 * @property {Buffer} data
 * @property {string} contentType
 * @property {number} status
 */

/**
 * @typedef {object} Page
 * @property {(url: string, options?: unknown) => Promise<unknown>} goto
 * @property {() => Promise<string>} content
 * @property {() => Promise<void>} close
 */

/**
 * @typedef {object} Browser
 * @property {(options?: unknown) => Promise<Page>} newPage
 * @property {() => Promise<void>} close
 */

/**
 * @typedef {object} LaunchBrowserOptions
 * @property {boolean} [headless=true]
 * @property {string} [executablePath]  Explicit Chromium/Chrome binary.
 * @property {string[]} [args]
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/** @param {unknown} input */
function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof ArrayBuffer) return Buffer.from(input)
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  throw new Error("normalizeImage expects a Buffer, Uint8Array or ArrayBuffer")
}

/**
 * Resizes an image to an exact square canvas on a solid background — the
 * standard product-image treatment for imports (1600×1600 WebP by default).
 *
 * @param {Buffer | Uint8Array | ArrayBuffer} input
 * @param {NormalizeImageOptions} [options]
 * @returns {Promise<Buffer>}
 */
export async function normalizeImage(input, options = {}) {
  const sharp = await loadOptional("sharp", "selldoes add sharp", () => import("sharp"))
  const size = Number(options.size) > 0 ? Math.trunc(Number(options.size)) : 1600
  const quality = Number(options.quality) > 0 ? Math.trunc(Number(options.quality)) : 92
  const background = options.background ?? "#ffffff"
  const format = options.format ?? "webp"

  let pipeline = sharp(toBuffer(input))
    .resize(size, size, { fit: "contain", background, kernel: sharp.kernel.lanczos3 })
    .flatten({ background })
  if (format === "png") pipeline = pipeline.png({ compressionLevel: 9 })
  else if (format === "jpeg") pipeline = pipeline.jpeg({ quality })
  else pipeline = pipeline.webp({ quality })
  return pipeline.toBuffer()
}

/**
 * `fetch` for binaries: browser user agent, timeout, size guard and a content
 * type that is never HTML/JSON (so an error page can't be mistaken for an
 * image).
 *
 * @param {string} url
 * @param {FetchOptions} [options]
 * @returns {Promise<FetchResult>}
 */
export async function fetchBuffer(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Math.trunc(Number(options.timeoutMs)) : 30_000
  const maxBytes = Number(options.maxBytes) > 0 ? Math.trunc(Number(options.maxBytes)) : 15 * 1024 * 1024
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": options.userAgent ?? BROWSER_UA, Accept: "*/*", ...(options.headers ?? {}) },
      signal: controller.signal,
      redirect: "follow",
    })
    if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`)
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim()
    if (contentType === "text/html" || contentType === "application/json") {
      throw new Error(`GET ${url} returned ${contentType} — expected a binary response`)
    }
    const declared = Number(response.headers.get("content-length") ?? 0)
    if (declared > maxBytes) throw new Error(`GET ${url} is ${declared} bytes — over the ${maxBytes} byte limit`)
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length > maxBytes) throw new Error(`GET ${url} is ${data.length} bytes — over the ${maxBytes} byte limit`)
    return { data, contentType, status: response.status }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `fetch` for text (HTML/XML/CSV). Unlike `ctx.http` this runs in the Node
 * sandbox with no response-size cap — use it for large listing pages.
 *
 * @param {string} url
 * @param {FetchOptions} [options]
 * @returns {Promise<string>}
 */
export async function fetchText(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Math.trunc(Number(options.timeoutMs)) : 30_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": options.userAgent ?? BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
      redirect: "follow",
    })
    if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Launches headless Chromium with `playwright-core`.
 *
 * Locally (and on hosts with browsers installed) it uses Playwright's own
 * browser. On AWS Lambda it falls back to `@sparticuz/chromium`'s packaged
 * browser, so the same entry works in both places:
 *
 *   const browser = await launchBrowser()
 *   const page = await browser.newPage()
 *   await page.goto(url, { waitUntil: "networkidle" })
 *   await browser.close()
 *
 * @param {LaunchBrowserOptions} [options]
 * @returns {Promise<Browser>}
 */
export async function launchBrowser(options = {}) {
  const playwright = await loadOptional("playwright-core", "selldoes add playwright-core", () => import("playwright-core"))
  let executablePath = options.executablePath
  let args = options.args ?? []
  if (!executablePath && process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = await loadOptional("@sparticuz/chromium", "selldoes add @sparticuz/chromium", () => import("@sparticuz/chromium"))
    executablePath = await chromium.executablePath()
    args = [...chromium.args, ...args]
  }
  return playwright.chromium.launch({
    headless: options.headless ?? true,
    executablePath,
    args,
  })
}

/**
 * Loads an optional peer dependency with an actionable error when it was never
 * installed (`selldoes add <name>` declares it in plugin.json too).
 *
 * @template T
 * @param {string} name
 * @param {string} hint
 * @param {() => Promise<unknown>} loader Lazy `import("…")` — a literal so the
 *   build records the package and the CLI can validate `plugin.json`.
 * @returns {Promise<T>}
 */
async function loadOptional(name, hint, loader) {
  try {
    const mod = /** @type {any} */ (await loader())
    return /** @type {T} */ (mod.default ?? mod)
  } catch (error) {
    throw new Error(`"${name}" is required for this helper — run \`${hint}\` and redeploy (Node jobs only). ${error instanceof Error ? error.message : String(error)}`)
  }
}
