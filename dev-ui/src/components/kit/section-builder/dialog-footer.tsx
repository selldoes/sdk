import { Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"

export function SectionBuilderFooter({
  saveError,
  confirmDiscard,
  hasEntry,
  saving,
  dirty,
  jsonError,
  onKeepEditing,
  onDiscard,
  onCancel,
  onSave,
}: {
  saveError: string | null
  confirmDiscard: boolean
  hasEntry: boolean
  saving: boolean
  dirty: boolean
  jsonError: string | null
  onKeepEditing: () => void
  onDiscard: () => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <DialogFooter className="flex-row items-center justify-between gap-3 space-x-0 border-t px-5 py-3">
      <div className="min-w-0 flex-1 text-[11.5px]">
        {saveError ? (
          <span className="text-destructive">{saveError}</span>
        ) : confirmDiscard ? (
          <span className="font-semibold text-destructive">Discard unsaved changes?</span>
        ) : (
          <span className="text-muted-foreground">
            {hasEntry
              ? "The page's iframe entry stays in plugin.json as a fallback for hosts without the kit."
              : "Saved to dashboardPages[].sections in plugin.json — validated and undoable."}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {confirmDiscard ? (
          <>
            <Button size="sm" variant="ghost" onClick={onKeepEditing}>
              Keep editing
            </Button>
            <Button size="sm" variant="destructive" onClick={onDiscard}>
              Discard
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={onSave} disabled={saving || !dirty || jsonError !== null}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? "Saving…" : "Save components"}
            </Button>
          </>
        )}
      </div>
    </DialogFooter>
  )
}
