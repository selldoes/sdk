import * as React from "react"
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  MonitorPlay,
  Package,
  Play,
  Plus,
  Rocket,
  RefreshCw,
  Square,
  Sparkles,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ws } from "@/lib/ws-api"
import type { WsBootstrap, WsPackage, WsPreview, WsProject } from "@/lib/ws-api"

interface Toast {
  id: number
  message: string
  tone: "default" | "error" | "success"
}

function initialTheme(): "light" | "dark" {
  const stored = localStorage.getItem("selldoes-dev-theme")
  if (stored === "light" || stored === "dark") return stored
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

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
 * The web workspace — what `selldoes` (bare) opens. Self-contained: it talks
 * to `/__ws/*` only. Plugin previews open as separate tabs against the child
 * preview servers the workspace spawns.
 */
export function WorkspaceHome() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => initialTheme())
  const [data, setData] = React.useState<WsBootstrap | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)

  const [importPath, setImportPath] = React.useState("")
  const [createName, setCreateName] = React.useState("")
  const [createParent, setCreateParent] = React.useState("")
  const [createKind, setCreateKind] = React.useState<"plugin" | "theme">("plugin")
  const [createUi, setCreateUi] = React.useState<"js" | "react" | "none">("js")
  const [createMode, setCreateMode] = React.useState<"template" | "ai">("template")
  const [aiPrompt, setAiPrompt] = React.useState("")
  const [packages, setPackages] = React.useState<WsPackage[] | null>(null)
  const [packagesError, setPackagesError] = React.useState<string | null>(null)

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("selldoes-dev-theme", theme)
  }, [theme])

  const toast = React.useCallback((message: string, tone: Toast["tone"] = "default") => {
    const id = Date.now() + Math.random()
    setToasts((previous) => [...previous, { id, message, tone }])
    setTimeout(() => setToasts((previous) => previous.filter((entry) => entry.id !== id)), 4000)
  }, [])

  const refresh = React.useCallback(async () => {
    try {
      const bootstrap = await ws.bootstrap()
      setData(bootstrap)
      setLoadError(null)
      if (!createParent) setCreateParent(bootstrap.defaultDir)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [createParent])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  // Keep the running-previews strip fresh.
  React.useEffect(() => {
    const timer = setInterval(() => {
      ws.previews()
        .then(({ previews }) => {
          setData((previous) => (previous ? { ...previous, previews } : previous))
        })
        .catch(() => {})
    }, 4000)
    return () => clearInterval(timer)
  }, [])

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

  const openPreview = (project: WsProject) =>
    run(`open:${project.id}`, async () => {
      const { preview } = await ws.open(project.id)
      window.open(preview.url, "_blank", "noopener")
      await refresh()
      toast(`Preview started for ${project.name}`, "success")
    })

  const closePreview = (preview: WsPreview) =>
    run(`close:${preview.id}`, async () => {
      await ws.close(preview.id)
      await refresh()
    })

  const removeProject = (project: WsProject) =>
    run(`remove:${project.id}`, async () => {
      await ws.remove(project.id)
      await refresh()
      toast(`Removed ${project.name} from the workspace (folder kept on disk)`)
    })

  const doImport = () =>
    run("import", async () => {
      const { project } = await ws.importFolder(importPath.trim())
      setImportPath("")
      await refresh()
      toast(`Imported ${project.name}`, "success")
    })

  const doCreate = () =>
    run("create", async () => {
      const { project, needsInstall } = await ws.create({
        name: createName.trim(),
        parentDir: createParent.trim() || undefined,
        kind: createKind,
        withUi: createKind === "plugin" ? createUi !== "none" : false,
        uiFlavor: createUi === "react" ? "react" : "js",
      })
      setCreateName("")
      await refresh()
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
      await refresh()
      toast(`Generated ${project.name} — ${files.length} file(s) → ${project.path}`, "success")
    })

  const loadPackages = () =>
    run("packages", async () => {
      const result = await ws.packages()
      setPackages(result.plugins)
      setPackagesError(null)
    })

  const doPull = (pkg: WsPackage) =>
    run(`pull:${pkg.slug}`, async () => {
      const { project } = await ws.pull(pkg.slug)
      await refresh()
      toast(`Pulled ${project.name} → ${project.path}`, "success")
    })

  if (loadError) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
        <p className="text-sm font-semibold">Could not reach the workspace server</p>
        <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
        <Button className="mt-4" size="sm" variant="outline" onClick={() => void refresh()}>
          <RefreshCw />
          Retry
        </Button>
      </div>
    )
  }

  const previews = data?.previews.filter((preview) => preview.alive) ?? []
  const projects = data?.projects ?? []

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[120] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((entry) => (
          <div
            key={entry.id}
            className={
              "pointer-events-auto rounded-lg px-4 py-2 text-sm font-semibold shadow-lg animate-in fade-in slide-in-from-bottom-2 " +
              (entry.tone === "error"
                ? "bg-destructive text-destructive-foreground"
                : entry.tone === "success"
                  ? "bg-emerald-600 text-white"
                  : "bg-foreground text-background")
            }
          >
            {entry.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4">
          <MonitorPlay className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-base font-bold leading-tight">Selldoes workspace</h1>
            <p className="text-xs text-muted-foreground">Develop plugins & themes — the SDK is your workspace</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant={data?.sdk.dev ? "default" : "secondary"}>
              {data?.sdk.dev ? "SDK dev · Vite HMR" : `SDK v${data?.sdk.version ?? "?"}`}
            </Badge>
            {data?.account.connected ? (
              <Badge variant="outline" title={data.account.appUrl}>
                {data.account.email ?? data.account.name ?? "Developer account"}
                {data.account.unreachable ? " (unreachable)" : ""}
              </Badge>
            ) : (
              <Badge variant="outline">Not connected</Badge>
            )}
            <Button size="sm" variant="ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "Light" : "Dark"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {/* Running previews */}
        {previews.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Running previews</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {previews.map((preview) => (
                <div key={preview.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
                  <a href={preview.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    {preview.name}
                  </a>
                  <span className="text-xs text-muted-foreground">:{preview.port}</span>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => void closePreview(preview)} disabled={busy === `close:${preview.id}`}>
                    <Square className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Projects */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Your projects</h2>
              <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                <RefreshCw className={busy === null ? "h-4 w-4" : "h-4 w-4 animate-spin"} />
                Refresh
              </Button>
            </div>
            {projects.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                No projects yet — import a folder, create a new one, or pull a package from your developer account.
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {projects.map((project) => (
                  <Card key={project.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">{project.name}</span>
                            <Badge variant="secondary" className="shrink-0 text-[10px]">
                              {project.kind}
                            </Badge>
                            {project.missing && <Badge variant="destructive" className="shrink-0 text-[10px]">missing</Badge>}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={project.path}>
                            {project.path}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {project.slug} · opened {timeAgo(project.lastOpenedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => void openPreview(project)}
                          disabled={busy === `open:${project.id}` || project.missing || project.kind !== "plugin"}
                          title={project.kind === "theme" ? "Theme dev needs --store — run from the terminal" : undefined}
                        >
                          <Play className="h-3.5 w-3.5" />
                          Preview
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void removeProject(project)} disabled={busy === `remove:${project.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Sidebar */}
          <aside className="space-y-4">
            {/* Import */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FolderOpen className="h-4 w-4" /> Import folder
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input
                  placeholder="C:/projects/my-plugin"
                  value={importPath}
                  onChange={(event) => setImportPath(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void doImport()}
                />
                <Button size="sm" className="w-full" onClick={() => void doImport()} disabled={busy === "import" || !importPath.trim()}>
                  <Plus className="h-4 w-4" /> Import
                </Button>
              </CardContent>
            </Card>

            {/* Create */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Rocket className="h-4 w-4" /> Create new
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
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
                <Input
                  placeholder="Parent folder"
                  value={createParent}
                  onChange={(event) => setCreateParent(event.target.value)}
                />
                {createMode === "ai" ? (
                  <textarea
                    className="min-h-[80px] w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                    placeholder={'Describe the plugin — e.g. "a plugin that shows a live visitor counter on product pages"'}
                    value={aiPrompt}
                    onChange={(event) => setAiPrompt(event.target.value)}
                  />
                ) : (
                  <>
                    <div className="flex gap-1">
                      {(["plugin", "theme"] as const).map((kind) => (
                        <Button
                          key={kind}
                          size="sm"
                          variant={createKind === kind ? "default" : "outline"}
                          className="flex-1"
                          onClick={() => setCreateKind(kind)}
                        >
                          {kind}
                        </Button>
                      ))}
                    </div>
                    {createKind === "plugin" && (
                      <div className="flex gap-1">
                        {(["js", "react", "none"] as const).map((flavor) => (
                          <Button
                            key={flavor}
                            size="sm"
                            variant={createUi === flavor ? "default" : "outline"}
                            className="flex-1"
                            onClick={() => setCreateUi(flavor)}
                          >
                            {flavor === "none" ? "no UI" : flavor}
                          </Button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => void (createMode === "ai" ? doCreateAi() : doCreate())}
                  disabled={busy === "create" || busy === "create-ai" || !createName.trim() || (createMode === "ai" && !aiPrompt.trim())}
                >
                  <Plus className="h-4 w-4" /> {createMode === "ai" ? "Generate with AI" : "Create"}
                </Button>
              </CardContent>
            </Card>

            {/* Packages */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4" /> Your packages
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {packages === null ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {data?.account.connected
                        ? `List the packages your developer account owns on ${data?.account.appUrl}.`
                        : "Connect a developer account to pull packages you own (selldoes login --token sk_dev_…)."}
                    </p>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => void loadPackages()} disabled={busy === "packages"}>
                      <RefreshCw className="h-4 w-4" /> Load packages
                    </Button>
                  </>
                ) : packagesError ? (
                  <p className="text-xs text-destructive">{packagesError}</p>
                ) : packages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No packages yet — publish one with `selldoes publish`.</p>
                ) : (
                  <div className="space-y-1.5">
                    {packages.map((pkg) => (
                      <div key={pkg.slug} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">{pkg.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {pkg.slug} · v{pkg.latestVersion} · {pkg.status}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={() => void doPull(pkg)} disabled={busy === `pull:${pkg.slug}`}>
                          Pull
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Assistant */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4" /> AI assistant
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data?.assistant.configured ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    {data.assistant.provider} · {data.assistant.model} — available inside every preview
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Not configured — add OPENROUTER_API_KEY / OPENAI_API_KEY / DEEPINFRA_API_KEY to enable the assistant in previews.
                  </p>
                )}
              </CardContent>
            </Card>

            <p className="px-1 text-[11px] text-muted-foreground">
              Terminal: <code>selldoes home</code> · <code>selldoes login</code> · <code>selldoes publish</code> — run{" "}
              <code>npm run dev</code> in the SDK repo for this UI on Vite hot reload.
              <ExternalLink className="ml-1 inline h-3 w-3" />
            </p>
          </aside>
        </div>
      </main>
    </div>
  )
}
