import * as React from "react"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Blocks,
  Braces,
  Copy,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import { KIT_COMPONENTS, KIT_TEMPLATES, defaultSettings, kitComponent, type KitComponentMeta, type KitTemplate } from "@/components/kit/registry"
import { SectionKit } from "@/components/kit/section-kit"
import { Callout } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { dev } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { PluginDashboardSection, PluginManifest } from "@/lib/types"
import { useApp } from "@/state/app"

/**
 * The visual components builder — palette → live canvas → inspector, plus a raw
 * JSON tab. Opened by "Add components" / "Edit components" on the Dashboard
 * page; saves through the normal manifest pipeline (validated + snapshotted).
 */

const DND_MIME = "application/x-selldoes-kit"

interface SectionBuilderProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
  store: { id: number; slug: string }
  manifest: PluginManifest
  pageLabel: string
  pagePath: string
  /** The page also has an iframe entry — it stays as fallback in plugin.json. */
  hasEntry: boolean
  sections: PluginDashboardSection[]
}

function cloneSections(sections: PluginDashboardSection[]): PluginDashboardSection[] {
  return JSON.parse(JSON.stringify(sections)) as PluginDashboardSection[]
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function settingsOf(section: PluginDashboardSection): Record<string, unknown> {
  return (section.settings ?? {}) as Record<string, unknown>
}

function sectionIsEmpty(section: PluginDashboardSection): boolean {
  const settings = settingsOf(section)
  if (section.type === "text") return !settings.title && !settings.body
  if (section.type === "stats" || section.type === "links") {
    return !Array.isArray(settings.items) || settings.items.length === 0
  }
  return false
}

/** Keeps only the fields the manifest should carry (drops undefined). */
function cleanSections(sections: PluginDashboardSection[]): PluginDashboardSection[] {
  return sections.map((section) => {
    const copy: PluginDashboardSection = { type: section.type }
    if (section.id) copy.id = section.id
    if (section.settings !== undefined) copy.settings = JSON.parse(JSON.stringify(section.settings))
    for (const [key, value] of Object.entries(section)) {
      if (key !== "type" && key !== "id" && key !== "settings") copy[key] = value
    }
    return copy
  })
}

export function SectionBuilder({
  open,
  onOpenChange,
  slug,
  store,
  manifest,
  pageLabel,
  pagePath,
  hasEntry,
  sections,
}: SectionBuilderProps) {
  const { applyManifest, refresh, setAssistantOpen, setAssistantPage, toast } = useApp()
  const [draft, setDraft] = React.useState<PluginDashboardSection[]>([])
  const [selected, setSelected] = React.useState<number | null>(null)
  const [tab, setTab] = React.useState<"components" | "json">("components")
  const [jsonText, setJsonText] = React.useState("[]")
  const [jsonError, setJsonError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const [paletteType, setPaletteType] = React.useState<string | null>(null)
  const [dropIndex, setDropIndex] = React.useState<number | null>(null)
  const baselineRef = React.useRef("[]")
  const sectionsRef = React.useRef(sections)
  sectionsRef.current = sections

  // Reset the draft every time the dialog opens — not on background re-renders.
  React.useEffect(() => {
    if (!open) return
    const initial = cloneSections(sectionsRef.current)
    setDraft(initial)
    baselineRef.current = JSON.stringify(initial)
    setSelected(initial.length > 0 ? 0 : null)
    setTab("components")
    setJsonText(JSON.stringify(initial, null, 2))
    setJsonError(null)
    setSaveError(null)
    setConfirmDiscard(false)
    setDragIndex(null)
    setPaletteType(null)
    setDropIndex(null)
  }, [open])

  const dirty = React.useMemo(() => JSON.stringify(draft) !== baselineRef.current, [draft])
  const dragging = dragIndex !== null || paletteType !== null

  const updateSection = React.useCallback((index: number, updater: (section: PluginDashboardSection) => PluginDashboardSection) => {
    setDraft((previous) => previous.map((section, i) => (i === index ? updater(section) : section)))
  }, [])

  const updateSettings = React.useCallback(
    (index: number, patch: Record<string, unknown>) => {
      updateSection(index, (section) => ({ ...section, settings: { ...settingsOf(section), ...patch } }))
    },
    [updateSection],
  )

  const addSection = (type: string, at?: number) => {
    const index = at ?? draft.length
    const section: PluginDashboardSection = { type, settings: defaultSettings(type, manifest) }
    setDraft((previous) => {
      const next = [...previous]
      next.splice(index, 0, section)
      return next
    })
    setTab("components")
    setSelected(index)
  }

  const addTemplate = (template: KitTemplate) => {
    const built = template.build(manifest)
    setDraft((previous) => [...previous, ...built])
    setTab("components")
    setSelected(draft.length)
  }

  const moveSection = (from: number, to: number) => {
    if (from === to) return
    setDraft((previous) => {
      const next = [...previous]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })
    setSelected(to)
  }

  const duplicateSection = (index: number) => {
    setDraft((previous) => {
      const next = [...previous]
      next.splice(index + 1, 0, JSON.parse(JSON.stringify(previous[index])) as PluginDashboardSection)
      return next
    })
    setSelected(index + 1)
  }

  const removeSection = (index: number) => {
    setDraft((previous) => previous.filter((_, i) => i !== index))
    setSelected((current) => {
      if (current === null) return current
      if (current === index) return null
      return current > index ? current - 1 : current
    })
  }

  const handleDragOver = (event: React.DragEvent, index: number) => {
    if (!dragging) return
    event.preventDefault()
    setDropIndex(index)
  }

  const handleDrop = (event: React.DragEvent, index: number) => {
    event.preventDefault()
    const type = event.dataTransfer.getData(DND_MIME) || paletteType
    if (type) addSection(type, index)
    else if (dragIndex !== null) moveSection(dragIndex, index)
    setDragIndex(null)
    setPaletteType(null)
    setDropIndex(null)
  }

  const switchTab = (next: "components" | "json") => {
    if (next === tab) return
    if (next === "json") {
      setJsonText(JSON.stringify(draft, null, 2))
      setJsonError(null)
    } else if (jsonError) {
      return
    }
    setTab(next)
  }

  const handleJsonChange = (text: string) => {
    setJsonText(text)
    try {
      const parsed = JSON.parse(text) as unknown
      if (!Array.isArray(parsed)) throw new Error("sections must be a JSON array")
      setDraft(parsed as PluginDashboardSection[])
      setSelected(null)
      setJsonError(null)
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : String(error))
    }
  }

  const requestClose = () => {
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    onOpenChange(false)
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const next = JSON.parse(JSON.stringify(manifest)) as PluginManifest
      const list = Array.isArray(next.dashboardPages) ? next.dashboardPages : []
      const target = list.find((page) => page.path === pagePath)
      if (!target) throw new Error(`Page "${pagePath}" is not declared in dashboardPages`)
      const cleaned = cleanSections(draft)
      target.sections = cleaned
      next.dashboardPages = list
      const response = await dev.saveManifest(next)
      baselineRef.current = JSON.stringify(cleaned)
      applyManifest(response.manifest, response.validation)
      await refresh()
      toast("Components saved — this page now renders from sections", "success")
      onOpenChange(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
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
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }

  const askAi = () => {
    setAssistantPage({
      context: `The developer is building the components of dashboard page "${pageLabel}" (${pagePath}) in the visual builder. Current draft sections JSON:\n${JSON.stringify(draft).slice(0, 2000)}\nKit types: text {title, body}, stats {items:[{label,value,hint}]}, table {route, columns?, title?, maxRows?}, job {job, title?, input?, maxTicks?}, settings (renders configSchema), logs {lines?}, links {items:[{label,href}]}. When they ask for changes, reply with a selldoes-edits block whose "manifest" is the FULL updated plugin.json with the new dashboardPages[].sections array (keep "entry" as fallback).`,
      quick: [
        "Add a stats row and a job runner to this page",
        "Show my /stats API route as a table on this page",
        "Replace these components with a settings form and links",
      ],
    })
    setAssistantOpen(true)
    onOpenChange(false)
  }

  const groups: { label: KitComponentMeta["group"]; items: typeof KIT_COMPONENTS }[] = [
    { label: "Content", items: KIT_COMPONENTS.filter((component) => component.group === "Content") },
    { label: "Data", items: KIT_COMPONENTS.filter((component) => component.group === "Data") },
    { label: "Actions", items: KIT_COMPONENTS.filter((component) => component.group === "Actions") },
  ]

  const active = selected !== null ? draft[selected] ?? null : null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose() }}>
      <DialogContent
        hideCloseButton
        className="flex h-[88vh] w-[96vw] max-w-[1200px] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b px-5 py-3">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Blocks className="h-4 w-4" />
              Components — {pageLabel}
              {dirty ? <Badge className="border-0 bg-amber-100 text-amber-700">unsaved</Badge> : null}
            </DialogTitle>
            <DialogDescription className="text-[11.5px]">
              Palette on the left, live preview in the middle, settings on the right — saved to{" "}
              <code>dashboardPages[].sections</code>.
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant={tab === "components" ? "secondary" : "ghost"} onClick={() => switchTab("components")}>
              <Blocks />
              Components
            </Button>
            <Button size="sm" variant={tab === "json" ? "secondary" : "ghost"} onClick={() => switchTab("json")}>
              <Braces />
              JSON
            </Button>
            <Button size="sm" variant="outline" onClick={() => void undo()} title="Restore plugin.json from the last save">
              <Undo2 />
              Undo
            </Button>
            <Button size="sm" variant="outline" onClick={askAi}>
              <Sparkles />
              Ask AI
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={requestClose} aria-label="Close">
              <X />
            </Button>
          </div>
        </DialogHeader>

        {tab === "components" ? (
          <div className="grid min-h-0 flex-1 grid-cols-[230px_minmax(0,1fr)_300px]">
            {/* ── Palette ─────────────────────────────────────────────────── */}
            <div className="min-h-0 space-y-4 overflow-y-auto border-r bg-muted/20 p-3">
              <div>
                <p className="px-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Templates</p>
                <div className="mt-1.5 space-y-1.5">
                  {KIT_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => addTemplate(template)}
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
                          setPaletteType(component.type)
                        }}
                        onDragEnd={() => {
                          setPaletteType(null)
                          setDropIndex(null)
                        }}
                        onClick={() => addSection(component.type)}
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

            {/* ── Canvas ──────────────────────────────────────────────────── */}
            <div className="min-h-0 overflow-y-auto bg-muted/30 p-4">
              {draft.length === 0 ? (
                <div
                  onDragOver={(event) => {
                    if (!dragging) return
                    event.preventDefault()
                    setDropIndex(0)
                  }}
                  onDrop={(event) => handleDrop(event, 0)}
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
                      <Button key={component.type} size="sm" variant="outline" onClick={() => addSection(component.type)}>
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
                          setDragIndex(index)
                          event.dataTransfer.effectAllowed = "move"
                          event.dataTransfer.setData("text/plain", String(index))
                        }}
                        onDragEnd={() => {
                          setDragIndex(null)
                          setPaletteType(null)
                          setDropIndex(null)
                        }}
                        onDragOver={(event) => handleDragOver(event, index)}
                        onDrop={(event) => handleDrop(event, index)}
                        onClick={() => setSelected(index)}
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
                              moveSection(index, index - 1)
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
                              moveSection(index, index + 1)
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
                              duplicateSection(index)
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
                              removeSection(index)
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
                    onDragOver={(event) => handleDragOver(event, draft.length)}
                    onDrop={(event) => handleDrop(event, draft.length)}
                    className={cn(
                      "rounded-lg border border-dashed py-3 text-center text-[11px] transition-colors",
                      dropIndex === draft.length && dragging ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground",
                    )}
                  >
                    Drag a component here to add it at the end
                  </div>
                </div>
              )}
            </div>

            {/* ── Inspector ───────────────────────────────────────────────── */}
            <div className="min-h-0 overflow-y-auto border-l p-3">
              {active ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{kitComponent(active.type)?.label ?? active.type}</p>
                    <Badge variant="outline" className="text-[10px]">{active.type}</Badge>
                  </div>
                  <SectionSettings
                    key={selected}
                    section={active}
                    manifest={manifest}
                    onChange={(patch) => updateSettings(selected!, patch)}
                    onReplace={(next) => updateSection(selected!, () => next)}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="section-id">Section id (optional)</Label>
                    <Input
                      id="section-id"
                      value={str(active.id)}
                      placeholder="reports-stats"
                      onChange={(event) =>
                        updateSection(selected!, (section) => {
                          const next = { ...section }
                          if (event.target.value) next.id = event.target.value
                          else delete next.id
                          return next
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Button size="sm" variant="outline" disabled={selected === 0} onClick={() => moveSection(selected!, selected! - 1)}>
                      <ArrowUp />
                      Move up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selected === draft.length - 1}
                      onClick={() => moveSection(selected!, selected! + 1)}
                    >
                      <ArrowDown />
                      Move down
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => duplicateSection(selected!)}>
                      <Copy />
                      Duplicate
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => removeSection(selected!)}>
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
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="mx-auto max-w-4xl space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Raw <code>dashboardPages[].sections</code> — edits here apply live to the canvas.
                </p>
                <Button size="sm" variant="outline" onClick={() => setJsonText(JSON.stringify(draft, null, 2))}>
                  Format
                </Button>
              </div>
              <Textarea
                value={jsonText}
                onChange={(event) => handleJsonChange(event.target.value)}
                rows={24}
                className="font-mono text-[12px]"
                placeholder='[{ "type": "stats", "settings": { "items": [{ "label": "Jobs", "value": "3" }] } }]'
              />
              {jsonError ? (
                <p className="text-[12px] text-destructive">Invalid JSON: {jsonError}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">{draft.length} component(s)</p>
              )}
            </div>
          </div>
        )}

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
                <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>
                  Keep editing
                </Button>
                <Button size="sm" variant="destructive" onClick={() => { setConfirmDiscard(false); onOpenChange(false) }}>
                  Discard
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={requestClose}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void save()} disabled={saving || !dirty || jsonError !== null}>
                  {saving ? <Loader2 className="animate-spin" /> : <Save />}
                  {saving ? "Saving…" : "Save components"}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Inspector forms ──────────────────────────────────────────────────────── */

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-[10.5px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function SectionSettings({
  section,
  manifest,
  onChange,
  onReplace,
}: {
  section: PluginDashboardSection
  manifest: PluginManifest
  onChange: (patch: Record<string, unknown>) => void
  onReplace: (section: PluginDashboardSection) => void
}) {
  const settings = settingsOf(section)
  switch (section.type) {
    case "text":
      return (
        <>
          <Field label="Title">
            <Input value={str(settings.title)} placeholder="Overview" onChange={(event) => onChange({ title: event.target.value })} />
          </Field>
          <Field label="Body" hint={<>Markdown: **bold**, `code`, - lists.</>}>
            <Textarea rows={8} value={str(settings.body)} onChange={(event) => onChange({ body: event.target.value })} />
          </Field>
        </>
      )
    case "stats":
      return (
        <StatsItemsEditor
          items={Array.isArray(settings.items) ? settings.items : []}
          onChange={(items) => onChange({ items })}
        />
      )
    case "table": {
      const routes = manifest.apiRoutes ?? []
      const route = str(settings.route)
      const columns = Array.isArray(settings.columns) ? (settings.columns as unknown[]).map(String) : []
      return (
        <>
          <Field label="Title">
            <Input value={str(settings.title)} placeholder="Data" onChange={(event) => onChange({ title: event.target.value })} />
          </Field>
          <Field label="API route" hint="The handler returns an array, { rows: [...] } or { items: [...] }.">
            {routes.length > 0 ? (
              <Select value={route} onValueChange={(value) => onChange({ route: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a route…" />
                </SelectTrigger>
                <SelectContent>
                  {routes.map((entry) => (
                    <SelectItem key={entry.path} value={entry.path}>
                      {entry.path}
                    </SelectItem>
                  ))}
                  {route && !routes.some((entry) => entry.path === route) ? <SelectItem value={route}>{route} (custom)</SelectItem> : null}
                </SelectContent>
              </Select>
            ) : (
              <Input value={route} placeholder="/stats" onChange={(event) => onChange({ route: event.target.value })} />
            )}
          </Field>
          <Field label="Columns" hint="Comma-separated; empty infers them from the first rows.">
            <Input
              value={columns.join(", ")}
              placeholder="sku, price, stock"
              onChange={(event) =>
                onChange({ columns: event.target.value.split(",").map((column) => column.trim()).filter(Boolean) })
              }
            />
          </Field>
          <Field label="Max rows">
            <Input
              type="number"
              value={String(settings.maxRows ?? 50)}
              onChange={(event) => onChange({ maxRows: Number(event.target.value) || 50 })}
            />
          </Field>
        </>
      )
    }
    case "job": {
      const jobs = manifest.jobs ?? []
      const job = str(settings.job)
      return (
        <>
          <Field label="Title">
            <Input value={str(settings.title)} placeholder="Run a job" onChange={(event) => onChange({ title: event.target.value })} />
          </Field>
          <Field label="Job">
            {jobs.length > 0 ? (
              <Select value={job} onValueChange={(value) => onChange({ job: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a job…" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((entry) => (
                    <SelectItem key={entry.type} value={entry.type}>
                      {entry.name ?? entry.type}
                    </SelectItem>
                  ))}
                  {job && !jobs.some((entry) => entry.type === job) ? <SelectItem value={job}>{job} (custom)</SelectItem> : null}
                </SelectContent>
              </Select>
            ) : (
              <Input value={job} placeholder="import-products" onChange={(event) => onChange({ job: event.target.value })} />
            )}
          </Field>
          <Field label="Description">
            <Input
              value={str(settings.description)}
              placeholder="Walks the catalog in chunks"
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </Field>
          <Field label="Input (JSON)" hint="Passed to the job's init/step as input.">
            <JsonField value={settings.input} onChange={(value) => onChange({ input: value })} placeholder='{ "limit": 10 }' />
          </Field>
          <Field label="Max ticks">
            <Input
              type="number"
              value={String(settings.maxTicks ?? 20)}
              onChange={(event) => onChange({ maxTicks: Number(event.target.value) || 20 })}
            />
          </Field>
        </>
      )
    }
    case "logs":
      return (
        <>
          <Field label="Title">
            <Input value={str(settings.title)} placeholder="Dev logs" onChange={(event) => onChange({ title: event.target.value })} />
          </Field>
          <Field label="Lines">
            <Input
              type="number"
              value={String(settings.lines ?? 20)}
              onChange={(event) => onChange({ lines: Number(event.target.value) || 20 })}
            />
          </Field>
        </>
      )
    case "links":
      return (
        <LinksItemsEditor
          items={Array.isArray(settings.items) ? settings.items : []}
          onChange={(items) => onChange({ items })}
        />
      )
    case "settings":
      return (
        <Callout kind="info">
          Renders the plugin's <code>configSchema</code> form ({manifest.configSchema?.length ?? 0} field
          {manifest.configSchema?.length === 1 ? "" : "s"}) — values are saved per store. No options to configure here.
        </Callout>
      )
    default:
      return <RawSectionEditor section={section} onReplace={onReplace} />
  }
}

function StatsItemsEditor({ items, onChange }: { items: unknown[]; onChange: (items: unknown[]) => void }) {
  const rows = items as { label?: unknown; value?: unknown; hint?: unknown }[]
  const update = (index: number, patch: Record<string, unknown>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="space-y-1.5 rounded-lg border border-border p-2">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Stat {index + 1}</p>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </Button>
          </div>
          <Input value={str(row.label)} placeholder="Label" onChange={(event) => update(index, { label: event.target.value })} />
          <Input value={str(row.value)} placeholder="Value" onChange={(event) => update(index, { value: event.target.value })} />
          <Input value={str(row.hint)} placeholder="Hint (optional)" onChange={(event) => update(index, { hint: event.target.value })} />
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...rows, { label: "Metric", value: "0", hint: "" }])}>
        <Plus />
        Add stat
      </Button>
    </div>
  )
}

function LinksItemsEditor({ items, onChange }: { items: unknown[]; onChange: (items: unknown[]) => void }) {
  const rows = items as { label?: unknown; href?: unknown }[]
  const update = (index: number, patch: Record<string, unknown>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="space-y-1.5 rounded-lg border border-border p-2">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Link {index + 1}</p>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </Button>
          </div>
          <Input value={str(row.label)} placeholder="Label" onChange={(event) => update(index, { label: event.target.value })} />
          <Input value={str(row.href)} placeholder="https://…" onChange={(event) => update(index, { href: event.target.value })} />
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...rows, { label: "Link", href: "https://" }])}>
        <Plus />
        Add link
      </Button>
    </div>
  )
}

function JsonField({ value, onChange, placeholder, rows = 4 }: { value: unknown; onChange: (value: unknown) => void; placeholder?: string; rows?: number }) {
  const [text, setText] = React.useState(value === undefined ? "" : JSON.stringify(value, null, 2))
  const [error, setError] = React.useState<string | null>(null)
  return (
    <div className="space-y-1">
      <Textarea
        rows={rows}
        className="font-mono text-[11.5px]"
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          if (!next.trim()) {
            setError(null)
            onChange(undefined)
            return
          }
          try {
            onChange(JSON.parse(next))
            setError(null)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        }}
      />
      {error ? <p className="text-[10.5px] text-destructive">Invalid JSON: {error}</p> : null}
    </div>
  )
}

function RawSectionEditor({ section, onReplace }: { section: PluginDashboardSection; onReplace: (section: PluginDashboardSection) => void }) {
  const [text, setText] = React.useState(JSON.stringify(section, null, 2))
  const [error, setError] = React.useState<string | null>(null)
  return (
    <div className="space-y-1.5">
      <Callout kind="warn">
        Unknown component type <code>{section.type}</code> — the host may render it, the preview doesn't know it yet. Its JSON is
        preserved on save; edit it here.
      </Callout>
      <Textarea
        rows={12}
        className="font-mono text-[11.5px]"
        value={text}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          try {
            const parsed = JSON.parse(next) as PluginDashboardSection
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.type !== "string") {
              throw new Error('expected an object with a "type"')
            }
            setError(null)
            onReplace(parsed)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        }}
      />
      {error ? <p className="text-[10.5px] text-destructive">Invalid: {error}</p> : null}
    </div>
  )
}
