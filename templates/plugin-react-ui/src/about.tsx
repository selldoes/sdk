/**
 * Second dashboard page for __PLUGIN_NAME__ — React + TypeScript.
 *
 * `ui/src/about.tsx` is bundled by `selldoes build` / `selldoes dev` into
 * `ui/assets/about.js` because `dashboardPages[1].entry` points at
 * `ui/about.html`. Add another page the same way: a `.html` shell in `ui/`,
 * a matching `ui/src/<name>.tsx`, and a `dashboardPages` entry.
 */
import { useCallback, useEffect, useState } from "react"
import "./styles.css"

const params = new URLSearchParams(location.search)
const storeId = params.get("storeId")
const storeSlug = params.get("storeSlug")
const scope = storeId ? `storeId=${encodeURIComponent(storeId)}` : `storeSlug=${encodeURIComponent(storeSlug ?? "")}`
const BASE = "/api/plugin-api/__PLUGIN_SLUG__"

export default function AboutPage() {
  const [noteCount, setNoteCount] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${BASE}/notes?${scope}`, { headers: { "Content-Type": "application/json" } })
      const body = (await response.json().catch(() => ({}))) as { notes?: unknown[] }
      setNoteCount(Array.isArray(body.notes) ? body.notes.length : 0)
    } catch {
      setNoteCount(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <main className="plugin">
      <header>
        <h1>About __PLUGIN_NAME__</h1>
        <p className="muted">
          Second dashboard page — <code>dashboardPages[1].entry</code> points at <code>ui/about.html</code>, bundled from{" "}
          <code>ui/src/about.tsx</code> to <code>assets/about.js</code>.
        </p>
      </header>

      <ul>
        <li>
          <span>
            <strong>Page 1</strong> — <code>ui/index.html</code> ← <code>ui/src/index.tsx</code>: the notes example.
          </span>
        </li>
        <li>
          <span>
            <strong>Page 2</strong> — this page: <code>ui/about.html</code> ← <code>ui/src/about.tsx</code>. It reads the same notes API —{" "}
            {noteCount === null ? "…" : `${noteCount} note(s)`} so far.
          </span>
        </li>
        <li>
          <span>
            <strong>Next</strong> — add <code>ui/src/&lt;name&gt;.tsx</code> + <code>ui/&lt;name&gt;.html</code> and declare it in{" "}
            <code>dashboardPages</code>.
          </span>
        </li>
      </ul>
    </main>
  )
}
