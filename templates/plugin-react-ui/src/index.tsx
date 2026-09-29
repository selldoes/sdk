/**
 * Dashboard UI for __PLUGIN_NAME__ — React + TypeScript.
 *
 * The host renders this page in a sandboxed, same-origin iframe and appends
 * `?storeId=…&storeSlug=…`. API calls go to the plugin's declared routes where
 * the server enforces store ownership and permissions.
 *
 * `ui/src/**` is bundled by `selldoes build` / `selldoes dev` with esbuild into
 * `ui/assets/index.js` (+ `assets/index.css` when you import CSS). There is no
 * separate Vite/webpack step — edit files and the preview rebuilds.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react"
import "./styles.css"

const params = new URLSearchParams(location.search)
const storeId = params.get("storeId")
const storeSlug = params.get("storeSlug")
const scope = storeId ? `storeId=${encodeURIComponent(storeId)}` : `storeSlug=${encodeURIComponent(storeSlug ?? "")}`
const BASE = "/api/plugin-api/__PLUGIN_SLUG__"

interface Note {
  id: number
  body: string
}

interface ApiError {
  error?: string
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}?${scope}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  const body = (await response.json().catch(() => ({}))) as T & ApiError
  if (!response.ok || (body as { ok?: boolean }).ok === false) {
    throw new Error(body.error || `Request failed (${response.status})`)
  }
  return body
}

export default function PluginUi() {
  const [notes, setNotes] = useState<Note[]>([])
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ notes: Note[] }>("/notes")
      setNotes(data.notes)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function add(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!body) return
    setDraft("")
    try {
      await api("/notes", { method: "POST", body: JSON.stringify({ body }) })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function remove(id: number) {
    try {
      await api(`/notes?id=${id}`, { method: "DELETE" })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <main className="plugin">
      <header>
        <h1>__PLUGIN_NAME__</h1>
        <p className="muted">React dashboard UI, rendered in a sandboxed iframe.</p>
      </header>

      <form onSubmit={add}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a note…" required />
        <button type="submit">Add</button>
      </form>

      {error ? <p className="error">{error}</p> : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul>
          {notes.length === 0 ? (
            <li className="empty muted">No notes yet.</li>
          ) : (
            notes.map((note) => (
              <li key={note.id}>
                <span>{note.body}</span>
                <button type="button" title="Delete" onClick={() => void remove(note.id)}>
                  ×
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </main>
  )
}
