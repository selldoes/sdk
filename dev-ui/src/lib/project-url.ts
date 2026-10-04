/**
 * Project-scoped URLs: `/{projectId}/{page}` — the first segment is the
 * project's internal id (YouTube-style: 11 random base64url chars, like a
 * video id) and doubles as the router basename, so in-app navigation stays
 * page-relative ("/settings" keeps whatever project the URL points at).
 */

/** First segment counts as a project id when it looks like one. */
const PROJECT_SEGMENT = /^[A-Za-z0-9_-]{6,32}$/

/** The project id in the current URL, or null at the bare root. */
export function urlProjectId(): string | null {
  const [first] = window.location.pathname.split("/").filter(Boolean)
  // "assets" (and friends) are built-file segments, never project ids.
  return first && first !== "assets" && PROJECT_SEGMENT.test(first) ? first : null
}

/** The page part of the current URL ("/settings", "/" at the bare root). */
export function urlPage(): string {
  const id = urlProjectId()
  const rest = id ? window.location.pathname.slice(id.length + 1) : window.location.pathname
  return rest.startsWith("/") ? rest : `/${rest}`
}
