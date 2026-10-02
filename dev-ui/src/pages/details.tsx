import * as React from "react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Upload,
} from "lucide-react"
import { Link } from "react-router-dom"
import { AppIcon, PLUGIN_ICON_CHOICES } from "@/components/app-icon"
import { PageHead, Callout } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { dev, readFileBase64 } from "@/lib/api"
import { ICON_ACCEPT, ICON_GUIDE, prepareIconFile } from "@/lib/icon-upload"
import { CATEGORIES, PERMISSION_INFO, PERMISSION_ORDER, RISK_STYLES, filterPermissions, highestRisk } from "@/lib/permissions"
import type { PluginManifest } from "@/lib/types"
import { useVisit } from "@/lib/use-visit"
import { cn, mediaUrl } from "@/lib/utils"
import { useApp } from "@/state/app"

function shallowEqual(a: PluginManifest, b: PluginManifest) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function DetailsPage() {
  const { bootstrap, refresh, applyManifest, toast, setAssistantPage } = useApp()
  useVisit("details")
  const initial = bootstrap!.manifest
  const validation = bootstrap!.validation
  const snapshots = bootstrap!.snapshots
  const [manifest, setManifest] = React.useState<PluginManifest>(initial)
  const [saving, setSaving] = React.useState(false)
  const [savedAt, setSavedAt] = React.useState<string | null>(null)
  const [permissionQuery, setPermissionQuery] = React.useState("")
  const iconInput = React.useRef<HTMLInputElement>(null)
  const shotInput = React.useRef<HTMLInputElement>(null)
  const dirty = !shallowEqual(manifest, initial)

  const permissions = (manifest.permissions ?? []) as string[]
  const allowedTables = manifest.allowedTables ?? []
  const tagsText = (manifest.tags ?? []).join(", ")
  const tablesText = allowedTables.join(", ")
  const visiblePermissions = filterPermissions(PERMISSION_ORDER, permissionQuery)

  const set = (patch: Partial<PluginManifest>) => setManifest((previous) => ({ ...previous, ...patch }))

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is editing plugin.json metadata (name, description, icon, screenshots, permissions). Current permissions: ${JSON.stringify(
        permissions,
      )}; allowedTables: ${JSON.stringify(allowedTables)}.`,
      quick: ["Improve my marketplace description", "Do I request any permission I don't need?"],
    })
  }, [setAssistantPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true)
    try {
      const result = await dev.saveManifest({ ...manifest, tags: manifest.tags ?? [], allowedTables })
      applyManifest(result.manifest, result.validation)
      setManifest(result.manifest)
      setSavedAt(new Date().toLocaleTimeString())
      if (result.validation.errors.length) toast("Saved with validation errors", "error")
      else toast("Details saved — preview rebuilt", "success")
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

  const uploadIcon = async (file: File) => {
    try {
      const prepared = await prepareIconFile(file)
      const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? ".png"
      const uploaded = await dev.uploadAsset({ folder: "assets", name: `icon${extension}`, data: prepared.data })
      const previous = manifest.iconUrl
      set({ iconUrl: uploaded.path })
      // Replace, don't accumulate: drop the old uploaded icon once the new one
      // is on disk (keep external URLs untouched).
      if (previous && previous !== uploaded.path && /^assets\//.test(previous)) {
        try {
          await dev.deleteAsset(previous)
        } catch {
          // already gone
        }
      }
      if (prepared.warning) toast(prepared.warning)
      toast("Icon uploaded — save to keep it", "success")
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }

  const uploadScreenshots = async (files: FileList) => {
    const next = [...(manifest.screenshots ?? [])]
    for (const file of Array.from(files)) {
      try {
        const data = await readFileBase64(file)
        const base = file.name.replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9.]+/g, "-")
        const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? ".png"
        const uploaded = await dev.uploadAsset({ folder: "screenshots", name: `${base}${extension}`, data })
        next.push(uploaded.path)
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      }
    }
    set({ screenshots: next })
    toast("Screenshots added — save to keep them")
  }

  const moveScreenshot = (index: number, direction: -1 | 1) => {
    const list = [...(manifest.screenshots ?? [])]
    const target = index + direction
    if (target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]
    set({ screenshots: list })
  }

  const removeScreenshot = async (index: number) => {
    const list = [...(manifest.screenshots ?? [])]
    const [removed] = list.splice(index, 1)
    set({ screenshots: list })
    if (removed) {
      try {
        await dev.deleteAsset(removed)
      } catch {
        // file may already be gone
      }
    }
  }

  return (
    <div className="space-y-4">
      <PageHead
        title="Details & permissions"
        description={
          <>
            Everything on this page is written to <code>plugin.json</code>. Other files (code, UI, jobs) stay in your editor — the
            preview reloads them as you save.
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {/* Identity */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Identity
              </CardTitle>
              <CardDescription>What store owners read in the marketplace and dashboard.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="name">
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input id="name" className="mt-1.5" maxLength={60} value={manifest.name} onChange={(event) => set({ name: event.target.value })} />
                </div>
                <div>
                  <Label htmlFor="slug">Slug (permanent)</Label>
                  <Input id="slug" className="mt-1.5 opacity-60" value={manifest.slug} readOnly />
                  <p className="mt-1 text-[11px] text-muted-foreground">The plugin's identity. It cannot change once published.</p>
                </div>
              </div>
              <div>
                <Label htmlFor="description">
                  Description <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="description"
                  className="mt-1.5"
                  maxLength={400}
                  value={manifest.description}
                  onChange={(event) => set({ description: event.target.value })}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {manifest.description.length}/400 · one or two sentences about the value, not the implementation.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="version">Version</Label>
                  <Input id="version" className="mt-1.5" value={manifest.version} onChange={(event) => set({ version: event.target.value })} />
                  <p className="mt-1 text-[11px] text-muted-foreground">Bump for every release (x.y.z).</p>
                </div>
                <div>
                  <Label htmlFor="author">Author</Label>
                  <Input
                    id="author"
                    className="mt-1.5"
                    placeholder="Your name or company"
                    value={manifest.author ?? ""}
                    onChange={(event) => set({ author: event.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="homepage">Homepage</Label>
                  <Input
                    id="homepage"
                    className="mt-1.5"
                    placeholder="https://…"
                    value={manifest.homepage ?? ""}
                    onChange={(event) => set({ homepage: event.target.value })}
                  />
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={manifest.category ?? "other"} onValueChange={(value) => set({ category: value })}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="tags">Tags</Label>
                <Input
                  id="tags"
                  className="mt-1.5 max-w-md"
                  placeholder="import, dropshipping, csv"
                  value={tagsText}
                  onChange={(event) =>
                    set({
                      tags: event.target.value
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Icon */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="h-4 w-4" />
                Icon
              </CardTitle>
              <CardDescription>Shown in the sidebar, the dashboard and the marketplace. Pick a built-in icon or upload your own.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <AppIcon name={manifest.icon} imageUrl={manifest.iconUrl} className="h-12 w-12" />
                <div>
                  <p className="text-[13px] font-semibold">Current icon</p>
                  <p className="text-[11px] text-muted-foreground">
                    {manifest.iconUrl ? (
                      <>
                        Custom image <code>{manifest.iconUrl}</code>
                      </>
                    ) : (
                      <>
                        Built-in <code>{manifest.icon ?? "puzzle"}</code>
                      </>
                    )}
                  </p>
                </div>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => iconInput.current?.click()}>
                    <Upload />
                    Upload image
                  </Button>
                  {manifest.iconUrl ? (
                    <Button size="sm" variant="ghost" onClick={() => set({ iconUrl: undefined, icon: manifest.icon ?? "puzzle" })}>
                      Remove image
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={iconInput}
                  type="file"
                  accept={ICON_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void uploadIcon(file)
                    event.target.value = ""
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">{ICON_GUIDE}</p>
              <div className="grid grid-cols-8 gap-2 sm:grid-cols-10">
                {PLUGIN_ICON_CHOICES.map((name) => {
                  const active = !manifest.iconUrl && (manifest.icon ?? "puzzle") === name
                  return (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      onClick={() => set({ icon: name, iconUrl: undefined })}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground",
                        active && "border-primary bg-primary text-primary-foreground hover:text-primary-foreground",
                      )}
                    >
                      <AppIcon name={name} className="h-8 w-8 border-0 bg-transparent text-inherit" />
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Screenshots */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="h-4 w-4" />
                Screenshots
              </CardTitle>
              <CardDescription>Shown on the marketplace listing. First one is the cover. 16:10 images look best (1280×800).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(manifest.screenshots ?? []).length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {(manifest.screenshots ?? []).map((path, index) => (
                    <div key={`${path}-${index}`} className="group relative overflow-hidden rounded-lg border border-border bg-muted">
                      <img src={mediaUrl(path)} alt="" className="h-24 w-full object-cover" />
                      <p className="truncate px-2 py-1 text-[10px] text-muted-foreground">
                        {path}
                        {index === 0 ? " · cover" : ""}
                      </p>
                      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 bg-card/90"
                          disabled={index === 0}
                          onClick={() => moveScreenshot(index, -1)}
                          title="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 bg-card/90"
                          disabled={index === (manifest.screenshots ?? []).length - 1}
                          onClick={() => moveScreenshot(index, 1)}
                          title="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="outline" className="h-7 w-7 bg-card/90" onClick={() => void removeScreenshot(index)} title="Remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No screenshots yet — add one to make the listing stand out.</p>
              )}
              <button
                type="button"
                onClick={() => shotInput.current?.click()}
                className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-border bg-card px-4 py-5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <Upload className="h-4 w-4" />
                Click to add screenshots (PNG, JPG, WebP)
              </button>
              <input
                ref={shotInput}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  if (event.target.files?.length) void uploadScreenshots(event.target.files)
                  event.target.value = ""
                }}
              />
            </CardContent>
          </Card>

          {/* Permissions */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Shield className="h-4 w-4" />
                    Permissions
                  </CardTitle>
                  <CardDescription>
                    Ask for the minimum. Every permission is shown to store owners before they install — the risk and impact text comes
                    from the platform itself.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {permissions.length} selected · {highestRisk(permissions)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={permissionQuery}
                  onChange={(event) => setPermissionQuery(event.target.value)}
                  placeholder={`Search ${PERMISSION_ORDER.length} permissions…`}
                  className="h-9 pl-8"
                  aria-label="Search permissions"
                />
              </div>
              {visiblePermissions.map((permission) => {
                const info = PERMISSION_INFO[permission]
                const checked = permissions.includes(permission)
                const styles = RISK_STYLES[info.risk]
                return (
                  <label
                    key={permission}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
                      checked ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30",
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      onCheckedChange={(value) => {
                        const next = value === true ? [...permissions, permission] : permissions.filter((entry) => entry !== permission)
                        set({ permissions: next })
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold">{info.label}</span>
                        <code className="text-[10.5px] text-muted-foreground">{permission}</code>
                        <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", styles.badge)}>
                          {info.risk} risk
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">{info.description}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                        <strong>Impact:</strong> {info.impact}
                      </span>
                    </span>
                  </label>
                )
              })}
              {visiblePermissions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  No permissions match “{permissionQuery}”.
                </p>
              ) : null}

              <div className="pt-2">
                <Label htmlFor="tables">Allowed store tables</Label>
                <Input
                  id="tables"
                  className="mt-1.5 max-w-xl"
                  placeholder="products, store_pages"
                  value={tablesText}
                  onChange={(event) =>
                    set({
                      allowedTables: event.target.value
                        .split(",")
                        .map((table) => table.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Comma-separated platform tables the plugin may read/write. Your own <code>plugin_&lt;slug&gt;_*</code> tables are always
                  available and don't need listing.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Rail */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Marketplace card</CardTitle>
              <CardDescription>Live preview of the listing card.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border bg-card p-3.5">
                <div className="flex gap-3">
                  <AppIcon name={manifest.icon} imageUrl={manifest.iconUrl} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold">
                      {manifest.name || "Untitled plugin"}
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">FREE</span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">
                      {manifest.description || "No description yet."}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-[11px] text-muted-foreground">
                  <span>★ new</span>
                  <span>0 installs</span>
                </div>
              </div>
              <p className="mt-2.5 text-[11px] text-muted-foreground">
                Full listing preview on the{" "}
                <Link to="/listing" className="text-primary hover:underline">
                  In Selldoes
                </Link>{" "}
                page.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="h-4 w-4" />
                What's editable here?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-[12.5px] text-muted-foreground">
              <p>
                This form writes to <code>plugin.json</code> directly (with undo).
              </p>
              <div className="border-t border-border pt-3">
                <p className="mb-2 font-semibold text-foreground">Edit in code:</p>
                <div className="flex flex-wrap gap-1.5">
                  {["entry", "ui", "apiRoutes", "publicRoutes", "jobs", "hooks", "configSchema", "storefrontWidget", "storefrontPages", "dashboardPages", "delivery", "dependencies"].map(
                    (key) => (
                      <code key={key} className="rounded bg-muted px-1.5 py-0.5 text-[10.5px]">
                        {key}
                      </code>
                    ),
                  )}
                </div>
                <p className="mt-2.5 text-[11px]">
                  Ask the AI rightbar to change those for you, or edit the file in your editor — the preview picks changes up automatically.
                </p>
              </div>
            </CardContent>
          </Card>

          {validation.warnings.length > 0 ? (
            <Callout kind="warn">
              <p className="font-semibold">Warnings</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </div>
      </div>

      {/* Save bar */}
      <div className="sticky bottom-4 z-20 rounded-xl border border-primary/35 bg-card/95 p-3 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Save plugin.json
          </Button>
          <Button variant="outline" onClick={() => void undo()} disabled={snapshots === 0}>
            <RefreshCw />
            Undo last save{snapshots ? ` (${snapshots})` : ""}
          </Button>
          <span className="ml-auto text-[11.5px] text-muted-foreground">
            {dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt} ✓` : validation.errors.length ? `${validation.errors.length} validation error(s)` : "Valid"}
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
    </div>
  )
}
