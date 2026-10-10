import type { PluginManifest, Validation } from "@/lib/types"
import { dev } from "@/lib/api"

/**
 * Dev-sandbox self-heal for the mock context's declaration checks
 * (`cli/plugin/dev/mock-context.mjs` re-reads plugin.json on every capability
 * check, so a missing declaration can be added and the action retried
 * immediately — no restart, no page-hopping through the Permissions editor).
 *
 * When a job run / hook fire / API call fails with "Missing permission …" or
 * "Table … is not declared", the calling page adds the declaration to the
 * in-memory manifest, saves plugin.json, refreshes the shell and tells the
 * developer what happened — then the caller retries the action once.
 */

interface MissingDeclaration {
  kind: "permission" | "table"
  value: string
  /** Capability that needed it, e.g. "ctx.http" (dots are part of the name). */
  action?: string
}

export function parseMissingDeclaration(error: string): MissingDeclaration | null {
  // Non-greedy up to the sentence-ending period: the action itself contains
  // dots ("ctx.http", 'ctx.db read on "products"'), so stop at ". " / end.
  const permission = /Missing permission "([^"]+)" required for (.+?)\.?(?:\s|$)/.exec(error)
  if (permission) return { kind: "permission", value: permission[1], action: permission[2] }
  const table = /Table "([^"]+)" is not declared in plugin\.json "allowedTables"\./.exec(error)
  if (table) return { kind: "table", value: table[1] }
  return null
}

export interface HealOutcome {
  /**
   * False when plugin.json already declared the permission/table — nothing was
   * written. A still-refused capability with `changed: false` means the running
   * dev server was started before the declaration existed (it read plugin.json
   * once at boot), so it needs a restart, not another retry.
   */
  changed: boolean
}

/**
 * Heals a missing permission/allowedTables declaration: patches the manifest,
 * saves plugin.json (idempotent server-side) and refreshes the shell. Callers
 * should retry the action once regardless — the client's view of plugin.json
 * can lag the disk (stale bootstrap, HMR) — but check `changed` to tell whether
 * this call actually wrote a declaration or found it already present.
 */
export async function healMissingDeclaration(
  missing: MissingDeclaration,
  deps: {
    manifest: PluginManifest
    applyManifest: (manifest: PluginManifest, validation: Validation) => void
    refresh: () => Promise<void>
    toast: (message: string, type: "success" | "error") => void
  },
): Promise<HealOutcome> {
  const { manifest, applyManifest, refresh, toast } = deps
  if (missing.kind === "permission") {
    const declared = (manifest.permissions ?? []) as string[]
    const alreadyThere = declared.includes(missing.value)
    const saved = await dev.saveManifest(alreadyThere ? manifest : { ...manifest, permissions: [...declared, missing.value] })
    applyManifest(saved.manifest, saved.validation)
    await refresh()
    if (!alreadyThere) {
      toast(`Added "${missing.value}"${missing.action ? ` (needed for ${missing.action})` : ""} to plugin.json — re-running`, "success")
    }
    return { changed: !alreadyThere }
  }
  const declared = manifest.allowedTables ?? []
  const alreadyThere = declared.includes(missing.value)
  const saved = await dev.saveManifest(alreadyThere ? manifest : { ...manifest, allowedTables: [...declared, missing.value] })
  applyManifest(saved.manifest, saved.validation)
  await refresh()
  if (!alreadyThere) {
    toast(`Added table "${missing.value}" to allowedTables — re-running`, "success")
  }
  return { changed: !alreadyThere }
}
