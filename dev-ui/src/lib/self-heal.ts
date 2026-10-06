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
  /** Capability that needed it, e.g. "ctx.http". */
  action?: string
}

export function parseMissingDeclaration(error: string): MissingDeclaration | null {
  const permission = /Missing permission "([^"]+)" required for ([^.]+)\./.exec(error)
  if (permission) return { kind: "permission", value: permission[1], action: permission[2] }
  const table = /Table "([^"]+)" is not declared in plugin\.json "allowedTables"\./.exec(error)
  if (table) return { kind: "table", value: table[1] }
  return null
}

/**
 * Heals a missing permission/allowedTables declaration: patches the manifest,
 * saves plugin.json (idempotent server-side) and refreshes the shell. Always
 * returns true — the caller should retry the action once regardless, since the
 * client's view of plugin.json can lag the disk (stale bootstrap, HMR).
 */
export async function healMissingDeclaration(
  missing: MissingDeclaration,
  deps: {
    manifest: PluginManifest
    applyManifest: (manifest: PluginManifest, validation: Validation) => void
    refresh: () => Promise<void>
    toast: (message: string, type: "success" | "error") => void
  },
): Promise<boolean> {
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
    return true
  }
  const declared = manifest.allowedTables ?? []
  const alreadyThere = declared.includes(missing.value)
  const saved = await dev.saveManifest(alreadyThere ? manifest : { ...manifest, allowedTables: [...declared, missing.value] })
  applyManifest(saved.manifest, saved.validation)
  await refresh()
  if (!alreadyThere) {
    toast(`Added table "${missing.value}" to allowedTables — re-running`, "success")
  }
  return true
}
