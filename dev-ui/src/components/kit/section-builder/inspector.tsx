import { ArrowDown, ArrowUp, Blocks, Copy, Trash2 } from "lucide-react"
import { kitComponent } from "@/components/kit/registry"
import { SectionSettings } from "@/components/kit/section-builder/section-settings"
import { str } from "@/components/kit/section-builder/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PluginDashboardSection, PluginManifest } from "@/lib/types"

export function SectionInspector({
  active,
  selected,
  draftLength,
  manifest,
  onChangeSettings,
  onReplace,
  onSectionIdChange,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
}: {
  active: PluginDashboardSection | null
  selected: number | null
  draftLength: number
  manifest: PluginManifest
  onChangeSettings: (patch: Record<string, unknown>) => void
  onReplace: (section: PluginDashboardSection) => void
  onSectionIdChange: (value: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  return (
    <div className="min-h-0 overflow-y-auto border-l p-3">
      {active ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{kitComponent(active.type)?.label ?? active.type}</p>
            <Badge variant="outline" className="text-[10px]">
              {active.type}
            </Badge>
          </div>
          <SectionSettings
            key={selected}
            section={active}
            manifest={manifest}
            onChange={onChangeSettings}
            onReplace={onReplace}
          />
          <div className="space-y-1.5">
            <Label htmlFor="section-id">Section id (optional)</Label>
            <Input
              id="section-id"
              value={str(active.id)}
              placeholder="reports-stats"
              onChange={(event) => onSectionIdChange(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button size="sm" variant="outline" disabled={selected === 0} onClick={onMoveUp}>
              <ArrowUp />
              Move up
            </Button>
            <Button size="sm" variant="outline" disabled={selected === draftLength - 1} onClick={onMoveDown}>
              <ArrowDown />
              Move down
            </Button>
            <Button size="sm" variant="outline" onClick={onDuplicate}>
              <Copy />
              Duplicate
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={onRemove}>
              <Trash2 />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <Blocks className="h-6 w-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Select a component on the canvas to edit its settings.</p>
        </div>
      )}
    </div>
  )
}
