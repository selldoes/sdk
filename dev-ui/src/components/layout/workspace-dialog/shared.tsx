import { FilePlus2, Package, Sparkles } from "lucide-react"
import { ACCENTS, type AccentName } from "@/lib/project-colors"
import { cn } from "@/lib/utils"

// ─── Starting points ─────────────────────────────────────────────────────────
// The catalog itself lives in the CLI (`cli/create.mjs` → `/__ws/examples`), so
// the wizard, `selldoes create` and the templates on disk can never drift.

export type ExampleKind = "plugin" | "theme"

/** Accent + icon per example id, used by the cards and the workspace switcher. */
const EXAMPLE_STYLE: Record<string, { accent: AccentName; icon: string }> = {
  notes: { accent: "sky", icon: "layout-dashboard" },
  react: { accent: "violet", icon: "sparkles" },
  blank: { accent: "orange", icon: "file-plus" },
  importer: { accent: "amber", icon: "radio" },
  "ai-copy": { accent: "rose", icon: "sparkles" },
  delivery: { accent: "emerald", icon: "package" },
  widget: { accent: "sky", icon: "message-circle" },
  starter: { accent: "emerald", icon: "palette" },
  editorial: { accent: "amber", icon: "book-open" },
  bold: { accent: "rose", icon: "zap" },
  minimal: { accent: "sky", icon: "layout-grid" },
}

export function styleFor(id: string): { accent: AccentName; icon: string } {
  return EXAMPLE_STYLE[id] ?? { accent: "orange", icon: "puzzle" }
}

// ─── Thumbnails + the classic starting points ────────────────────────────────

type ThumbVariant =
  | "blank"
  | "dashboard"
  | "react"
  | "theme"
  | "scraper"
  | "copy"
  | "delivery"
  | "widget"
  | "editorial"
  | "bold"
  | "minimal"

const EXAMPLE_THUMBS: Record<string, ThumbVariant> = {
  notes: "dashboard",
  react: "react",
  blank: "blank",
  importer: "scraper",
  "ai-copy": "copy",
  delivery: "delivery",
  widget: "widget",
  starter: "theme",
  editorial: "editorial",
  bold: "bold",
  minimal: "minimal",
}

export function thumbFor(exampleId: string, kind: ExampleKind): ThumbVariant {
  return EXAMPLE_THUMBS[exampleId] ?? (kind === "theme" ? "theme" : "dashboard")
}

/** The four classic starting points, kept for the familiar first step. */
export const STARTERS: Array<{ id: string; name: string; desc: string; kind: ExampleKind; accent: AccentName; badge?: string }> =
  [
    {
      id: "blank",
      name: "Blank plugin",
      desc: "Manifest + entry file. Add hooks, jobs and a dashboard UI whenever you need them.",
      kind: "plugin",
      accent: "orange",
    },
    {
      id: "notes",
      name: "Plugin + dashboard UI",
      desc: "Plain-JS UI page wired to a notes API route — a working starting point.",
      kind: "plugin",
      accent: "sky",
    },
    {
      id: "react",
      name: "Plugin + React UI",
      desc: "TypeScript + React dashboard UI, bundled with esbuild on every save.",
      kind: "plugin",
      accent: "violet",
      badge: "runs npm install",
    },
    {
      id: "starter",
      name: "Storefront theme",
      desc: "Layouts, sections and theme settings for a storefront — no dashboard UI.",
      kind: "theme",
      accent: "emerald",
    },
  ]

/** CSS-drawn preview of what a starting point produces. */
export function Thumb({ variant, accent, className }: { variant: ThumbVariant; accent: AccentName; className?: string }) {
  const tone = ACCENTS[accent]
  const frame = "overflow-hidden rounded-lg border border-border bg-background"
  switch (variant) {
    case "blank":
      return (
        <div className={cn("flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/40", className)}>
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", tone.tile)}>
            <FilePlus2 className="h-[18px] w-[18px]" />
          </span>
          <span className="space-y-1">
            <span className="block h-2 w-20 rounded-full bg-foreground/15" />
            <span className="block h-2 w-14 rounded-full bg-foreground/10" />
          </span>
        </div>
      )
    case "dashboard":
      return (
        <div className={cn(frame, className)}>
          <div className="flex h-4 items-center gap-1 border-b border-border bg-muted/60 px-2">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
            <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
          </div>
          <div className={cn("mx-2 mt-2 flex h-7 items-center justify-between rounded px-2", tone.tile)}>
            <span className="h-1.5 w-10 rounded-full bg-current opacity-40" />
            <span className="h-1.5 w-5 rounded-full bg-current opacity-40" />
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-2">
            <span className="h-6 rounded bg-muted" />
            <span className="h-6 rounded bg-muted" />
          </div>
        </div>
      )
    case "react":
      return (
        <div className={cn("relative overflow-hidden rounded-lg border border-border bg-zinc-950", className)}>
          <div className="flex h-4 items-center gap-1 border-b border-white/10 px-2">
            <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
          </div>
          <div className="space-y-1.5 p-2.5">
            <span className={cn("block h-2.5 w-24 rounded-full opacity-80", tone.swatch)} />
            <span className="block h-2 w-32 rounded-full bg-white/15" />
            <span className="block h-2 w-20 rounded-full bg-white/10" />
            <span className="mt-1.5 block h-6 w-16 rounded-md bg-white/10" />
          </div>
          <span className="absolute right-2 top-6 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-white/70">TSX</span>
        </div>
      )
    case "theme":
      return (
        <div className={cn(frame, className)}>
          <div className="flex h-4 items-center gap-1 border-b border-border bg-muted/60 px-2">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
            <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
            <span className="h-1.5 w-6 rounded-full bg-foreground/10" />
          </div>
          <div className={cn("mx-2 mt-2 h-8 rounded", tone.tile)} />
          <div className="grid grid-cols-3 gap-1.5 p-2">
            <span className="h-5 rounded bg-muted" />
            <span className="h-5 rounded bg-muted" />
            <span className="h-5 rounded bg-muted" />
          </div>
        </div>
      )
    case "scraper":
      return (
        <div className={cn(frame, className)}>
          <div className={cn("flex h-6 items-center justify-between px-2.5", tone.tile)}>
            <span className="h-1.5 w-12 rounded-full bg-current opacity-40" />
            <span className="h-3 w-3 rounded-sm bg-current opacity-40" />
          </div>
          <div className="space-y-1.5 p-2.5">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded bg-muted" />
                <span className="h-1.5 flex-1 rounded-full bg-foreground/15" />
                <span className="h-1.5 w-6 rounded-full bg-foreground/10" />
              </div>
            ))}
          </div>
        </div>
      )
    case "copy":
      return (
        <div className={cn(frame, className)}>
          <div className="flex items-center gap-1.5 px-2.5 pt-2.5">
            <span className={cn("flex h-5 w-5 items-center justify-center rounded-md", tone.tile)}>
              <Sparkles className="h-3 w-3" />
            </span>
            <span className="h-1.5 w-16 rounded-full bg-foreground/15" />
          </div>
          <div className="space-y-1.5 p-2.5">
            <span className="block h-1.5 w-full rounded-full bg-foreground/10" />
            <span className="block h-1.5 w-4/5 rounded-full bg-foreground/10" />
            <span className="block h-1.5 w-3/5 rounded-full bg-foreground/10" />
          </div>
        </div>
      )
    case "delivery":
      return (
        <div className={cn(frame, className)}>
          <div className="flex items-center gap-2 p-2.5">
            <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", tone.tile)}>
              <Package className="h-4 w-4" />
            </span>
            <span className="flex-1 space-y-1.5">
              <span className="block h-1.5 w-20 rounded-full bg-foreground/15" />
              <span className="block h-1.5 w-12 rounded-full bg-foreground/10" />
            </span>
          </div>
          <div className="space-y-1 px-2.5 pb-2.5">
            <span className="block h-1.5 w-full rounded-full bg-muted" />
            <span className="block h-1.5 w-2/3 rounded-full bg-muted" />
          </div>
        </div>
      )
    case "widget":
      return (
        <div className={cn(frame, "relative", className)}>
          <div className="space-y-1.5 p-2.5">
            <span className="block h-1.5 w-2/3 rounded-full bg-foreground/10" />
            <span className="block h-1.5 w-1/2 rounded-full bg-foreground/10" />
          </div>
          <div className="absolute bottom-2 right-2 space-y-1.5">
            <span className="block h-7 w-24 rounded-lg border border-border bg-muted/60" />
            <span className={cn("ml-auto block h-7 w-7 rounded-full", tone.swatch)} />
          </div>
        </div>
      )
    case "editorial":
      return (
        <div className={cn(frame, className)}>
          <div className="px-2.5 pt-2.5">
            <span className="block h-2.5 w-4/5 rounded-sm bg-foreground/20" />
            <span className="mt-1.5 block h-2.5 w-3/5 rounded-sm bg-foreground/20" />
          </div>
          <div className="grid grid-cols-3 gap-1.5 p-2.5">
            <span className={cn("col-span-2 h-10 rounded", tone.tile)} />
            <span className="space-y-1">
              <span className="block h-3 rounded bg-muted" />
              <span className="block h-3 rounded bg-muted" />
              <span className="block h-3 rounded bg-muted" />
            </span>
          </div>
        </div>
      )
    case "bold":
      return (
        <div className={cn("relative overflow-hidden rounded-lg border border-border bg-zinc-950", className)}>
          <div className={cn("h-3", tone.swatch)} />
          <div className="px-2.5 pt-2">
            <span className="block h-3 w-3/4 rounded-sm bg-white/25" />
            <span className={cn("mt-1 block h-3 w-1/2 rounded-sm", tone.swatch)} />
          </div>
          <div className="grid grid-cols-3 gap-1.5 p-2.5">
            <span className="h-7 rounded bg-white/10" />
            <span className="h-7 rounded bg-white/10" />
            <span className="h-7 rounded bg-white/10" />
          </div>
        </div>
      )
    case "minimal":
      return (
        <div className={cn(frame, className)}>
          <div className="flex items-center justify-between px-2.5 pt-2.5">
            <span className="h-1.5 w-12 rounded-full bg-foreground/20" />
            <span className="h-1.5 w-6 rounded-full bg-foreground/10" />
          </div>
          <div className="grid grid-cols-4 gap-1.5 p-2.5">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((tile) => (
              <span key={tile} className="h-6 rounded bg-muted" />
            ))}
          </div>
        </div>
      )
  }
}
