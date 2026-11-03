import * as React from "react"
import { defaultSettings, type KitTemplate } from "@/components/kit/registry"
import { SectionCanvas } from "@/components/kit/section-builder/canvas"
import { SectionBuilderFooter } from "@/components/kit/section-builder/dialog-footer"
import { SectionBuilderHeader } from "@/components/kit/section-builder/dialog-header"
import { SectionInspector } from "@/components/kit/section-builder/inspector"
import { SectionsJsonTab } from "@/components/kit/section-builder/json-tab"
import { SectionPalette } from "@/components/kit/section-builder/palette"
import { cleanSections, cloneSections, DND_MIME, settingsOf } from "@/components/kit/section-builder/shared"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { dev } from "@/lib/api"
import type { PluginDashboardSection, PluginManifest } from "@/lib/types"
import { useApp } from "@/state/app"

/**
 * The visual components builder — palette → live canvas → inspector, plus a raw
 * JSON tab. Opened by "Add components" / "Edit components" on the Dashboard
 * page; saves through the normal manifest pipeline (validated + snapshotted).
 *
 * The individual pieces live in the sibling `section-builder/` folder: the
 * palette, canvas, inspector, settings forms, JSON tab and dialog chrome.
 */

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
  /**
   * Where the sections are saved: a dashboard page (`dashboardPages[]`, the
   * default) or the designed settings dialog (`settingsDialog.sections`).
   */
  scope?: "page" | "settings"
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
  scope = "page",
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

  const updateSection = React.useCallback(
    (index: number, updater: (section: PluginDashboardSection) => PluginDashboardSection) => {
      setDraft((previous) => previous.map((section, i) => (i === index ? updater(section) : section)))
    },
    [],
  )

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
      const cleaned = cleanSections(draft)
      if (scope === "settings") {
        // Designed settings dialog — the platform opens it from the plugin
        // manager's Settings button; the kit compiler builds ui/kit/settings.html.
        next.settingsDialog = { ...(next.settingsDialog ?? {}), sections: cleaned }
      } else {
        const list = Array.isArray(next.dashboardPages) ? next.dashboardPages : []
        const target = list.find((page) => page.path === pagePath)
        if (!target) throw new Error(`Page "${pagePath}" is not declared in dashboardPages`)
        target.sections = cleaned
        next.dashboardPages = list
      }
      const response = await dev.saveManifest(next)
      baselineRef.current = JSON.stringify(cleaned)
      applyManifest(response.manifest, response.validation)
      await refresh()
      toast(
        scope === "settings"
          ? "Settings dialog components saved — it now opens from the plugin manager's Settings button"
          : "Components saved — this page now renders from sections",
        "success",
      )
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
      context:
        scope === "settings"
          ? `The developer is building the components of their plugin's settings dialog in the visual builder. Current draft sections JSON:\n${JSON.stringify(draft).slice(0, 2000)}\nKit types: text {title, body}, stats {items:[{label,value,hint}]}, table {route, columns?, title?, maxRows?}, job {job, title?, input?, maxTicks?}, settings (renders the whole configSchema form), field {key, title?, description?} (one configSchema field, saves on change), logs {lines?}, links {items:[{label,href}]}, group {title, sections:[…]}. When they ask for changes, reply with a selldoes-edits block whose "manifest" is the FULL updated plugin.json with the new settingsDialog.sections array.`
          : `The developer is building the components of dashboard page "${pageLabel}" (${pagePath}) in the visual builder. Current draft sections JSON:\n${JSON.stringify(draft).slice(0, 2000)}\nKit types: text {title, body}, stats {items:[{label,value,hint}]}, table {route, columns?, title?, maxRows?}, job {job, title?, input?, maxTicks?}, settings (renders the whole configSchema form), field {key, title?, description?} (one configSchema field, saves on change), logs {lines?}, links {items:[{label,href}]}, group {title, sections:[…]}. When they ask for changes, reply with a selldoes-edits block whose "manifest" is the FULL updated plugin.json with the new dashboardPages[].sections array (keep "entry" as fallback).`,
      quick:
        scope === "settings"
          ? ["Add my configSchema form and a docs link", "Show a short intro explaining what this plugin does"]
          : [
              "Add a stats row and a job runner to this page",
              "Show my /stats API route as a table on this page",
              "Replace these components with a settings form and links",
            ],
    })
    setAssistantOpen(true)
    onOpenChange(false)
  }

  const active = selected !== null ? (draft[selected] ?? null) : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose()
      }}
    >
      <DialogContent hideCloseButton className="flex h-[88vh] w-[96vw] max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
        <SectionBuilderHeader
          pageLabel={pageLabel}
          dirty={dirty}
          tab={tab}
          onSwitchTab={switchTab}
          onUndo={() => void undo()}
          onAskAi={askAi}
          onClose={requestClose}
        />

        {tab === "components" ? (
          <div className="grid min-h-0 flex-1 grid-cols-[230px_minmax(0,1fr)_300px]">
            {/* ── Palette ─────────────────────────────────────────────────── */}
            <SectionPalette
              onAddTemplate={addTemplate}
              onAddSection={addSection}
              onPaletteDragStart={setPaletteType}
              onPaletteDragEnd={() => {
                setPaletteType(null)
                setDropIndex(null)
              }}
            />

            {/* ── Canvas ──────────────────────────────────────────────────── */}
            <SectionCanvas
              draft={draft}
              selected={selected}
              dragIndex={dragIndex}
              dropIndex={dropIndex}
              dragging={dragging}
              slug={slug}
              store={store}
              onSelect={setSelected}
              onSectionDragStart={setDragIndex}
              onSectionDragEnd={() => {
                setDragIndex(null)
                setPaletteType(null)
                setDropIndex(null)
              }}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onMove={moveSection}
              onDuplicate={duplicateSection}
              onRemove={removeSection}
              onAdd={addSection}
            />

            {/* ── Inspector ───────────────────────────────────────────────── */}
            <SectionInspector
              active={active}
              selected={selected}
              draftLength={draft.length}
              manifest={manifest}
              onChangeSettings={(patch) => updateSettings(selected!, patch)}
              onReplace={(next) => updateSection(selected!, () => next)}
              onSectionIdChange={(value) =>
                updateSection(selected!, (section) => {
                  const next = { ...section }
                  if (value) next.id = value
                  else delete next.id
                  return next
                })
              }
              onMoveUp={() => moveSection(selected!, selected! - 1)}
              onMoveDown={() => moveSection(selected!, selected! + 1)}
              onDuplicate={() => duplicateSection(selected!)}
              onRemove={() => removeSection(selected!)}
            />
          </div>
        ) : (
          <SectionsJsonTab
            jsonText={jsonText}
            jsonError={jsonError}
            draftLength={draft.length}
            onJsonChange={handleJsonChange}
            onFormat={() => setJsonText(JSON.stringify(draft, null, 2))}
          />
        )}

        <SectionBuilderFooter
          saveError={saveError}
          confirmDiscard={confirmDiscard}
          hasEntry={hasEntry}
          saving={saving}
          dirty={dirty}
          jsonError={jsonError}
          onKeepEditing={() => setConfirmDiscard(false)}
          onDiscard={() => {
            setConfirmDiscard(false)
            onOpenChange(false)
          }}
          onCancel={requestClose}
          onSave={() => void save()}
        />
      </DialogContent>
    </Dialog>
  )
}
