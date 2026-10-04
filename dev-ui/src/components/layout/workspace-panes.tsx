import * as React from "react"
import { AlertCircle, Eye, EyeOff, FolderOpen, KeyRound, Loader2, Package, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ws } from "@/lib/ws-api"
import type { WsBootstrap, WsPackage, WsProject } from "@/lib/ws-api"

/**
 * Import pane of the New-workspace dialog: point the workspace at a folder
 * (or .zip) that already contains a plugin.json / manifest.json.
 */
export function ImportPane({
  busy,
  onImport,
}: {
  busy: boolean
  onImport: (folderPath: string) => void
}) {
  const [path, setPath] = React.useState("")

  return (
    <div className="mx-auto max-w-lg space-y-3">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FolderOpen className="h-4 w-4" />
        </span>
        <p className="text-xs font-semibold">Import an existing project</p>
        <p className="text-[10.5px] text-muted-foreground">A folder with plugin.json / manifest.json — or a .zip of one</p>
      </div>
      <div className="flex gap-2">
        <Input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && path.trim() && !busy) onImport(path)
          }}
          placeholder="C:/dev/my-plugin"
          className="h-9"
          autoFocus
        />
        <Button size="sm" disabled={busy || !path.trim()} onClick={() => onImport(path)}>
          {busy ? <Loader2 className="animate-spin" /> : <FolderOpen />}
          Import
        </Button>
      </div>
      <p className="text-[10.5px] text-muted-foreground">
        The folder stays where it is and keeps its own git history — the workspace only references it. The project is selected right
        after importing.
      </p>
    </div>
  )
}

/**
 * Pull pane: packages published from the connected developer account.
 * Not connected? Paste a developer token (sk_dev_…) — same credential store
 * as `selldoes login`, saved to ~/.selldoes.json after verification.
 */
export function PullPane({
  busyKeys,
  onPull,
  account,
  projects,
  onAccountChange,
}: {
  busyKeys: ReadonlySet<string>
  onPull: (pkg: WsPackage, options?: { update?: boolean }) => void
  account?: WsBootstrap["account"]
  /** Registry projects, used to offer "Update" for packages already in the workspace. */
  projects?: WsProject[]
  /** Re-fetch workspace bootstrap after connect/disconnect (refreshes the account card). */
  onAccountChange?: () => Promise<void>
}) {
  const connected = Boolean(account?.connected)
  const [packages, setPackages] = React.useState<WsPackage[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [token, setToken] = React.useState("")
  const [showToken, setShowToken] = React.useState(false)
  const [connecting, setConnecting] = React.useState(false)
  const [connectError, setConnectError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await ws.packages()
      setPackages(result.plugins)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (connected) void load()
  }, [connected, load])

  const doConnect = async () => {
    const value = token.trim()
    if (!value || connecting) return
    setConnecting(true)
    setConnectError(null)
    try {
      await ws.connect(value)
      setToken("")
      await onAccountChange?.()
      await load()
    } catch (cause) {
      setConnectError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setConnecting(false)
    }
  }

  const doDisconnect = async () => {
    if (connecting) return
    setConnecting(true)
    setConnectError(null)
    try {
      await ws.disconnect()
      setPackages(null)
      await onAccountChange?.()
    } catch (cause) {
      setConnectError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-3">
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-2.5 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Package className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{connected ? (account?.name ?? "Your developer account") : "Your developer account"}</p>
          <p className="truncate text-[10.5px] text-muted-foreground">
            {connected ? (account?.email ?? account?.appUrl ?? "Connected") : "Paste a developer token to pull packages you own"}
          </p>
        </div>
        {connected ? (
          <>
            <Badge variant="outline" className="shrink-0 text-[9px]">
              connected
            </Badge>
            <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-[10.5px] text-muted-foreground" disabled={connecting} onClick={() => void doDisconnect()}>
              Disconnect
            </Button>
          </>
        ) : null}
      </div>

      {!connected ? (
        <div className="space-y-2 rounded-lg border border-border px-3 py-3">
          <p className="text-xs font-semibold">Connect your developer account</p>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value)
                  setConnectError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void doConnect()
                }}
                placeholder="sk_dev_…"
                className="h-9 pr-9 font-mono text-xs"
                autoFocus
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowToken((value) => !value)}
                aria-label={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Button size="sm" className="h-9 shrink-0" disabled={connecting || !token.trim()} onClick={() => void doConnect()}>
              {connecting ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Connect
            </Button>
          </div>
          {connectError ? <p className="text-[10.5px] text-destructive">{connectError}</p> : null}
          <p className="text-[10.5px] text-muted-foreground">
            Developer tokens start with <code className="text-[11px]">sk_dev_</code> — create one in the developer portal → API tokens. It is verified and saved to
            <code className="text-[11px]"> ~/.selldoes.json</code>, the same place as <code className="text-[11px]">selldoes login</code>.
          </p>
        </div>
      ) : null}

      {connected && loading && packages === null ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your packages…
        </div>
      ) : connected && error ? (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            Could not load packages
          </p>
          <p className="text-[10.5px] text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw />
            Retry
          </Button>
        </div>
      ) : connected && packages && packages.length > 0 ? (
        <div className="space-y-1.5">
          {packages.map((pkg) => {
            const local =
              projects?.find((project) => project.kind === "plugin" && project.slug === pkg.slug && !project.missing) ?? null
            const update = Boolean(local?.version && pkg.latestVersion && local.version !== pkg.latestVersion)
            return (
              <div key={pkg.slug} className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Package className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{pkg.name}</p>
                  <p className="truncate text-[10.5px] text-muted-foreground">
                    {pkg.slug} · account v{pkg.latestVersion}
                    {local?.version ? ` · local v${local.version}` : ""} · {pkg.status}
                  </p>
                </div>
                {update ? (
                  <Badge className="shrink-0 border-0 bg-amber-100 text-[9px] text-amber-800">update</Badge>
                ) : null}
                {local ? (
                  <Button
                    size="sm"
                    variant={update ? "default" : "outline"}
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={busyKeys.has(`update:${pkg.slug}`)}
                    onClick={() => onPull(pkg, { update: true })}
                  >
                    {busyKeys.has(`update:${pkg.slug}`) ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {update ? "Update" : "Re-pull"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={busyKeys.has(`pull:${pkg.slug}`)}
                    onClick={() => onPull(pkg)}
                  >
                    {busyKeys.has(`pull:${pkg.slug}`) ? <Loader2 className="animate-spin" /> : null}
                    Pull
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      ) : connected ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No packages on your account yet — publish one with <code className="text-[11px]">selldoes publish</code>.
        </p>
      ) : null}

      <p className="text-[10.5px] text-muted-foreground">
        Pulled projects are downloaded into a folder you choose and added to the workspace.
      </p>
    </div>
  )
}
