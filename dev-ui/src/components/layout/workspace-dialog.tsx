import * as React from "react"
import { FolderOpen, Plus, Package, Puzzle, RefreshCw, Rocket, Sparkles, SquareArrowOutUpRight, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useApp } from "@/state/app"
import { ws } from "@/lib/ws-api"
import type { WsPackage, WsProject } from "@/lib/ws-api"

function timeAgo(iso?: string): string {
  if (!iso) return "never"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "never"
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(then).toISOString().slice(0, 10)
}

/**
 * The workspace switcher / onboarding dialog — the store-switcher of the dev
 * shell. Doubles as first-run onboarding (auto-opens when the workspace is
 * empty or nothing is selected). Everything happens in-place: selecting a
 * project spawns its preview and the shell proxies to it.
 */
export function WorkspaceDialog() {
  const { workspace, refreshWorkspace, refresh, toast, workspaceDialogOpen, setWorkspaceDialogOpen, noProject, bootstrap } = useApp()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [importPath, setImportPath] = React.useState("")
  const [createName, setCreateName] = React.useState("")
  const [createParent, setCreateParent] = React.useState("")
  const [createMode, setCreateMode] = React.useState<"template" | "ai">("template")
  const [aiPrompt, setAiPrompt] = React.useState("")
  const [packages, setPackages] = React.useState<WsPackage[] | null>(null)

  const onboarding = noProject || (workspace?.projects.length ?? 0) === 0
  const currentId = workspace?.current?.project.id
  const projects = workspace?.projects ?? []

  React.useEffect(() => {
    if (workspace?.defaultDir && !createParent) setCreateParent(workspace.defaultDir)
  }, [workspace?.defaultDir, createParent])

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

  const select = (project: WsProject) =>
    run(`select:${project.id}`, async () => {
      await ws.select(project.id)
      await Promise.all([refreshWorkspace(), refresh()])
      setWorkspaceDialogOpen(false)
      toast(`Switched to ${project.name}`, "success")
    })

  const restart = () =>
    run("restart", async () => {
      await ws.restart()
      await Promise.all([refreshWorkspace(), refresh()])
      toast("Preview restarted", "success")
    })

  const remove = (project: WsProject) =>
    run(`remove:${project.id}`, async () => {
      await ws.remove(project.id)
      await refreshWorkspace()
      if (project.id === currentId) await refresh()
      toast(`Removed ${project.name} from the workspace (folder kept on disk)`)
    })

  const doImport = () =>
    run("import", async () => {
      const { project } = await ws.importFolder(importPath.trim())
      setImportPath("")
      await ws.select(project.id)
      await Promise.all([refreshWorkspace(), refresh()])
      setWorkspaceDialogOpen(false)
      toast(`Imported ${project.name}`, "success")
    })

  const doCreate = () =>
    run("create", async () => {
      const { project, needsInstall } = await ws.create({
        name: createName.trim(),
        parentDir: createParent.trim() || undefined,
        kind: "plugin",
        withUi: createMode === "template" ? true : false,
        uiFlavor: "js",
      })
      setCreateName("")
      if (createMode === "template") await ws.select(project.id)
      await Promise.all([refreshWorkspace(), refresh()])
      setWorkspaceDialogOpen(false)
      toast(`Created ${project.name} → ${project.path}`, "success")
      if (needsInstall) toast("React UI projects need `npm install` in the new folder")
    })

  const doCreateAi = () =>
    run("create-ai", async () => {
      const { project, files } = await ws.createAi({
        name: createName.trim(),
        prompt: aiPrompt.trim(),
        parentDir: createParent.trim() || undefined,
      })
      setCreateName("")
      setAiPrompt("")
      await ws.select(project.id)
      await Promise.all([refreshWorkspace(), refresh()])
      setWorkspaceDialogOpen(false)
      toast(`Generated ${project.name} — ${files.length} file(s)`, "success")
    })

  const loadPackages = () =>
    run("packages", async () => {
      const result = await ws.packages()
      setPackages(result.plugins)
    })

  const doPull = (pkg: WsPackage) =>
    run(`pull:${pkg.slug}`, async () => {
      const { project } = await ws.pull(pkg.slug)
      await ws.select(project.id)
      await Promise.all([refreshWorkspace(), refresh()])
      setWorkspaceDialogOpen(false)
      toast(`Pulled ${project.name} → ${project.path}`, "success")
    })

  return (
    <Dialog open={workspaceDialogOpen} onOpenChange={setWorkspaceDialogOpen}>
      <DialogContent className="max-h-[86vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Puzzle className="h-4 w-4" />
            {onboarding ? "Set up your workspace" : "Switch workspace"}
          </DialogTitle>
          <DialogDescription>
            {onboarding
              ? "A workspace is where the SDK keeps the projects you develop — create, import or pull one to get started."
              : "The shell stays put — selecting a project swaps everything the preview shows."}
            {bootstrap?.store ? ` Mock store: ${bootstrap.store.name} /${bootstrap.store.slug} · #${bootstrap.store.id}` : null}
          </DialogDescription>
        </DialogHeader>

        {/* Projects */}
        {!onboarding && (
          <section>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Your projects</p>
            <div className="space-y-1.5">
              {projects.map((project) => {
                const isCurrent = project.id === currentId
                return (
                  <div
                    key={project.id}
                    className={
                      "flex items-center gap-2 rounded-lg border px-2.5 py-2 " +
                      (isCurrent ? "border-primary/40 bg-primary/5" : "border-border")
                    }
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left disabled:opacity-60"
                      disabled={busy !== null || project.missing}
                      onClick={() => void select(project)}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold">{project.name}</span>
                        <Badge variant="secondary" className="shrink-0 text-[9px]">
                          {project.kind}
                        </Badge>
                        {isCurrent ? <Badge className="shrink-0 text-[9px]">current</Badge> : null}
                        {project.missing ? (
                          <Badge variant="destructive" className="shrink-0 text-[9px]">
                            missing
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground" title={project.path}>
                        {project.slug} · {project.path} · {timeAgo(project.lastOpenedAt)}
                      </span>
                    </button>
                    {isCurrent && workspace?.current?.url ? (
                      <a
                        href={workspace.current.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open the preview directly in a new tab"
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {isCurrent ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        title="Restart the preview (kill + respawn)"
                        disabled={busy === "restart"}
                        onClick={() => void restart()}
                      >
                        <RefreshCw className={"h-3.5 w-3.5 " + (busy === "restart" ? "animate-spin" : "")} />
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      title="Remove from the workspace (files stay on disk)"
                      disabled={busy === `remove:${project.id}`}
                      onClick={() => void remove(project)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Create */}
        <section>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Rocket className="h-3 w-3" /> Create new
          </p>
          <div className="space-y-2 rounded-lg border border-border p-2.5">
            <div className="flex gap-1">
              {(
                [
                  { value: "template", label: "Template" },
                  { value: "ai", label: "Describe AI" },
                ] as const
              ).map((mode) => (
                <Button
                  key={mode.value}
                  size="sm"
                  variant={createMode === mode.value ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setCreateMode(mode.value)}
                >
                  {mode.value === "ai" ? <Sparkles className="mr-1 h-3 w-3" /> : null}
                  {mode.label}
                </Button>
              ))}
            </div>
            <Input
              placeholder="my-plugin"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void (createMode === "ai" ? doCreateAi() : doCreate())}
            />
            <Input placeholder="Parent folder" value={createParent} onChange={(event) => setCreateParent(event.target.value)} />
            {createMode === "ai" ? (
              <textarea
                className="min-h-[70px] w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                placeholder={'Describe the plugin — e.g. "a plugin that shows a live visitor counter on product pages"'}
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
              />
            ) : null}
            <Button
              size="sm"
              className="w-full"
              disabled={
                busy === "create" || busy === "create-ai" || !createName.trim() || (createMode === "ai" && !aiPrompt.trim())
              }
              onClick={() => void (createMode === "ai" ? doCreateAi() : doCreate())}
            >
              <Plus className="h-3.5 w-3.5" /> {createMode === "ai" ? "Generate with AI" : "Create"}
            </Button>
          </div>
        </section>

        {/* Import */}
        <section>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <FolderOpen className="h-3 w-3" /> Import
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Folder with plugin.json/manifest.json, or a .zip"
              value={importPath}
              onChange={(event) => setImportPath(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void doImport()}
            />
            <Button size="sm" disabled={busy === "import" || !importPath.trim()} onClick={() => void doImport()}>
              Import
            </Button>
          </div>
        </section>

        {/* Packages */}
        <section>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Package className="h-3 w-3" /> Your packages
          </p>
          {packages === null ? (
            <Button size="sm" variant="outline" disabled={busy === "packages"} onClick={() => void loadPackages()}>
              <RefreshCw className={"h-3.5 w-3.5 " + (busy === "packages" ? "animate-spin" : "")} />
              {workspace?.account.connected ? `Load from ${workspace.account.appUrl}` : "Connect a developer account to pull packages you own"}
            </Button>
          ) : packages.length === 0 ? (
            <p className="text-xs text-muted-foreground">No packages on your account yet — publish one with `selldoes publish`.</p>
          ) : (
            <div className="space-y-1.5">
              {packages.map((pkg) => (
                <div key={pkg.slug} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{pkg.name}</p>
                    <p className="text-[10.5px] text-muted-foreground">
                      {pkg.slug} · v{pkg.latestVersion} · {pkg.status}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={busy === `pull:${pkg.slug}`}
                    onClick={() => void doPull(pkg)}
                  >
                    Pull
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}
