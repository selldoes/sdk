import * as React from "react"
import { dev } from "@/lib/api"
import type { PluginManifest, Validation } from "@/lib/types"
import { useApp } from "@/state/app"

function shallowEqual(a: PluginManifest, b: PluginManifest) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Shared plugin.json draft editing — the Details and Permissions pages both
 * write to the manifest, so dirty tracking, save, undo and validation status
 * live here once instead of being copy-pasted per page.
 */
export function useManifestDraft({ label }: { label: string }) {
  const { bootstrap, refresh, applyManifest, toast } = useApp()
  const initial = bootstrap!.manifest
  const validation: Validation = bootstrap!.validation
  const snapshots = bootstrap!.snapshots
  const [manifest, setManifest] = React.useState<PluginManifest>(initial)
  const [saving, setSaving] = React.useState(false)
  const [savedAt, setSavedAt] = React.useState<string | null>(null)
  const dirty = !shallowEqual(manifest, initial)

  const set = (patch: Partial<PluginManifest>) => setManifest((previous) => ({ ...previous, ...patch }))

  const save = async () => {
    setSaving(true)
    try {
      const result = await dev.saveManifest({ ...manifest, tags: manifest.tags ?? [] })
      applyManifest(result.manifest, result.validation)
      setManifest(result.manifest)
      setSavedAt(new Date().toLocaleTimeString())
      if (result.validation.errors.length) toast("Saved with validation errors", "error")
      else toast(`${label} saved — preview rebuilt`, "success")
      await refresh()
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setSaving(false)
    }
  }

  const undo = async () => {
    if (!window.confirm("Restore plugin.json from the last save?")) return
    try {
      await dev.undoManifest()
      await refresh()
      toast("Restored the previous plugin.json", "success")
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }

  return { manifest, set, setManifest, dirty, saving, savedAt, save, undo, validation, snapshots }
}

export type ManifestDraft = ReturnType<typeof useManifestDraft>
