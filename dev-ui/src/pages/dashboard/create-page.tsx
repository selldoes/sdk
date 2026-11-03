import { Loader2, Plus } from "lucide-react"
import * as React from "react"
import { ChoiceTile } from "@/components/create-dialogs"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { dev } from "@/lib/api"
import type { PluginManifest, Validation } from "@/lib/types"
import { useApp } from "@/state/app"

type PageMode = "components" | "html"

/** The creation bar — the Dashboard page owns page creation; jobs, hooks and API routes live on their own pages. */
export function CreatePageBar({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={onPick}>
        <Plus />
        New page
      </Button>
      <span className="text-[11px] text-muted-foreground">
        scaffolds <code>ui/</code> pages (or no-code components) and wires <code>dashboardPages</code> in plugin.json
      </span>
    </div>
  )
}

/** Dialog for dashboard page creation — writes files, patches the manifest, rebuilds. */
export function CreatePageDialog({
  open,
  onOpenChange,
  onScaffolded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScaffolded: (
    manifest: PluginManifest,
    validation: Validation,
    message: string,
    extra?: { pagePath?: string; openBuilder?: boolean },
  ) => void
}) {
  const { bootstrap, toast } = useApp()
  const [label, setLabel] = React.useState("")
  const [path, setPath] = React.useState("")
  const [icon, setIcon] = React.useState("")
  const [pageMode, setPageMode] = React.useState<PageMode>("components")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setLabel("")
      setPath("")
      setIcon("")
      setPageMode("components")
    }
  }, [open])

  const ready = label.trim().length > 0

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const name = label.trim()
      const rawPath =
        path.trim() ||
        `/${
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "page"
        }`
      const pagePath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`
      if (pageMode === "html") {
        const entry = pagePath === "/" ? "ui/index.html" : `ui/${pagePath.replace(/^\//, "").replace(/\/$/, "")}.html`
        const result = await dev.scaffoldUi({ entry, label: name, path: pagePath, ...(icon.trim() ? { icon: icon.trim() } : {}) })
        onScaffolded(
          result.manifest,
          result.validation,
          result.written.length ? `Page created: ${result.written.join(", ")}` : "Page UI already present — rebuilt",
          { pagePath },
        )
      } else {
        const current = bootstrap?.manifest
        if (!current) throw new Error("The plugin manifest is not loaded yet")
        const next = JSON.parse(JSON.stringify(current)) as PluginManifest
        const list = Array.isArray(next.dashboardPages) ? next.dashboardPages : []
        if (list.some((page) => page.path === pagePath)) throw new Error(`A dashboard page at "${pagePath}" already exists`)
        const page: NonNullable<PluginManifest["dashboardPages"]>[number] = { label: name, path: pagePath, sections: [] }
        if (icon.trim()) page.icon = icon.trim()
        list.push(page)
        next.dashboardPages = list
        const response = await dev.saveManifest(next)
        onScaffolded(response.manifest, response.validation, `Components page created: ${pagePath}`, {
          pagePath,
          openBuilder: true,
        })
      }
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New dashboard page</DialogTitle>
          <DialogDescription>
            {
              "A components page adds a dashboardPages entry (no iframe) and opens the visual builder; an HTML page scaffolds the notes example under ui/."
            }
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Page type</Label>
            <div className="grid grid-cols-2 gap-2">
              <ChoiceTile
                selected={pageMode === "components"}
                onSelect={() => setPageMode("components")}
                title="Components"
                blurb="No-code kit — build it in the visual builder"
              />
              <ChoiceTile
                selected={pageMode === "html"}
                onSelect={() => setPageMode("html")}
                title="HTML"
                blurb="Notes example under ui/ (iframe)"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-label">Label</Label>
            <Input
              id="create-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Reports"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-path">Path (optional)</Label>
            <Input id="create-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/reports" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-icon">Icon (optional lucide name)</Label>
            <Input id="create-icon" value={icon} onChange={(event) => setIcon(event.target.value)} placeholder="bar-chart-2" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!ready || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
