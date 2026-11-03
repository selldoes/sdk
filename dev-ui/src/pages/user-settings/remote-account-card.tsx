import { CloudDownload, ExternalLink, KeyRound, Loader2, LogOut, Package, RefreshCw, Rocket, Store, Trash2 } from "lucide-react"
import type { Dispatch, SetStateAction } from "react"
import { Callout } from "@/components/shared"
import { SkeletonList } from "@/components/skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { timeAgo } from "@/lib/utils"
import type { WsBootstrap, WsPackage, WsPackageDetail, WsProject } from "@/lib/ws-api"
import type { BusySet } from "./shared"

interface RemoteAccountCardProps {
  connected: boolean
  account: WsBootstrap["account"] | null
  busy: BusySet
  token: string
  onTokenChange: (token: string) => void
  appUrl: string
  onAppUrlChange: (appUrl: string) => void
  showToken: boolean
  onShowTokenChange: Dispatch<SetStateAction<boolean>>
  onConnect: () => void
  onDisconnect: () => void
  packages: WsPackage[] | null
  packagesError: string | null
  onRetry: () => void
  packageDetail: { slug: string; detail: WsPackageDetail } | null
  onToggleDetail: (slug: string) => void
  projectFor: (pkg: WsPackage) => WsProject | null
  hasUpdate: (pkg: WsPackage) => boolean
  onUpdate: (pkg: WsPackage) => void
  onPull: (pkg: WsPackage) => void
  onDeleteCopy: (pkg: WsPackage) => void
}

export function RemoteAccountCard({
  connected,
  account,
  busy,
  token,
  onTokenChange,
  appUrl,
  onAppUrlChange,
  showToken,
  onShowTokenChange,
  onConnect,
  onDisconnect,
  packages,
  packagesError,
  onRetry,
  packageDetail,
  onToggleDetail,
  projectFor,
  hasUpdate,
  onUpdate,
  onPull,
  onDeleteCopy,
}: RemoteAccountCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="h-4 w-4" />
          Remote — developer account
        </CardTitle>
        <CardDescription>
          Packages your developer account owns on the platform — pull them back to keep developing, or delete a workspace copy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Store className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">
              {connected ? (account?.name ?? "Your developer account") : "Not connected"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {connected
                ? `${account?.email ?? ""}${account?.appUrl ? ` · ${account.appUrl}` : ""}`
                : "Paste a developer token to manage your packages"}
            </p>
          </div>
          {connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-[11px]"
              disabled={busy.anyBusy}
              onClick={onDisconnect}
            >
              {busy.isBusy("disconnect") ? <Loader2 className="animate-spin" /> : <LogOut />}
              Disconnect
            </Button>
          ) : null}
        </div>

        {!connected ? (
          <div className="space-y-2 rounded-lg border border-border px-3 py-3">
            <p className="text-xs font-semibold">Connect your developer account</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(event) => onTokenChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && token.trim()) onConnect()
                  }}
                  placeholder="sk_dev_…"
                  className="h-9 pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => onShowTokenChange((value) => !value)}
                  aria-label={showToken ? "Hide token" : "Show token"}
                >
                  {showToken ? <span className="text-[10px]">hide</span> : <span className="text-[10px]">show</span>}
                </button>
              </div>
              <Input
                value={appUrl}
                onChange={(event) => onAppUrlChange(event.target.value)}
                placeholder="https://selldoes.com"
                className="h-9 sm:w-56"
              />
              <Button size="sm" className="h-9 shrink-0" disabled={busy.anyBusy || !token.trim()} onClick={onConnect}>
                {busy.isBusy("connect") ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Connect
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Developer tokens start with <code className="font-mono">sk_dev_</code> — create one in the developer portal → API
              tokens. Saved to
              <code className="font-mono"> ~/.selldoes.json</code>, same as `selldoes login`. Leave the URL empty for
              selldoes.com.
            </p>
          </div>
        ) : null}

        {connected && busy.isBusy("load") && packages === null ? (
          <SkeletonList rows={3} />
        ) : connected && packagesError ? (
          <Callout kind="danger">
            <p className="font-semibold">Could not load packages</p>
            <p className="mt-0.5 text-[12px]">{packagesError}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
              <RefreshCw />
              Retry
            </Button>
          </Callout>
        ) : connected && packages && packages.length > 0 ? (
          <div className="space-y-1.5">
            {packages.map((pkg) => (
              <div key={pkg.slug} className="rounded-lg border border-border px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Package className="h-3.5 w-3.5" />
                  </span>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onToggleDetail(pkg.slug)}>
                    <p className="truncate text-xs font-semibold hover:underline">{pkg.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {pkg.slug} · account v{pkg.latestVersion}
                      {projectFor(pkg)?.version ? ` · local v${projectFor(pkg)!.version}` : ""} · {pkg.status}
                      {pkg.updatedAt ? ` · updated ${timeAgo(pkg.updatedAt)}` : ""}
                    </p>
                  </button>
                  {projectFor(pkg) ? (
                    <>
                      {hasUpdate(pkg) ? (
                        <Badge className="h-7 shrink-0 border-0 bg-amber-100 px-2 text-[10px] text-amber-800">
                          Update available
                        </Badge>
                      ) : null}
                      <Button
                        size="sm"
                        variant={hasUpdate(pkg) ? "default" : "outline"}
                        className="h-7 shrink-0 px-2 text-xs"
                        disabled={busy.isBusy(`update:${pkg.slug}`)}
                        onClick={() => onUpdate(pkg)}
                      >
                        {busy.isBusy(`update:${pkg.slug}`) ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        {hasUpdate(pkg) ? "Update" : "Re-pull"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={busy.isBusy(`pull:${pkg.slug}`)}
                      onClick={() => onPull(pkg)}
                    >
                      {busy.isBusy(`pull:${pkg.slug}`) ? <Loader2 className="animate-spin" /> : <CloudDownload />}
                      Pull
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-xs text-destructive"
                    onClick={() => onDeleteCopy(pkg)}
                  >
                    <Trash2 />
                    Delete copy
                  </Button>
                </div>
                {packageDetail?.slug === pkg.slug ? (
                  <div className="mt-2 space-y-1 rounded-md bg-muted/40 px-2.5 py-2 text-[11px]">
                    {packageDetail.detail.releases?.length ? (
                      <p className="text-muted-foreground">
                        Releases:{" "}
                        {packageDetail.detail.releases
                          .slice(0, 6)
                          .map((release) => `v${release.version ?? "?"}`)
                          .join(", ")}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">No releases recorded.</p>
                    )}
                    <p className="text-muted-foreground">
                      Marketplace listing:{" "}
                      {packageDetail.detail.listing?.status ? (
                        <Badge variant="outline" className="ml-1 text-[9px]">
                          {packageDetail.detail.listing.status}
                        </Badge>
                      ) : (
                        "none"
                      )}
                    </p>
                    <a
                      href={`${(account?.appUrl ?? "https://selldoes.com").replace(/\/$/, "")}/developers/dashboard/plugins`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Open in the developer portal
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : connected ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            No packages on your account yet — publish one with <code className="font-mono">selldoes publish</code>.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
