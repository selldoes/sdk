import { KIT_COMPONENTS, KIT_TEMPLATES, type KitComponentMeta, type KitTemplate } from "@/components/kit/registry"
import { DND_MIME } from "@/components/kit/section-builder/shared"

export function SectionPalette({
  onAddTemplate,
  onAddSection,
  onPaletteDragStart,
  onPaletteDragEnd,
}: {
  onAddTemplate: (template: KitTemplate) => void
  onAddSection: (type: string) => void
  onPaletteDragStart: (type: string) => void
  onPaletteDragEnd: () => void
}) {
  const groups: { label: KitComponentMeta["group"]; items: typeof KIT_COMPONENTS }[] = [
    { label: "Content", items: KIT_COMPONENTS.filter((component) => component.group === "Content") },
    { label: "Data", items: KIT_COMPONENTS.filter((component) => component.group === "Data") },
    { label: "Actions", items: KIT_COMPONENTS.filter((component) => component.group === "Actions") },
  ]

  return (
    <div className="min-h-0 space-y-4 overflow-y-auto border-r bg-muted/20 p-3">
      <div>
        <p className="px-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Templates</p>
        <div className="mt-1.5 space-y-1.5">
          {KIT_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onAddTemplate(template)}
              className="flex w-full items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:border-primary hover:bg-primary/5"
            >
              <template.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold">{template.label}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{template.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{group.label}</p>
          <div className="mt-1.5 space-y-1.5">
            {group.items.map((component) => (
              <button
                key={component.type}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(DND_MIME, component.type)
                  event.dataTransfer.effectAllowed = "copy"
                  onPaletteDragStart(component.type)
                }}
                onDragEnd={onPaletteDragEnd}
                onClick={() => onAddSection(component.type)}
                className="flex w-full cursor-grab items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:border-primary hover:bg-primary/5 active:cursor-grabbing"
              >
                <component.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold">{component.label}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{component.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="px-1 text-[10.5px] leading-snug text-muted-foreground">Click to add, or drag a component onto the canvas.</p>
    </div>
  )
}
