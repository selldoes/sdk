/**
 * Heuristic permission scan — greps the plugin's source (and manifest) for
 * capability calls and reports which permissions the plugin would need at
 * runtime, plus declared permissions it never saw used. Used by the
 * "Scan code" card on the Permissions page; the host sandbox enforces
 * exactly these mappings (see the CLI's mock-context / the platform's
 * sandbox).
 *
 * Accuracy notes:
 * - Only real code files are considered (.js/.ts/…) — READMEs, plugin.json
 *   and HTML/CSS are ignored, so docs that merely mention `ctx.db.select(`
 *   don't count as usage.
 * - Comment-only lines are skipped, and trailing `//` comments are stripped
 *   before matching.
 * - Both `ctx.db.select(…)` and destructured forms (`const { db } = ctx`
 *   then `db.select(…)`, or `const db = ctx.db`) are detected; bare calls
 *   only count inside files that destructured the capability from ctx.
 * - `unused` (declared but never seen) is heuristic: permissions with no
 *   ctx surface (`webhooks:register`) or that come from the manifest itself
 *   are excluded, and the result is marked unreliable if the server-side
 *   search hit its result cap.
 */

import { dev } from "./api"
import type { PluginManifest, PluginPermission } from "./types"

export interface PermissionEvidence {
  path: string
  line: number
}

export interface DetectedPermission {
  permission: PluginPermission
  /** Where the usage was found (bounded per file). */
  evidence: PermissionEvidence[]
}

export interface PermissionScanResult {
  /** Permissions the code needs but plugin.json does not declare yet. */
  missing: DetectedPermission[]
  /** Permissions the code needs and plugin.json already declares. */
  satisfied: DetectedPermission[]
  /** Declared permissions the scan never saw used (possible over-request). */
  unused: PluginPermission[]
  filesScanned: number
  truncated: boolean
  /** False when truncation may have hidden usages — don't trust `unused`. */
  unusedReliable: boolean
}

/** ctx capability → method → the permission the sandbox requires for it. */
const METHOD_PERMISSIONS: Record<string, Record<string, PluginPermission>> = {
  db: {
    select: "db:read",
    count: "db:read",
    insert: "db:write",
    insertMany: "db:write",
    update: "db:write",
    delete: "db:write",
    ensureTable: "db:schema",
  },
  http: { get: "api:external", post: "api:external" },
  ai: { complete: "ai:use", image: "ai:use" },
  email: { send: "email:send" },
  files: { list: "files:read", upload: "files:write", importFromUrl: "files:write", delete: "files:write" },
  products: {
    get: "products:read",
    list: "products:read",
    findBySku: "products:read",
    create: "products:write",
    update: "products:write",
    upsertBySku: "products:write",
  },
  realtime: { publish: "realtime:publish" }, // poll needs no permission
  secrets: { get: "secrets:read" },
  storage: { get: "storage:read", list: "storage:read", set: "storage:write", delete: "storage:write" },
}

const CAPABILITY_NAMES = Object.keys(METHOD_PERMISSIONS).join("|")

/** `ctx.db.select(` / `context.ai.complete(` — explicit capability calls. */
const EXPLICIT_CALL = new RegExp(String.raw`\b(?:ctx|context)\s*\.\s*(${CAPABILITY_NAMES})\s*\.\s*([A-Za-z]+)\s*\(`, "g")

/** `db.select(` — possibly a destructured capability, gated per file below. */
const BARE_CALL = new RegExp(String.raw`\b(${CAPABILITY_NAMES})\s*\.\s*([A-Za-z]+)\s*\(`)

/** `const { db, http } = ctx` — which capabilities a file destructures. */
const DESTRUCTURE = new RegExp(
  String.raw`\{[^}]*\b(${CAPABILITY_NAMES})\b[^}]*\}\s*=\s*(?:ctx|context)\b`,
  "g",
)

/** `const db = ctx.db` — aliased capability object. */
const ALIAS = new RegExp(String.raw`\b(${CAPABILITY_NAMES})\s*=\s*(?:ctx|context)\s*\.\s*(${CAPABILITY_NAMES})\b`, "g")

/** Only these count as source — keeps READMEs/docs/plugin.json out. */
const CODE_FILE = /\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts)$/i

/** No ctx surface exists for these, so "declared but unused" can't apply. */
const UNDETECTABLE: PluginPermission[] = ["webhooks:register"]

/** Capabilities implied by the manifest itself (not ctx calls). */
const MANIFEST_ONLY: PluginPermission[] = ["dashboard:pages", "sections:register"]

const MAX_EVIDENCE_PER_PERMISSION = 5
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#|<!--|--)/

/** Strips trailing `//` comments so example calls inside them don't count. */
function stripLineComment(line: string): string {
  const index = line.indexOf("//")
  return index >= 0 ? line.slice(0, index) : line
}

/** Capabilities a file pulls out of ctx (`const { db } = ctx` / `const db = ctx.db`). */
function fileDestructured(preview: string): Set<string> {
  const found = new Set<string>()
  for (const match of preview.matchAll(DESTRUCTURE)) found.add(match[1])
  for (const match of preview.matchAll(ALIAS)) {
    if (match[1] === match[2]) found.add(match[1])
  }
  return found
}

function record(
  needs: Map<PluginPermission, PermissionEvidence[]>,
  permission: PluginPermission,
  path: string,
  line: number,
) {
  const evidence = needs.get(permission) ?? []
  if (evidence.length < MAX_EVIDENCE_PER_PERMISSION && !evidence.some((hit) => hit.path === path && hit.line === line)) {
    evidence.push({ path, line })
  }
  needs.set(permission, evidence)
}

/** Permissions implied by the manifest itself (sections/pages, not code). */
function manifestNeeds(manifest: PluginManifest): Map<PluginPermission, PermissionEvidence[]> {
  const needs = new Map<PluginPermission, PermissionEvidence[]>()
  const add = (permission: PluginPermission) => needs.set(permission, [{ path: "plugin.json", line: 0 }])
  if ((manifest.dashboardPages ?? []).length > 0 || manifest.ui?.entry) add("dashboard:pages")
  if ((manifest.sections ?? []).length > 0) add("sections:register")
  return needs
}

/**
 * Greps the project (via the dev server's search, which skips node_modules
 * and dist) for capability calls, then diffs the result against the manifest.
 */
export async function scanPermissions(manifest: PluginManifest): Promise<PermissionScanResult> {
  // One broad pass matches both `ctx.db.select(` and bare `db.select(`.
  const search = await dev.search(`\\b(?:ctx|context)\\s*\\.\\s*(?:${CAPABILITY_NAMES})|\\b(?:${CAPABILITY_NAMES})\\s*\\.`, {
    regex: true,
  })
  const needs = new Map<PluginPermission, PermissionEvidence[]>()
  const destructuredByFile = new Map<string, Set<string>>()
  const seen = new Set<string>()

  for (const hit of search.hits) {
    if (!CODE_FILE.test(hit.path)) continue
    if (COMMENT_LINE.test(hit.preview)) continue
    const code = stripLineComment(hit.preview)

    let match: RegExpExecArray | null
    EXPLICIT_CALL.lastIndex = 0
    while ((match = EXPLICIT_CALL.exec(code))) {
      const permission = METHOD_PERMISSIONS[match[1]]?.[match[2]]
      if (!permission) continue // unknown method — not a permission event
      record(needs, permission, hit.path, hit.line)
      seen.add(`${hit.path}:${hit.line}:${match[1]}.${match[2]}`)
    }

    // Remember destructures so bare calls in the same file can be credited.
    const destructured = fileDestructured(code)
    if (destructured.size > 0) {
      const known = destructuredByFile.get(hit.path) ?? new Set<string>()
      for (const name of destructured) known.add(name)
      destructuredByFile.set(hit.path, known)
    }

    const bare = code.match(BARE_CALL)
    if (bare && !new RegExp(String.raw`(?:ctx|context)\s*\.\s*${bare[1]}`).test(code)) {
      const allowed = destructuredByFile.get(hit.path)
      if (allowed?.has(bare[1])) {
        const permission = METHOD_PERMISSIONS[bare[1]]?.[bare[2]]
        const key = `${hit.path}:${hit.line}:${bare[1]}.${bare[2]}`
        if (permission && !seen.has(key)) {
          record(needs, permission, hit.path, hit.line)
          seen.add(key)
        }
      }
    }
  }

  // Manifest-implied permissions fill in the gaps code can't show
  // (dashboard:pages / sections:register come from plugin.json, not ctx calls).
  for (const [permission, evidence] of manifestNeeds(manifest)) {
    if (!needs.has(permission)) needs.set(permission, evidence)
  }

  const declared = new Set((manifest.permissions ?? []) as PluginPermission[])
  const missing: DetectedPermission[] = []
  const satisfied: DetectedPermission[] = []
  for (const [permission, evidence] of needs) {
    if (declared.has(permission)) satisfied.push({ permission, evidence })
    else missing.push({ permission, evidence })
  }
  const unused = [...declared].filter(
    (permission) => !needs.has(permission) && !UNDETECTABLE.includes(permission) && !MANIFEST_ONLY.includes(permission),
  )

  return {
    missing: missing.sort((a, b) => a.permission.localeCompare(b.permission)),
    satisfied: satisfied.sort((a, b) => a.permission.localeCompare(b.permission)),
    unused,
    filesScanned: search.files,
    truncated: search.truncated,
    // With truncation the search may have stopped early, so an "unused"
    // permission could simply live in a file that was never reached.
    unusedReliable: !search.truncated,
  }
}
