import * as React from "react"
import { Check, Loader2, RefreshCw } from "lucide-react"
import { Callout } from "@/components/shared"
import { Button } from "@/components/ui/button"
import type { ManifestDraft } from "@/lib/use-manifest-draft"

/** Sticky save/undo bar for plugin.json editors (Details, Permissions). */
export function ManifestSaveBar({ draft, saveLabel = "Save plugin.json" }: { draft: ManifestDraft; saveLabel?: string }) {
  const { dirty, saving, savedAt, save, undo, validation, snapshots } = draft
  return (
    <div className="sticky bottom-4 z-20 rounded-xl border border-primary/35 bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center gap-2.5">
        <Button onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
          {saveLabel}
        </Button>
        <Button variant="outline" onClick={() => void undo()} disabled={snapshots === 0}>
          <RefreshCw />
          Undo last save{snapshots ? ` (${snapshots})` : ""}
        </Button>
        <span className="ml-auto text-[11.5px] text-muted-foreground">
          {dirty
            ? "Unsaved changes"
            : savedAt
              ? `Saved ${savedAt} ✓`
              : validation.errors.length
                ? `${validation.errors.length} validation error(s)`
                : "Valid"}
        </span>
      </div>
      {validation.errors.length > 0 ? (
        <Callout kind="danger" className="mt-2.5">
          <p className="font-semibold">plugin.json is not valid yet:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </div>
  )
}
