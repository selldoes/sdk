import * as React from "react"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CloudDownload,
  FilePlus2,
  FolderOpen,
  Loader2,
  Link2,
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { resolveIcon } from "@/components/app-icon"
import { CATEGORIES, PERMISSION_INFO, permissionInfo, RISK_STYLES, filterPermissions } from "@/lib/permissions"
import { ACCENTS, ACCENT_NAMES, type AccentName } from "@/lib/project-colors"
import { ICON_ACCEPT, ICON_GUIDE, prepareIconFile, type PreparedIcon } from "@/lib/icon-upload"
import { cn } from "@/lib/utils"
import { confirmDiscardChanges } from "@/lib/dirty-guard"
import { ws } from "@/lib/ws-api"
import type { WsPackage } from "@/lib/ws-api"
import { useApp } from "@/state/app"
import { ImportPane, PullPane } from "./workspace-panes"

// ─── Starting points (mirror what `scaffoldProject` actually produces) ───────

type TemplateId = "blank" | "starter" | "react" | "theme"

interface StarterTemplate {
  id: TemplateId
  name: string
  desc: string
  kind: "plugin" | "theme"
  withUi: boolean
  uiFlavor: "js" | "react"
  accent: AccentName
  icon: string
  badge?: string
}

const TEMPLATES: StarterTemplate[] = [
  {
    id: "blank",
    name: "Blank plugin",
    desc: "Manifest + entry file. Add hooks, jobs and a dashboard UI whenever you need them.",
    kind: "plugin",
    withUi: false,
    uiFlavor: "js",
    accent: "orange",
    icon: "puzzle",
  },
  {
    id: "starter",
    name: "Plugin + dashboard UI",
    desc: "Plain-JS UI page wired to a notes API route — a working starting point.",
    kind: "plugin",
    withUi: true,
    uiFlavor: "js",
    accent: "sky",
    icon: "layout-dashboard",
  },
  {
    id: "react",
    name: "Plugin + React UI",
    desc: "TypeScript + React dashboard UI, bundled with esbuild on every save.",
    kind: "plugin",
    withUi: true,
    uiFlavor: "react",
    accent: "violet",
    icon: "sparkles",
    badge: "runs npm install",
  },
  {
    id: "theme",
    name: "Storefront theme",
    desc: "Layouts, sections and theme settings for a storefront — no dashboard UI.",
    kind: "theme",
    withUi: false,
    uiFlavor: "js",
    accent: "emerald",
    icon: "palette",
  },
]

const STEP_LABELS = ["Start", "Details", "Options"]
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
  const [busy, setBusy] = React.useState<string | null>(null)

  // Create draft
  const [approach, setApproach] = React.useState<"template" | "ai">("template")
  const [templateId, setTemplateId] = React.useState<TemplateId>("starter")
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
  const [withUi, setWithUi] = React.useState(true)
  const [uiFlavor, setUiFlavor] = React.useState<"js" | "react">("js")
  const [permissions, setPermissions] = React.useState<string[]>(RECOMMENDED_PERMISSIONS)

  const template = TEMPLATES.find((entry) => entry.id === templateId) ?? TEMPLATES[0]
  const isAi = approach === "ai"

  // Fresh wizard every time the dialog opens.
  React.useEffect(() => {
    if (!workspaceDialogOpen) return
    setPane(workspaceDialogPane)
    setStep(0)
    setBusy(null)
    setApproach("template")
    setTemplateId("starter")
    setWithUi(true)
    setUiFlavor("js")
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceDialogOpen, workspaceDialogPane])

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    try {
      await action()
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), "error")
    } finally {
      setBusy(null)
    }
  }

  const chooseTemplate = (entry: StarterTemplate) => {
    setTemplateId(entry.id)
    setWithUi(entry.withUi)
    setUiFlavor(entry.uiFlavor)
    setIcon(entry.icon)
    setCustomIcon(null)
    setAccent(entry.accent)
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
  const stepValid =
    step === 0
      ? isAi
        ? prompt.trim().length > 0
        : true
      : step === 1
        ? name.trim().length > 0 && slug.trim().length > 1 && versionValid
        : true

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
        const isTheme = template.kind === "theme"
        const { project, needsInstall, iconError } = await ws.create({
          ...base,
          kind: template.kind,
          withUi: isTheme ? false : withUi,
          uiFlavor,
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

  const doPull = (pkg: WsPackage) => {
    if (!confirmDiscardChanges()) return
    return run(`pull:${pkg.slug}`, async () => {
      const { project } = await ws.pull(pkg.slug)
      await ws.select(project.id)
      await Promise.all([refreshWorkspace(), refresh()])
      setWorkspaceDialogOpen(false)
      toast(`Pulled ${project.name} → ${project.path}`, "success")
    })
  }

  const headerSubtitle = (() => {
    if (pane === "import") return "Point the workspace at an existing project folder or .zip"
    if (pane === "pull") return "Download one of your published packages into the workspace"
    if (step === 0) return isAi ? "Describe what the plugin should do — the AI scaffolds the project" : "Pick a working starter and adjust everything next"
    if (step === 1) return `Using the ${template.name} starter`
    return isAi
      ? "Review — the AI picks the permissions its code needs"
      : template.kind === "theme"
        ? "Review the theme, then create it"
        : "Choose what it may access, then review"
  })()

  const footerHint = (() => {
    if (pane === "import") return "The folder is referenced, not copied — its git history stays intact."
    if (pane === "pull") return "Downloads a package you published to a folder you choose."
    if (step === 0) return isAi ? "Step 1 of 3 · Describe it" : `Step 1 of 3 · ${template.name} selected`
    if (step === 1) return "Step 2 of 3 · Details"
    if (isAi || template.kind === "theme") return "Step 3 of 3 · Review"
    return "Step 3 of 3 · Permissions & options"
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
                {STEP_LABELS.map((label, index) => {
                  const active = pane === "new" && step === index
                  const done = pane === "new" && step > index
                  return (
                    <button
                      key={label}
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
              <ImportPane busy={busy === "import"} onImport={doImport} />
            ) : pane === "pull" ? (
              <PullPane busyKey={busy} onPull={doPull} account={workspace?.account} onAccountChange={refreshWorkspace} />
            ) : step === 0 ? (
              <StepStart
                approach={approach}
                setApproach={setApproach}
                templateId={templateId}
                onChooseTemplate={chooseTemplate}
                prompt={prompt}
                setPrompt={setPrompt}
                onOpenImport={() => setPane("import")}
                onOpenPull={() => setPane("pull")}
              />
            ) : step === 1 ? (
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
                allowUpload={template.kind !== "theme"}
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
                template={template}
                withUi={withUi}
                setWithUi={setWithUi}
                uiFlavor={uiFlavor}
                setUiFlavor={setUiFlavor}
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
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => setStep(step - 1)}>
                <ArrowLeft />
                Back
              </Button>
            ) : null}
            {pane === "new" ? (
              step < 2 ? (
                <Button size="sm" disabled={!stepValid} onClick={() => setStep(step + 1)}>
                  Continue
                  <ArrowRight />
                </Button>
              ) : (
                <Button size="sm" disabled={!stepValid || busy !== null} onClick={() => void doCreate()}>
                  {busy === "create" || busy === "create-ai" ? <Loader2 className="animate-spin" /> : <Rocket />}
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
  templateId,
  onChooseTemplate,
  prompt,
  setPrompt,
  onOpenImport,
  onOpenPull,
}: {
  approach: "template" | "ai"
  setApproach: (approach: "template" | "ai") => void
  templateId: TemplateId
  onChooseTemplate: (template: StarterTemplate) => void
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
            { id: "template", title: "Start from a template", desc: "Pick a working starter and adjust everything next.", icon: Puzzle },
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
        <div className="grid grid-cols-2 gap-3">
          {TEMPLATES.map((entry) => (
            <TemplateCard key={entry.id} template={entry} selected={entry.id === templateId} onSelect={() => onChooseTemplate(entry)} />
          ))}
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
            ].map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {example}
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

// ─── Step 2 · Details ────────────────────────────────────────────────────────

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

// ─── Step 3 · Options & review ───────────────────────────────────────────────

function StepOptions({
  isAi,
  template,
  withUi,
  setWithUi,
  uiFlavor,
  setUiFlavor,
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
  template: StarterTemplate
  withUi: boolean
  setWithUi: (value: boolean) => void
  uiFlavor: "js" | "react"
  setUiFlavor: (value: "js" | "react") => void
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
        ) : template.kind === "theme" ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5 text-[10.5px] leading-snug text-muted-foreground">
            Themes render the storefront directly — no dashboard UI and no permissions to declare. Preview one with{" "}
            <code className="text-[10px]">selldoes dev --store &lt;slug&gt;</code>.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold">Dashboard UI</p>
                <p className="text-[10.5px] text-muted-foreground">Render your own page in the store dashboard.</p>
              </div>
              <div className="flex items-center gap-3">
                {withUi ? (
                  <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
                    {(
                      [
                        { value: "js", label: "Plain JS" },
                        { value: "react", label: "React TSX" },
                      ] as const
                    ).map((flavor) => (
                      <button
                        key={flavor.value}
                        type="button"
                        onClick={() => setUiFlavor(flavor.value)}
                        className={cn(
                          "h-6 rounded-md px-2 text-[11px] font-semibold transition-colors",
                          uiFlavor === flavor.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {flavor.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <Switch checked={withUi} onCheckedChange={(checked) => setWithUi(checked)} />
              </div>
            </div>

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

        {withUi && template.kind === "plugin" && uiFlavor === "react" && !isAi ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-[10.5px] leading-snug text-muted-foreground">
            React UI projects need <code className="text-[10px]">npm install</code> — the shell will remind you after creating.
          </p>
        ) : null}
      </div>

      <ReviewCard
        template={template}
        isAi={isAi}
        name={name}
        slug={slug}
        description={description}
        version={version}
        author={author}
        category={category}
        icon={icon}
        accent={accent}
        withUi={withUi}
        uiFlavor={uiFlavor}
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

function TemplateThumb({ template, className }: { template: StarterTemplate; className?: string }) {
  const accent = ACCENTS[template.accent]
  if (template.id === "blank") {
    return (
      <div className={cn("flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/40", className)}>
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", accent.tile)}>
          <FilePlus2 className="h-[18px] w-[18px]" />
        </span>
        <span className="space-y-1">
          <span className="block h-2 w-20 rounded-full bg-foreground/15" />
          <span className="block h-2 w-14 rounded-full bg-foreground/10" />
        </span>
      </div>
    )
  }
  if (template.id === "theme") {
    return (
      <div className={cn("overflow-hidden rounded-lg border border-border bg-background", className)}>
        <div className="flex h-4 items-center gap-1 border-b border-border bg-muted/60 px-2">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
          <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
          <span className="h-1.5 w-6 rounded-full bg-foreground/10" />
        </div>
        <div className={cn("mx-2 mt-2 h-8 rounded", accent.tile)} />
        <div className="grid grid-cols-3 gap-1.5 p-2">
          <span className="h-5 rounded bg-muted" />
          <span className="h-5 rounded bg-muted" />
          <span className="h-5 rounded bg-muted" />
        </div>
      </div>
    )
  }
  if (template.id === "react") {
    return (
      <div className={cn("relative overflow-hidden rounded-lg border border-border bg-zinc-950", className)}>
        <div className="flex h-4 items-center gap-1 border-b border-white/10 px-2">
          <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
        </div>
        <div className="space-y-1.5 p-2.5">
          <span className={cn("block h-2.5 w-24 rounded-full opacity-80", accent.swatch)} />
          <span className="block h-2 w-32 rounded-full bg-white/15" />
          <span className="block h-2 w-20 rounded-full bg-white/10" />
          <span className="mt-1.5 block h-6 w-16 rounded-md bg-white/10" />
        </div>
        <span className="absolute right-2 top-6 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-white/70">TSX</span>
      </div>
    )
  }
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-background", className)}>
      <div className="flex h-4 items-center gap-1 border-b border-border bg-muted/60 px-2">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
      </div>
      <div className={cn("mx-2 mt-2 flex h-7 items-center justify-between rounded px-2", accent.tile)}>
        <span className="h-1.5 w-10 rounded-full bg-current opacity-40" />
        <span className="h-1.5 w-5 rounded-full bg-current opacity-40" />
      </div>
      <div className="grid grid-cols-2 gap-1.5 p-2">
        <span className="h-6 rounded bg-muted" />
        <span className="h-6 rounded bg-muted" />
      </div>
    </div>
  )
}

function TemplateCard({ template, selected, onSelect }: { template: StarterTemplate; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative overflow-hidden rounded-xl border-2 p-2.5 text-left transition-all",
        selected ? "border-primary bg-primary/[0.03] shadow-sm" : "border-border hover:border-primary/40",
      )}
    >
      <TemplateThumb template={template} className="h-24 w-full" />
      <div className="mt-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            {template.name}
            {template.badge ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{template.badge}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{template.desc}</p>
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
  template,
  isAi,
  name,
  slug,
  description,
  version,
  author,
  category,
  icon,
  accent,
  withUi,
  uiFlavor,
  permissionCount,
  customPreview,
}: {
  template: StarterTemplate
  isAi: boolean
  name: string
  slug: string
  description: string
  version: string
  author: string
  category: string
  icon: string
  accent: AccentName
  withUi: boolean
  uiFlavor: "js" | "react"
  permissionCount: number
  customPreview: string | null
}) {
  const Icon = resolveIcon(icon)
  const rows: Array<[string, string]> = [
    ["Kind", isAi ? "Plugin (AI)" : template.kind === "theme" ? "Theme" : "Plugin"],
    ["Version", version || "0.1.0"],
    ["Author", author || "—"],
    [
      "Dashboard UI",
      isAi ? "AI decides" : template.kind === "theme" ? "none (storefront theme)" : withUi ? (uiFlavor === "react" ? "React TSX" : "Plain JS") : "none",
    ],
    ["Category", category],
    [
      "Permissions",
      isAi ? "AI minimal" : template.kind === "theme" ? "n/a (theme)" : permissionCount > 0 ? `${permissionCount} selected` : "none",
    ],
  ]
  return (
    <div className="self-start rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2.5">
        {isAi ? (
          <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
        ) : (
          <TemplateThumb template={template} className="h-12 w-16 shrink-0" />
        )}
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
      {description ? <p className="mt-3 border-t border-border pt-2.5 text-[11px] leading-snug text-muted-foreground">{description}</p> : null}
    </div>
  )
}
