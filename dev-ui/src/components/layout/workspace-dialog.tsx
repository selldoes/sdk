import { ArrowLeft, ArrowRight, Check, CloudDownload, FolderOpen, Loader2, Plus, Rocket } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { confirmDiscardChanges } from "@/lib/dirty-guard"
import { type PreparedIcon, prepareIconFile } from "@/lib/icon-upload"
import type { AccentName } from "@/lib/project-colors"
import { useBusySet } from "@/lib/use-busy"
import { cn } from "@/lib/utils"
import type { WsExample, WsPackage } from "@/lib/ws-api"
import { ws } from "@/lib/ws-api"
import { useApp } from "@/state/app"
import { StepDetails } from "./workspace-dialog/details-step"
import { StepExamples } from "./workspace-dialog/examples-step"
import { StepOptions } from "./workspace-dialog/options-step"
import { type ExampleKind, type STARTERS, styleFor } from "./workspace-dialog/shared"
import { StepStart } from "./workspace-dialog/start-step"
import { ImportPane, PullPane } from "./workspace-panes"

const RECOMMENDED_PERMISSIONS = ["db:read", "db:write", "db:schema"]

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
      let response: Awaited<ReturnType<typeof runPull>>
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
    if (currentStep === "start")
      return isAi
        ? "Describe what the plugin should do — the AI scaffolds the project"
        : "Choose what you're building, then pick an example next"
    if (currentStep === "examples") return `Starting points for your ${kind} — each one is a complete, working project`
    if (currentStep === "details")
      return example ? `Built from the ${example.name} example` : "Name your project and adjust the details"
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
            <DialogTitle className="text-sm font-bold leading-tight">
              {onboarding ? "Set up your workspace" : "New workspace"}
            </DialogTitle>
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
