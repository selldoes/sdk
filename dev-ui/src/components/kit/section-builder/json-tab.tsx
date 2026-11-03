import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function SectionsJsonTab({
  jsonText,
  jsonError,
  draftLength,
  onJsonChange,
  onFormat,
}: {
  jsonText: string
  jsonError: string | null
  draftLength: number
  onJsonChange: (text: string) => void
  onFormat: () => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-4xl space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Raw <code>dashboardPages[].sections</code> — edits here apply live to the canvas.
          </p>
          <Button size="sm" variant="outline" onClick={onFormat}>
            Format
          </Button>
        </div>
        <Textarea
          value={jsonText}
          onChange={(event) => onJsonChange(event.target.value)}
          rows={24}
          className="font-mono text-[12px]"
          placeholder='[{ "type": "stats", "settings": { "items": [{ "label": "Jobs", "value": "3" }] } }]'
        />
        {jsonError ? (
          <p className="text-[12px] text-destructive">Invalid JSON: {jsonError}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">{draftLength} component(s)</p>
        )}
      </div>
    </div>
  )
}
