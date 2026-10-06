import * as React from "react"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CloudDownload,
  FilePlus2,
  FolderOpen,
  Link2,
  Loader2,
  Package,
  Plus,
  Puzzle,
  Rocket,
  Search,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { resolveIcon } from "@/components/app-icon"
import { CATEGORIES, PERMISSION_INFO, permissionInfo, RISK_STYLES, filterPermissions } from "@/lib/permissions"
import { ACCENTS, ACCENT_NAMES, type AccentName } from "@/lib/project-colors"
import { ICON_ACCEPT, ICON_GUIDE, prepareIconFile, type PreparedIcon } from "@/lib/icon-upload"
import { cn } from "@/lib/utils"
import { confirmDiscardChanges } from "@/lib/dirty-guard"
import { useBusySet } from "@/lib/use-busy"
import { ws } from "@/lib/ws-api"
import type { WsExample, WsPackage } from "@/lib/ws-api"
import { useApp } from "@/state/app"
import { ImportPane, PullPane } from "./workspace-panes"

// ─── Starting points ─────────────────────────────────────────────────────────
// The catalog itself lives in the CLI (`cli/create.mjs` → `/__ws/examples`), so
// the wizard, `selldoes create` and the templates on disk can never drift.

type ExampleKind = "plugin" | "theme"

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

function styleFor(id: string): { accent: AccentName; icon: string } {
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

function thumbFor(exampleId: string, kind: ExampleKind): ThumbVariant {
  return EXAMPLE_THUMBS[exampleId] ?? (kind === "theme" ? "theme" : "dashboard")
}

/** The four classic starting points, kept for the familiar first step. */
const STARTERS: Array<{ id: string; name: string; desc: string; kind: ExampleKind; accent: AccentName; badge?: string }> = [
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
function Thumb({ variant, accent, className }: { variant: ThumbVariant; accent: AccentName; className?: string }) {
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

const RECOMMENDED_PERMISSIONS = ["db:read", "db:write", "db:schema"]
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

type WizardStep = "start" | "examples" | "details" | "options"

const STEP_TITLES: Record<WizardStep, string> = {
  start: "Start",
  examples: "Example",
  details: "Details",
  options: "Options",
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

// ─── The dialog ──────────────────────────────────────────────────────────────

export function WorkspaceDialog() {
  const {
    workspace,
    refreshWorkspace,
    refresh,
    toast,
    workspaceDialogOpen,
    setWorkspaceDialogOpen,
    workspaceDialogPane,
    noProject,
  } = useApp()

  const onboarding = noProject || (workspace?.projects.length ?? 0) === 0

  const [pane, setPane] = React.useState(workspaceDialogPane)
  const [step, setStep] = React.useState(0)
  const busy = useBusySet()

  // Create draft
  const [approach, setApproach] = React.useState<"template" | "ai">("template")
  const [kind, setKind] = React.useState<ExampleKind>("plugin")
  const [catalog, setCatalog] = React.useState<{ plugin: WsExample[]; theme: WsExample[] }>({ plugin: [], theme: [] })
  const [exampleId, setExampleId] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [description, setDescription] = React.useState("")
  const [version, setVersion] = React.useState("0.1.0")
  const [author, setAuthor] = React.useState("")
  const [category, setCategory] = React.useState("other")
  const [tags, setTags] = React.useState("")
  const [icon, setIcon] = React.useState("puzzle")
  const [customIcon, setCustomIcon] = React.useState<PreparedIcon | null>(null)
  const [accent, setAccent] = React.useState<AccentName>("orange")
  const [permissions, setPermissions] = React.useState<string[]>(RECOMMENDED_PERMISSIONS)

  const isAi = approach === "ai"
  const examplesForKind = catalog[kind] ?? []
  const example = examplesForKind.find((entry) => entry.id === exampleId) ?? examplesForKind[0] ?? null
  const flow: WizardStep[] = isAi ? ["start", "details", "options"] : ["start", "examples", "details", "options"]
  const currentStep = flow[Math.min(step, flow.length - 1)]

  // Fresh wizard every time the dialog opens; the example catalog is served by
  // the CLI so the cards match what `scaffoldProject` will actually produce.
  React.useEffect(() => {
    if (!workspaceDialogOpen) return
    setPane(workspaceDialogPane)
    setStep(0)
    busy.clear()
    setApproach("template")
    setKind("plugin")
    setExampleId("")
    setIcon("puzzle")
    setCustomIcon(null)
    setAccent("orange")
    setPermissions([...RECOMMENDED_PERMISSIONS])
    setPrompt("")
    setName("")
    setSlug("")
    setSlugTouched(false)
    setDescription("")
    setVersion("0.1.0")
    setCategory("other")
    setTags("")
    setAuthor(workspace?.account?.name ?? "")
    void ws
      .examples()
      .then((entries) => setCatalog(entries))
      .catch(() => {
        // The create call resolves defaults server-side if the catalog is down.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceDialogOpen, workspaceDialogPane])

  // Keep a valid example selected as the catalog loads and the kind changes.
  React.useEffect(() => {
    if (!workspaceDialogOpen) return
    const entries = catalog[kind] ?? []
    if (entries.length === 0) return
    if (!entries.some((entry) => entry.id === exampleId)) {
      setExampleId(entries[0].id)
      applyExampleStyle(entries[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, kind, exampleId, workspaceDialogOpen])

  const run = async (key: string, action: () => Promise<void>) => {
    await busy.run(key, async () => {
      try {
        await action()
      } catch (cause) {
        toast(cause instanceof Error ? cause.message : String(cause), "error")
      }
    })
  }

  const applyExampleStyle = (entry: WsExample) => {
    const style = styleFor(entry.id)
    setIcon(style.icon)
    setAccent(style.accent)
    setCustomIcon(null)
  }

  const chooseStarter = (starter: (typeof STARTERS)[number]) => {
    setKind(starter.kind)
    setExampleId(starter.id)
    setIcon(styleFor(starter.id).icon)
    setAccent(starter.accent)
    setCustomIcon(null)
  }

  const chooseExample = (entry: WsExample) => {
    setExampleId(entry.id)
    applyExampleStyle(entry)
  }

  const chooseBuiltInIcon = (name: string) => {
    setIcon(name)
    setCustomIcon(null)
  }

  const uploadCustomIcon = async (file: File) => {
    try {
      const prepared = await prepareIconFile(file)
      setCustomIcon(prepared)
      if (prepared.warning) toast(prepared.warning)
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), "error")
    }
  }

  const changeName = (value: string) => {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  const changeSlug = (value: string) => {
    setSlug(slugify(value))
    setSlugTouched(value.trim().length > 0)
  }

  const togglePermission = (permission: string) => {
    setPermissions((previous) =>
      previous.includes(permission) ? previous.filter((entry) => entry !== permission) : [...previous, permission],
    )
  }

  const versionValid = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
  const stepValid = (() => {
    if (currentStep === "start") return isAi ? prompt.trim().length > 0 : true
    if (currentStep === "examples") return Boolean(example)
    if (currentStep === "details") return name.trim().length > 0 && slug.trim().length > 1 && versionValid
    return true
  })()

  const doCreate = () => {
    if (!confirmDiscardChanges()) return
    return run(isAi ? "create-ai" : "create", async () => {
      const base = {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        version,
        author: author.trim() || undefined,
        category,
        icon,
        tags: parseList(tags),
        color: accent,
        ...(customIcon ? { iconData: customIcon.data, iconFileName: customIcon.name } : {}),
      }
      if (isAi) {
        const { project, files, iconError } = await ws.createAi({ ...base, prompt: prompt.trim() })
        await ws.select(project.id)
        await Promise.all([refreshWorkspace(), refresh()])
        setWorkspaceDialogOpen(false)
        toast(`Generated ${project.name} — ${files.length} file(s)`, "success")
        if (iconError) toast(`Icon not saved: ${iconError}`, "error")
      } else {
        const isTheme = kind === "theme"
        const { project, needsInstall, iconError } = await ws.create({
          ...base,
          kind,
          ...(example ? { example: example.id } : {}),
          // The example decides the UI; the server still needs the flavor for
          // the "npm install" follow-up on React projects.
          ...(example?.ui === "react" ? { uiFlavor: "react" as const } : {}),
          permissions,
          // Themes can't spawn a web preview — register them without selecting.
          ...(isTheme ? { select: false } : {}),
        })
        if (isTheme) {
          await refreshWorkspace()
          setWorkspaceDialogOpen(false)
          toast(`Added ${project.name} (theme) — theme previews need a store: selldoes dev --store <slug>`, "success")
        } else {
          await ws.select(project.id)
          await Promise.all([refreshWorkspace(), refresh()])
          setWorkspaceDialogOpen(false)
          toast(`Created ${project.name} → ${project.path}`, "success")
          if (needsInstall) toast("React UI projects need `npm install` in the new folder")
        }
        if (iconError) toast(`Icon not saved: ${iconError}`, "error")
      }
    })
  }

  const doImport = (folderPath: string) => {
    if (!confirmDiscardChanges()) return
    return run("import", async () => {
      const { project } = await ws.importFolder(folderPath.trim())
      await ws.select(project.id)
      await Promise.all([refreshWorkspace(), refresh()])
      setWorkspaceDialogOpen(false)
      toast(`Imported ${project.name}`, "success")
    })
  }

  const doPull = (pkg: WsPackage, options: { update?: boolean } = {}) => {
    if (!confirmDiscardChanges()) return
    const key = options.update ? `update:${pkg.slug}` : `pull:${pkg.slug}`
    return run(key, async () => {
      const local =
        workspace?.projects.find((project) => project.kind === "plugin" && project.slug === pkg.slug && !project.missing) ?? null
      const runPull = (force: boolean) =>
        ws.pull(pkg.slug, {
          ...(options.update ? { update: true } : {}),
          ...(force ? { force: true } : {}),
          ...(local ? { dir: local.path } : {}),
        })
      let response
      try {
        response = await runPull(false)
      } catch (cause) {
        const error = cause as Error & { code?: string }
        if (error.code !== "dirty" || !options.update) throw error
        if (!window.confirm(`${error.message}\n\nUpdate anyway? Files from your account will overwrite local ones.`)) return
        response = await runPull(true)
      }
      const { project, summary } = response
      if (!options.update) await ws.select(project.id)
      await Promise.all([refreshWorkspace(), refresh()])
      setWorkspaceDialogOpen(false)
      toast(
        options.update
          ? `Updated ${project.name}${summary?.version ? ` → v${summary.version}` : ""}`
          : `Pulled ${project.name} → ${project.path}`,
        "success",
      )
    })
  }

  const headerSubtitle = (() => {
    if (pane === "import") return "Point the workspace at an existing project folder or .zip"
    if (pane === "pull") return "Download one of your published packages into the workspace"
    if (currentStep === "start") return isAi ? "Describe what the plugin should do — the AI scaffolds the project" : "Choose what you're building, then pick an example next"
    if (currentStep === "examples") return `Starting points for your ${kind} — each one is a complete, working project`
    if (currentStep === "details") return example ? `Built from the ${example.name} example` : "Name your project and adjust the details"
    return isAi
      ? "Review — the AI picks the permissions its code needs"
      : kind === "theme"
        ? "Review the theme, then create it"
        : "Choose what it may access, then review"
  })()

  const footerHint = (() => {
    if (pane === "import") return "The folder is referenced, not copied — its git history stays intact."
    if (pane === "pull") return "Downloads a package you published to a folder you choose."
    const position = `Step ${step + 1} of ${flow.length}`
    if (currentStep === "start") return isAi ? `${position} · Describe it` : `${position} · Plugin or theme`
    if (currentStep === "examples") return `${position} · ${example ? `${example.name} selected` : "Choose an example"}`
    if (currentStep === "details") return `${position} · Details`
    return isAi ? `${position} · Review` : kind === "theme" ? `${position} · Review` : `${position} · Permissions & options`
  })()

  return (
    <Dialog
      open={workspaceDialogOpen}
      onOpenChange={(open) => {
        // First run has nothing behind the dialog (just a placeholder
        // dashboard) — don't let X, Escape or an outside click dismiss it.
        if (!open && onboarding) return
        setWorkspaceDialogOpen(open)
      }}
    >
      <DialogContent
        className="flex h-[86vh] max-h-[880px] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0"
        hideCloseButton={onboarding}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 py-3.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Plus className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-sm font-bold leading-tight">{onboarding ? "Set up your workspace" : "New workspace"}</DialogTitle>
            <DialogDescription className="truncate pr-8 text-[11px]">{headerSubtitle}</DialogDescription>
          </div>
        </div>

        {/* Body: rail + pane */}
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-52 shrink-0 flex-col gap-4 border-r border-border bg-muted/20 p-3">
            <div>
              <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Create</p>
              <div className="space-y-0.5">
                {flow.map((stepId, index) => {
                  const label = STEP_TITLES[stepId]
                  const active = pane === "new" && step === index
                  const done = pane === "new" && step > index
                  return (
                    <button
                      key={stepId}
                      type="button"
                      onClick={() => {
                        setPane("new")
                        setStep(index)
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                        active
                          ? "border border-border bg-background font-semibold shadow-sm"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                          active || done ? "bg-primary text-primary-foreground" : "border border-border",
                        )}
                      >
                        {done ? <Check className="h-3 w-3" /> : index + 1}
                      </span>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Add existing</p>
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => setPane("import")}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors",
                    pane === "import"
                      ? "border border-border bg-background font-semibold shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Import folder
                </button>
                <button
                  type="button"
                  onClick={() => setPane("pull")}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors",
                    pane === "pull"
                      ? "border border-border bg-background font-semibold shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <CloudDownload className="h-3.5 w-3.5" />
                  Pull package
                </button>
              </div>
            </div>
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {pane === "import" ? (
              <ImportPane busy={busy.isBusy("import")} onImport={doImport} />
            ) : pane === "pull" ? (
              <PullPane
                busyKeys={busy.busy}
                onPull={doPull}
                account={workspace?.account}
                projects={workspace?.projects}
                onAccountChange={refreshWorkspace}
              />
            ) : currentStep === "start" ? (
              <StepStart
                approach={approach}
                setApproach={setApproach}
                exampleId={example?.id ?? ""}
                onChooseStarter={chooseStarter}
                prompt={prompt}
                setPrompt={setPrompt}
                onOpenImport={() => setPane("import")}
                onOpenPull={() => setPane("pull")}
              />
            ) : currentStep === "examples" ? (
              <StepExamples kind={kind} examples={examplesForKind} exampleId={example?.id ?? ""} onSelect={chooseExample} />
            ) : currentStep === "details" ? (
              <StepDetails
                name={name}
                slug={slug}
                slugTouched={slugTouched}
                description={description}
                version={version}
                versionValid={versionValid}
                author={author}
                category={category}
                tags={tags}
                icon={icon}
                accent={accent}
                customIcon={customIcon}
                allowUpload={kind !== "theme"}
                onChangeName={changeName}
                onChangeSlug={changeSlug}
                setDescription={setDescription}
                setVersion={setVersion}
                setAuthor={setAuthor}
                setCategory={setCategory}
                setTags={setTags}
                setIcon={chooseBuiltInIcon}
                setAccent={setAccent}
                onUploadIcon={uploadCustomIcon}
                onClearIcon={() => setCustomIcon(null)}
              />
            ) : (
              <StepOptions
                isAi={isAi}
                kind={kind}
                example={example}
                permissions={permissions}
                togglePermission={togglePermission}
                name={name}
                slug={slug}
                description={description}
                version={version}
                author={author}
                category={category}
                icon={icon}
                accent={accent}
                customPreview={customIcon?.preview ?? null}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3.5">
          <p className="min-w-0 truncate text-[10.5px] text-muted-foreground">{footerHint}</p>
          <div className="flex shrink-0 items-center gap-2">
            {pane === "new" && step > 0 ? (
              <Button variant="outline" size="sm" disabled={busy.anyBusy} onClick={() => setStep(step - 1)}>
                <ArrowLeft />
                Back
              </Button>
            ) : null}
            {pane === "new" ? (
              step < flow.length - 1 ? (
                <Button size="sm" disabled={!stepValid} onClick={() => setStep(step + 1)}>
                  Continue
                  <ArrowRight />
                </Button>
              ) : (
                <Button size="sm" disabled={!stepValid || busy.anyBusy} onClick={() => void doCreate()}>
                  {busy.isBusy("create") || busy.isBusy("create-ai") ? <Loader2 className="animate-spin" /> : <Rocket />}
                  Create workspace
                </Button>
              )
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Step 1 · Start ──────────────────────────────────────────────────────────

function StepStart({
  approach,
  setApproach,
  exampleId,
  onChooseStarter,
  prompt,
  setPrompt,
  onOpenImport,
  onOpenPull,
}: {
  approach: "template" | "ai"
  setApproach: (approach: "template" | "ai") => void
  exampleId: string
  onChooseStarter: (starter: (typeof STARTERS)[number]) => void
  prompt: string
  setPrompt: (prompt: string) => void
  onOpenImport: () => void
  onOpenPull: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { id: "template", title: "Start from an example", desc: "Pick a complete, working project and adjust everything next.", icon: Puzzle },
            { id: "ai", title: "Describe it, AI builds it", desc: "Write what the plugin should do and generate the files.", icon: Sparkles },
          ] as const
        ).map(({ id, title, desc, icon: Icon }) => {
          const selected = approach === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setApproach(id)}
              className={cn(
                "rounded-xl border-2 p-3 text-left transition-all",
                selected ? "border-primary bg-primary/[0.03]" : "border-border hover:border-primary/40",
              )}
            >
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <p className="mt-2 text-xs font-semibold">{title}</p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{desc}</p>
            </button>
          )
        })}
      </div>

      {approach === "template" ? (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">What are you building?</p>
          <div className="grid grid-cols-2 gap-3">
            {STARTERS.map((starter) => {
              const selected = starter.id === exampleId
              return (
                <button
                  key={starter.id}
                  type="button"
                  onClick={() => onChooseStarter(starter)}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border-2 p-2.5 text-left transition-all",
                    selected ? "border-primary bg-primary/[0.03] shadow-sm" : "border-border hover:border-primary/40",
                  )}
                >
                  <Thumb variant={thumbFor(starter.id, starter.kind)} accent={starter.accent} className="h-24 w-full" />
                  <div className="mt-2.5 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                        {starter.name}
                        {starter.badge ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{starter.badge}</span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{starter.desc}</p>
                    </div>
                    <span
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                        selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent",
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Wand2 className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-xs font-semibold">Describe your plugin</p>
              <p className="text-[10.5px] text-muted-foreground">The AI scaffolds a full project — you name it in the next step.</p>
            </div>
          </div>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            autoFocus
            placeholder={'e.g. "a plugin that shows a live visitor counter on product pages"'}
            className="text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              "a plugin that shows a live visitor counter on product pages",
              "reward customers with points on every order",
              "a scraper that imports products from a supplier feed",
            ].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setPrompt(sample)}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {sample}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5">
        <span className="text-[10.5px] text-muted-foreground">Already have a project?</span>
        <button type="button" onClick={onOpenImport} className="text-[11px] font-semibold text-primary hover:underline">
          Import a folder
        </button>
        <span className="text-muted-foreground/50">·</span>
        <button type="button" onClick={onOpenPull} className="text-[11px] font-semibold text-primary hover:underline">
          Pull from your account
        </button>
      </div>
    </div>
  )
}

// ─── Step 2 · Example ────────────────────────────────────────────────────────

function StepExamples({
  kind,
  examples,
  exampleId,
  onSelect,
}: {
  kind: ExampleKind
  examples: WsExample[]
  exampleId: string
  onSelect: (example: WsExample) => void
}) {
  if (examples.length === 0) {
    return <p className="text-xs text-muted-foreground">Loading examples…</p>
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {examples.map((entry) => (
          <ExampleCard key={entry.id} example={entry} kind={kind} selected={entry.id === exampleId} onSelect={() => onSelect(entry)} />
        ))}
      </div>
      <p className="text-[10.5px] leading-snug text-muted-foreground">
        Every example is a complete project — jobs, routes, dashboard pages and a README explaining how it works. Everything is
        yours to edit after creating.
      </p>
    </div>
  )
}

function ExampleCard({
  example,
  kind,
  selected,
  onSelect,
}: {
  example: WsExample
  kind: ExampleKind
  selected: boolean
  onSelect: () => void
}) {
  const style = styleFor(example.id)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border-2 p-2.5 text-left transition-all",
        selected ? "border-primary bg-primary/[0.03] shadow-sm" : "border-border hover:border-primary/40",
      )}
    >
      <Thumb variant={thumbFor(example.id, kind)} accent={style.accent} className="h-24 w-full" />
      <div className="mt-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            {example.name}
            {example.badge ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{example.badge}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{example.description}</p>
          {kind === "plugin" ? (
            <p className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/80">
              {example.ui === "react" ? "React dashboard UI" : example.ui === "js" ? "Dashboard UI" : "Kit sections only"}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent",
          )}
        >
          <Check className="h-3 w-3" />
        </span>
      </div>
    </button>
  )
}

// ─── Step 3 · Details ────────────────────────────────────────────────────────

function StepDetails({
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
        <Input value={name} onChange={(event) => onChangeName(event.target.value)} placeholder="Loyalty Points" className="h-9" autoFocus />
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
                      ? cn("border-transparent ring-2 ring-offset-2 ring-offset-background", ACCENTS[accent].ring, ACCENTS[accent].tile)
                      : "border-dashed border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {customIcon ? <img src={customIcon.preview} alt="" className="h-full w-full object-cover" /> : <Upload className="h-3.5 w-3.5" />}
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
                        ? cn("border-transparent ring-2 ring-offset-2 ring-offset-background", ACCENTS[accent].ring, ACCENTS[accent].tile)
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
                    accent === entry ? "scale-110 ring-2 ring-foreground/40 ring-offset-2 ring-offset-background" : "opacity-70 hover:opacity-100",
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
            {allowUpload ? ICON_GUIDE : "Themes keep their storefront styling in manifest.json — the accent color is only cosmetic here."}
          </p>
        </div>
      </Field>
    </div>
  )
}

// ─── Step 4 · Options & review ───────────────────────────────────────────────

function StepOptions({
  isAi,
  kind,
  example,
  permissions,
  togglePermission,
  name,
  slug,
  description,
  version,
  author,
  category,
  icon,
  accent,
  customPreview,
}: {
  isAi: boolean
  kind: ExampleKind
  example: WsExample | null
  permissions: string[]
  togglePermission: (permission: string) => void
  name: string
  slug: string
  description: string
  version: string
  author: string
  category: string
  icon: string
  accent: AccentName
  customPreview: string | null
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        {isAi ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5 text-[10.5px] leading-snug text-muted-foreground">
            The AI writes the manifest and grants only the permissions its code actually uses — minimum needed, never more. You can
            tighten them in <code className="text-[10px]">plugin.json</code> afterwards.
          </div>
        ) : kind === "theme" ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5 text-[10.5px] leading-snug text-muted-foreground">
            Themes render the storefront directly — no dashboard UI and no permissions to declare. Preview one with{" "}
            <code className="text-[10px]">selldoes dev --store &lt;slug&gt;</code>.
          </div>
        ) : (
          <>
            {example ? (
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                <p className="text-xs font-semibold">{example.name}</p>
                <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{example.description}</p>
                {example.ui === "react" ? (
                  <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
                    React UI projects need <code className="text-[10px]">npm install</code> — the shell will remind you after creating.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Permissions</p>
                <Badge variant="secondary" className="text-[9px]">
                  db:* recommended
                </Badge>
              </div>
              <PermissionPicker permissions={permissions} onToggle={togglePermission} />
            </div>
          </>
        )}
      </div>

      <ReviewCard
        kind={kind}
        example={example}
        isAi={isAi}
        name={name}
        slug={slug}
        description={description}
        version={version}
        author={author}
        category={category}
        icon={icon}
        accent={accent}
        permissionCount={permissions.length}
        customPreview={customPreview}
      />
    </div>
  )
}

// ─── Shared pieces ───────────────────────────────────────────────────────────

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

function PermissionPicker({ permissions, onToggle }: { permissions: string[]; onToggle: (permission: string) => void }) {
  const [showAll, setShowAll] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const all = Object.keys(PERMISSION_INFO)
  const matches = filterPermissions(all, query)
  const searching = query.trim().length > 0
  const visible = searching ? matches : showAll ? all : all.slice(0, 8)

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${all.length} permissions…`}
          className="h-8 pl-8 text-xs"
          aria-label="Search permissions"
        />
      </div>
      {visible.map((permission) => {
        const info = permissionInfo(permission)
        const risk = RISK_STYLES[info.risk]
        const checked = permissions.includes(permission)
        return (
          <label
            key={permission}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
              checked ? "border-primary/40 bg-primary/[0.03]" : "border-border hover:bg-muted/40",
            )}
          >
            <Checkbox checked={checked} onCheckedChange={() => onToggle(permission)} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold">{info.label}</span>
                <code className="rounded bg-muted px-1 py-0.5 text-[9.5px] text-muted-foreground">{permission}</code>
                <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", risk.badge)}>
                  {info.risk}
                </span>
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">{info.description}</span>
            </span>
          </label>
        )
      })}
      {searching ? (
        matches.length === 0 ? (
          <p className="px-1 pt-1 text-[11px] text-muted-foreground">No permissions match “{query}”.</p>
        ) : null
      ) : (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="flex items-center gap-1 px-1 pt-0.5 text-[11px] font-semibold text-primary hover:underline"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", showAll && "rotate-180")} />
          {showAll ? "Show fewer permissions" : `Show all ${all.length} permissions`}
        </button>
      )}
    </div>
  )
}

function ReviewCard({
  kind,
  example,
  isAi,
  name,
  slug,
  description,
  version,
  author,
  category,
  icon,
  accent,
  permissionCount,
  customPreview,
}: {
  kind: ExampleKind
  example: WsExample | null
  isAi: boolean
  name: string
  slug: string
  description: string
  version: string
  author: string
  category: string
  icon: string
  accent: AccentName
  permissionCount: number
  customPreview: string | null
}) {
  const Icon = resolveIcon(icon)
  const rows: Array<[string, string]> = [
    ["Kind", isAi ? "Plugin (AI)" : kind === "theme" ? "Theme" : "Plugin"],
    ["Version", version || "0.1.0"],
    ["Author", author || "—"],
    [
      "Dashboard UI",
      isAi
        ? "AI decides"
        : kind === "theme"
          ? "none (storefront theme)"
          : example?.ui === "react"
            ? "React TSX"
            : example?.ui === "js"
              ? "Plain JS"
              : "kit sections only",
    ],
    ["Category", category],
    [
      "Permissions",
      isAi ? "AI minimal" : kind === "theme" ? "n/a (theme)" : permissionCount > 0 ? `${permissionCount} selected` : "none",
    ],
  ]
  return (
    <div className="self-start rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2.5">
        {isAi ? (
          <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
        ) : example ? (
          <span className={cn("flex h-12 w-16 shrink-0 items-center justify-center rounded-lg border border-border", ACCENTS[styleFor(example.id).accent].tile)}>
            {React.createElement(resolveIcon(styleFor(example.id).icon), { className: "h-5 w-5" })}
          </span>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md", ACCENTS[accent].tile)}>
            {customPreview ? <img src={customPreview} alt="" className="h-full w-full object-cover" /> : <Icon className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{name || "untitled-workspace"}</p>
            <p className="truncate text-[10.5px] text-muted-foreground">./{slug || "untitled-workspace"}</p>
          </div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border pt-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
            <dd className="truncate text-[11.5px] font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {example && !isAi && kind === "plugin" ? (
        <p className="mt-3 border-t border-border pt-2.5 text-[10.5px] leading-snug text-muted-foreground">
          Built from the <span className="font-semibold">{example.name}</span> example.
        </p>
      ) : null}
      {description ? <p className="mt-3 border-t border-border pt-2.5 text-[11px] leading-snug text-muted-foreground">{description}</p> : null}
    </div>
  )
}
