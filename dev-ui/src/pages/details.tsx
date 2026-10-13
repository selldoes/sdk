import * as React from "react"
import { ChevronDown, ChevronUp, CreditCard, FileText, ImageIcon, Store, Trash2, Upload } from "lucide-react"
import { Link } from "react-router-dom"
import { AppIcon, PLUGIN_ICON_CHOICES } from "@/components/app-icon"
import { ManifestSaveBar } from "@/components/manifest-save-bar"
import { PageHead, Callout, PriceBadge } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { dev, readFileBase64 } from "@/lib/api"
import { ICON_ACCEPT, ICON_GUIDE, prepareIconFile } from "@/lib/icon-upload"
import { CATEGORIES } from "@/lib/permissions"
import { useManifestDraft } from "@/lib/use-manifest-draft"
import { useVisit } from "@/lib/use-visit"
import { cn, mediaUrl, priceBadge } from "@/lib/utils"
import type { PluginPricing } from "@/lib/types"
import { useApp } from "@/state/app"

const CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const

const BILLING_PERIODS: { value: NonNullable<PluginPricing["billingPeriod"]>; label: string }[] = [
  { value: "one_time", label: "One-time" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
]

/** Identity, icon and screenshots — the marketplace-facing metadata. Permissions live on their own page. */
export function DetailsPage() {
  const { setAssistantPage, toast } = useApp()
  useVisit("details")
  const draft = useManifestDraft({ label: "Details" })
  const manifest = draft.manifest
  const set = draft.set
  const iconInput = React.useRef<HTMLInputElement>(null)
  const shotInput = React.useRef<HTMLInputElement>(null)

  const tagsText = (manifest.tags ?? []).join(", ")

  const pricing = manifest.pricing
  const rawAmount = Number(pricing?.amount ?? 0)
  const isFree = !Number.isFinite(rawAmount) || rawAmount <= 0
  const setPricing = (patch: Partial<PluginPricing>) => {
    const next: PluginPricing = { amount: 0, currency: "USD", billingPeriod: "one_time", ...pricing, ...patch }
    if (!Number(next.amount) || Number(next.amount) <= 0) next.amount = 0
    set({ pricing: next })
  }
  // Free-form text while typing ("0.5", "9.") — the draft only sees numbers;
  // blur snaps the field back to the normalized value.
  const [amountText, setAmountText] = React.useState<string | null>(null)

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is editing plugin.json metadata (name, description, icon, screenshots, pricing). Current name: "${manifest.name}"; ${
        (manifest.screenshots ?? []).length
      } screenshot(s); pricing: ${isFree ? "free" : `${priceBadge(pricing)} (${pricing?.billingPeriod ?? "one_time"})`}.`,
      quick: ["Improve my marketplace description", "Suggest a better icon for this plugin"],
    })
  }, [setAssistantPage]) // eslint-disable-line react-hooks/exhaustive-deps

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
        title="Details"
        description={
          <>
            Identity, icon and screenshots — what store owners see in the marketplace and dashboard. Everything on this page is written to{" "}
            <code>plugin.json</code>.
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

          {/* Pricing */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4" />
                Pricing
              </CardTitle>
              <CardDescription>
                What store owners pay for your plugin. Written to <code>plugin.json</code> and used as the default price when you
                publish — the marketplace card preview updates live.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="price-amount">Amount</Label>
                  <Input
                    id="price-amount"
                    type="text"
                    inputMode="decimal"
                    className="mt-1.5"
                    placeholder="0 = free"
                    value={amountText ?? (Number(pricing?.amount ?? 0) ? String(pricing?.amount) : "")}
                    onChange={(event) => {
                      const text = event.target.value
                      setAmountText(text)
                      const parsed = Number(text)
                      if (text === "" || (!Number.isNaN(parsed) && parsed >= 0)) {
                        setPricing({ amount: Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0 })
                      }
                    }}
                    onBlur={() => setAmountText(null)}
                  />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Select value={pricing?.currency ?? "USD"} onValueChange={(value) => setPricing({ currency: value })}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Billing</Label>
                  <Select
                    value={pricing?.billingPeriod ?? "one_time"}
                    onValueChange={(value) => setPricing({ billingPeriod: value as PluginPricing["billingPeriod"] })}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BILLING_PERIODS.map((period) => (
                        <SelectItem key={period.value} value={period.value}>
                          {period.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="max-w-[180px]">
                <Label htmlFor="price-trial">Trial days</Label>
                <Input
                  id="price-trial"
                  type="number"
                  min={0}
                  max={90}
                  step={1}
                  className="mt-1.5"
                  value={String(Math.max(0, Math.min(Number(pricing?.trialDays ?? 0) || 0, 90)) || "")}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    setPricing({ trialDays: Number.isFinite(parsed) ? Math.max(0, Math.min(Math.round(parsed), 90)) : 0 })
                  }}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">0–90 days, shown as a chip on the card.</p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Amount 0 (or an empty block) means the plugin is free — exactly what the card shows today.
              </p>
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
        </div>

        {/* Rail — sticks beside the long form so the live card stays in view. */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="h-4 w-4" />
                Marketplace card
              </CardTitle>
              <CardDescription>Live preview of the listing card.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border bg-card p-3.5">
                <div className="flex gap-3">
                  <AppIcon name={manifest.icon} imageUrl={manifest.iconUrl} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold">
                      {manifest.name || "Untitled plugin"}
                      <PriceBadge pricing={pricing} />
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
                  Listing
                </Link>{" "}
                page.
              </p>
            </CardContent>
          </Card>

          {draft.validation.warnings.length > 0 ? (
            <Callout kind="warn">
              <p className="font-semibold">Warnings</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {draft.validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </div>
      </div>

      <ManifestSaveBar draft={draft} />
    </div>
  )
}
