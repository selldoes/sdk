import { Link2, Upload } from "lucide-react"
import type * as React from "react"
import { resolveIcon } from "@/components/app-icon"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ICON_ACCEPT, ICON_GUIDE, type PreparedIcon } from "@/lib/icon-upload"
import { CATEGORIES } from "@/lib/permissions"
import { ACCENT_NAMES, ACCENTS, type AccentName } from "@/lib/project-colors"
import { cn } from "@/lib/utils"

const ICON_CHOICES = [
  "puzzle",
  "layout-dashboard",
  "star",
  "bar-chart-2",
  "ticket",
  "mail",
  "message-circle",
  "shopping-cart",
  "bell",
  "bot",
  "sparkles",
  "shield",
]

// ─── Step 3 · Details ────────────────────────────────────────────────────────

export function StepDetails({
  name,
  slug,
  slugTouched,
  description,
  version,
  versionValid,
  author,
  category,
  tags,
  icon,
  accent,
  customIcon,
  allowUpload,
  onChangeName,
  onChangeSlug,
  setDescription,
  setVersion,
  setAuthor,
  setCategory,
  setTags,
  setIcon,
  setAccent,
  onUploadIcon,
  onClearIcon,
}: {
  name: string
  slug: string
  slugTouched: boolean
  description: string
  version: string
  versionValid: boolean
  author: string
  category: string
  tags: string
  icon: string
  accent: AccentName
  customIcon: PreparedIcon | null
  allowUpload: boolean
  onChangeName: (value: string) => void
  onChangeSlug: (value: string) => void
  setDescription: (value: string) => void
  setVersion: (value: string) => void
  setAuthor: (value: string) => void
  setCategory: (value: string) => void
  setTags: (value: string) => void
  setIcon: (value: string) => void
  setAccent: (value: AccentName) => void
  onUploadIcon: (file: File) => void
  onClearIcon: () => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" hint="Shown on your dashboard and in the marketplace.">
        <Input
          value={name}
          onChange={(event) => onChangeName(event.target.value)}
          placeholder="Loyalty Points"
          className="h-9"
          autoFocus
        />
      </Field>
      <Field label="Version" hint={versionValid ? "Semver, e.g. 0.1.0" : "Must look like 0.1.0"}>
        <Input
          value={version}
          onChange={(event) => setVersion(event.target.value)}
          placeholder="0.1.0"
          className={cn("h-9", !versionValid && "border-destructive focus-visible:ring-destructive")}
        />
      </Field>
      <Field label="Slug" hint={slugTouched ? "Permanent after publishing." : "Auto-generated from the name."}>
        <div className="flex items-center overflow-hidden rounded-md border border-input shadow-sm focus-within:ring-1 focus-within:ring-ring">
          <span className="flex h-9 shrink-0 items-center border-r border-input bg-muted px-2.5 text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
          </span>
          <input
            value={slug}
            onChange={(event) => onChangeSlug(event.target.value)}
            placeholder="loyalty-points"
            className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </Field>
      <Field label="Author" hint="Your developer name on the marketplace.">
        <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Your name" className="h-9" />
      </Field>
      <Field label="Description" className="sm:col-span-2" hint="A short description of the project — what it does.">
        <Textarea
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Reward customers with points on every order."
          className="min-h-[64px] text-sm"
        />
      </Field>
      <Field label="Category">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {entry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Tags" hint="Comma separated, optional.">
        <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="loyalty, rewards" className="h-9" />
      </Field>
      <Field label="Icon & color" className="sm:col-span-2" hint="The tile shown in the sidebar switcher.">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-2.5">
            <div className="flex flex-wrap gap-1">
              {allowUpload ? (
                <label
                  title="Upload your own icon"
                  className={cn(
                    "relative flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-md border transition-colors",
                    customIcon
                      ? cn(
                          "border-transparent ring-2 ring-offset-2 ring-offset-background",
                          ACCENTS[accent].ring,
                          ACCENTS[accent].tile,
                        )
                      : "border-dashed border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {customIcon ? (
                    <img src={customIcon.preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  <input
                    type="file"
                    accept={ICON_ACCEPT}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) onUploadIcon(file)
                      event.target.value = ""
                    }}
                  />
                </label>
              ) : null}
              {ICON_CHOICES.map((iconName) => {
                const Icon = resolveIcon(iconName)
                const selected = !customIcon && icon === iconName
                return (
                  <button
                    key={iconName}
                    type="button"
                    title={iconName}
                    onClick={() => setIcon(iconName)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                      selected
                        ? cn(
                            "border-transparent ring-2 ring-offset-2 ring-offset-background",
                            ACCENTS[accent].ring,
                            ACCENTS[accent].tile,
                          )
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                )
              })}
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              {ACCENT_NAMES.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  title={entry}
                  onClick={() => setAccent(entry)}
                  className={cn(
                    "h-5 w-5 rounded-full transition-transform",
                    ACCENTS[entry].swatch,
                    accent === entry
                      ? "scale-110 ring-2 ring-foreground/40 ring-offset-2 ring-offset-background"
                      : "opacity-70 hover:opacity-100",
                  )}
                />
              ))}
            </div>
            {customIcon ? (
              <button type="button" onClick={onClearIcon} className="text-[10.5px] font-semibold text-primary hover:underline">
                Remove image
              </button>
            ) : null}
          </div>
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            {allowUpload
              ? ICON_GUIDE
              : "Themes keep their storefront styling in manifest.json — the accent color is only cosmetic here."}
          </p>
        </div>
      </Field>
    </div>
  )
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-[10.5px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
