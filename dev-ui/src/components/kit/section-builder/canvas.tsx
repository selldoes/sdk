import { AlertTriangle, ArrowDown, ArrowUp, Blocks, Copy, GripVertical, Trash2 } from "lucide-react"
import type * as React from "react"
import { KIT_COMPONENTS, kitComponent } from "@/components/kit/registry"
import { sectionIsEmpty } from "@/components/kit/section-builder/shared"
import { SectionKit } from "@/components/kit/section-kit"
import { Button } from "@/components/ui/button"
import type { PluginDashboardSection } from "@/lib/types"
import { cn } from "@/lib/utils"

export function SectionCanvas({
  draft,
  selected,
  dragIndex,
  dropIndex,
  dragging,
  slug,
  store,
  onSelect,
  onSectionDragStart,
  onSectionDragEnd,
  onDragOver,
  onDrop,
  onMove,
  onDuplicate,
  onRemove,
  onAdd,
}: {
  draft: PluginDashboardSection[]
  selected: number | null
  dragIndex: number | null
  dropIndex: number | null
  dragging: boolean
  slug: string
  store: { id: number; slug: string }
  onSelect: (index: number) => void
  onSectionDragStart: (index: number) => void
  onSectionDragEnd: () => void
  onDragOver: (event: React.DragEvent, index: number) => void
  onDrop: (event: React.DragEvent, index: number) => void
  onMove: (from: number, to: number) => void
  onDuplicate: (index: number) => void
  onRemove: (index: number) => void
  onAdd: (type: string) => void
}) {
  return (
    <div className="min-h-0 overflow-y-auto bg-muted/30 p-4">
      {draft.length === 0 ? (
        <div
          onDragOver={(event) => onDragOver(event, 0)}
          onDrop={(event) => onDrop(event, 0)}
          className={cn(
            "flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dropIndex !== null ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <Blocks className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Build this page from components</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Pick a component from the palette or drag one here. This preview uses the exact renderer the host uses for{" "}
              <code>sections</code>.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {KIT_COMPONENTS.slice(0, 4).map((component) => (
              <Button key={component.type} size="sm" variant="outline" onClick={() => onAdd(component.type)}>
                <component.icon />
                {component.label}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-3 pb-2">
          {draft.map((section, index) => {
            const meta = kitComponent(section.type)
            const Icon = meta?.icon ?? AlertTriangle
            return (
              <div
                key={section.id ?? `${section.type}-${index}`}
                draggable
                onDragStart={(event) => {
                  // Interactive elements inside the preview (settings forms,
                  // links, toolbar buttons) keep their native behavior.
                  if ((event.target as HTMLElement).closest("input, textarea, select, button, a")) {
                    event.preventDefault()
                    return
                  }
                  onSectionDragStart(index)
                  event.dataTransfer.effectAllowed = "move"
                  event.dataTransfer.setData("text/plain", String(index))
                }}
                onDragEnd={onSectionDragEnd}
                onDragOver={(event) => onDragOver(event, index)}
                onDrop={(event) => onDrop(event, index)}
                onClick={() => onSelect(index)}
                className={cn(
                  "group relative cursor-pointer rounded-xl border bg-background p-3 transition-all",
                  selected === index ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40",
                  dropIndex === index && dragIndex !== index ? "border-primary ring-2 ring-primary/50" : null,
                  dragIndex === index ? "opacity-50" : null,
                )}
              >
                <div
                  className={cn(
                    "absolute -top-3 right-2 z-10 items-center gap-0.5 rounded-lg border border-border bg-background px-1 py-0.5 shadow-sm",
                    selected === index ? "flex" : "hidden group-hover:flex",
                  )}
                >
                  <span className="cursor-grab px-0.5 text-muted-foreground" title="Drag to reorder">
                    <GripVertical className="h-3.5 w-3.5" />
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    disabled={index === 0}
                    title="Move up"
                    onClick={(event) => {
                      event.stopPropagation()
                      onMove(index, index - 1)
                    }}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    disabled={index === draft.length - 1}
                    title="Move down"
                    onClick={(event) => {
                      event.stopPropagation()
                      onMove(index, index + 1)
                    }}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    title="Duplicate"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDuplicate(index)
                    }}
                  >
                    <Copy />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive"
                    title="Remove"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemove(index)
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3 w-3" />
                  {meta?.label ?? `Unknown · ${section.type}`}
                </p>
                {sectionIsEmpty(section) ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    No visible content yet — configure it in the inspector.
                  </div>
                ) : (
                  <SectionKit slug={slug} store={store} sections={[section]} />
                )}
              </div>
            )
          })}
          <div
            onDragOver={(event) => onDragOver(event, draft.length)}
            onDrop={(event) => onDrop(event, draft.length)}
            className={cn(
              "rounded-lg border border-dashed py-3 text-center text-[11px] transition-colors",
              dropIndex === draft.length && dragging
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            Drag a component here to add it at the end
          </div>
        </div>
      )}
    </div>
  )
}
