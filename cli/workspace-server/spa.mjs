import fs from "node:fs"
import path from "node:path"
import { contentTypeFor } from "../util.mjs"
import { UI_CSP, UI_DIST } from "./paths.mjs"
import { html } from "./respond.mjs"

/** Serves the built SPA (ui-dist) with an index.html fallback. */
export function serveSpa(res, pathname, { devMiddleware } = {}) {
  if (devMiddleware) return null // caller delegates to Vite
  // URLs are /<projectId>/<page> — asset requests (/assets/…) resolve against
  // ui-dist by full pathname; anything else falls back to the SPA shell.
  const requested = pathname.replace(/^\//, "")
  const candidate = requested ? path.join(UI_DIST, ...requested.split("/")) : path.join(UI_DIST, "index.html")
  const root = path.resolve(UI_DIST)
  const relative = path.relative(root, path.resolve(candidate))
  // `path.relative` avoids the sibling-prefix trap startsWith() has (e.g. ui-dist-evil).
  const safe = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  if (safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    res.writeHead(200, {
      "Content-Type": contentTypeFor(candidate),
      "Cache-Control": "no-store",
      "Content-Security-Policy": UI_CSP,
    })
    fs.createReadStream(candidate).pipe(res)
    return true
  }
  const index = path.join(UI_DIST, "index.html")
  if (!fs.existsSync(index)) {
    return html(res, 500, "Workspace UI is not built. Run `npm run build:dev-ui` in the SDK repo.")
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": UI_CSP,
  })
  fs.createReadStream(index).pipe(res)
  return true
}
