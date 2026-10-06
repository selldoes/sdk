import * as React from "react"
import { Link } from "react-router-dom"
import {
  AlertCircle,
  Check,
  ChevronDown,
  CloudUpload,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Rocket,
  Terminal,
} from "lucide-react"
import { Callout, CopyButton, PageHead } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { dev } from "@/lib/api"
import { bumpVersion } from "@/lib/bump-version"
import type { BumpMode, DevAccount, PublishResult } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useVisit } from "@/lib/use-visit"
import { ws } from "@/lib/ws-api"
import { useApp } from "@/state/app"

const BUMP_MODES: { value: BumpMode; label: string; hint: string }[] = [
  { value: "patch", label: "Patch", hint: "0.4.1 → 0.4.2" },
  { value: "minor", label: "Minor", hint: "0.4.1 → 0.5.0" },
  { value: "major", label: "Major", hint: "0.4.1 → 1.0.0" },
]

/** Inline developer-account connect form — shared by the Ship page states. */
function ConnectForm({
  workspaceMode,
  defaultAppUrl,
  onConnected,
}: {
  workspaceMode: boolean
  defaultAppUrl?: string
  onConnected: () => void
}) {
  const { toast } = useApp()
  const [token, setToken] = React.useState("")
  const [appUrl, setAppUrl] = React.useState(defaultAppUrl ?? "")
  const [showToken, setShowToken] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (defaultAppUrl) setAppUrl((previous) => previous || defaultAppUrl)
  }, [defaultAppUrl])

  const connect = async () => {
    const value = token.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      if (workspaceMode) {
        await ws.connect(value, appUrl.trim() || undefined)
      } else {
        await dev.connectAccount(value, appUrl.trim() || undefined)
      }
      setToken("")
      toast("Developer account connected", "success")
      onConnected()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <KeyRound className="h-3.5 w-3.5" />
        Connect your developer account to publish
      </p>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(event) => {
              setToken(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void connect()
            }}
            placeholder="sk_dev_…"
            className="h-9 pr-9 font-mono text-xs"
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
        <Button size="sm" className="h-9 shrink-0" disabled={busy || !token.trim()} onClick={() => void connect()}>
          {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Connect
        </Button>
      </div>
      <Input
        value={appUrl}
        onChange={(event) => setAppUrl(event.target.value)}
        placeholder="https://selldoes.com"
        className="h-8 text-xs"
      />
      {error ? <p className="text-[10.5px] text-destructive">{error}</p> : null}
      <p className="text-[10.5px] leading-snug text-muted-foreground">
        Developer tokens start with <code className="text-[11px]">sk_dev_</code> — create one in the developer portal → API tokens. Saved
        to <code className="text-[11px]">~/.selldoes.json</code>, the same place as <code className="text-[11px]">selldoes login</code>.
      </p>
    </div>
  )
}

export function ShipPage() {
  const { bootstrap, workspace, refresh, refreshWorkspace, toast, setAssistantPage, setAssistantOpen } = useApp()
  useVisit("ship")
  const manifest = bootstrap!.manifest
  const validation = bootstrap!.validation
  const status = bootstrap!.status

  // Account state: the workspace shell caches it in bootstrap; standalone dev
  // reads /__dev/account (same ~/.selldoes.json).
  const workspaceMode = workspace !== null
  const [account, setAccount] = React.useState<DevAccount | null>(workspace?.account ?? null)
  const [accountRecheck, setAccountRecheck] = React.useState(0)

  React.useEffect(() => {
    if (workspace) {
      setAccount(workspace.account)
      return
    }
    let active = true
    void dev
      .account()
      .then((data) => {
        if (active) setAccount(data)
      })
      .catch(() => {
        if (active) setAccount({ connected: false })
      })
    return () => {
      active = false
    }
  }, [workspace, accountRecheck])

  const connected = Boolean(account?.connected)

  // After connecting, refresh the shell bootstrap so workspace.account picks
  // up the new identity (standalone dev re-reads /__dev/account via the effect).
  const handleConnected = React.useCallback(async () => {
    await refreshWorkspace()
    setAccountRecheck((value) => value + 1)
  }, [refreshWorkspace])

  // Saved release preference (Settings → Releases) powers the checkbox default.
  const [bumpMode, setBumpMode] = React.useState<BumpMode>("patch")
  const [bumpEnabled, setBumpEnabled] = React.useState(true)
  React.useEffect(() => {
    let active = true
    void dev
      .config()
      .then((data) => {
        if (active && data.publish?.bump) setBumpMode(data.publish.bump)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const [notes, setNotes] = React.useState("")
  const [publishing, setPublishing] = React.useState(false)
  const [result, setResult] = React.useState<PublishResult | null>(null)
  const [showCommands, setShowCommands] = React.useState(false)

  const nextVersion = bumpVersion(manifest.version, bumpMode)
  const canPublish = validation.errors.length === 0 && connected && !publishing

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is on the Ship page. Current version v${manifest.version}; validation: ${validation.errors.length} error(s), ${validation.warnings.length} warning(s); developer account ${connected ? "connected" : "not connected"}.`,
      quick: ["Fix my validation errors", "Write release notes for this version", "How do I bump the version?"],
    })
  }, [setAssistantPage, manifest.version, validation.errors.length, validation.warnings.length, connected])

  const publish = async () => {
    if (publishing) return
    setPublishing(true)
    setResult(null)
    try {
      const response = await dev.publish({
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        bump: { enabled: bumpEnabled, mode: bumpMode },
      })
      setResult(response)
      if (response.ok) {
        toast(`Published ${manifest.slug} v${response.version ?? manifest.version} — pending review`, "success")
        await Promise.all([refresh(), refreshWorkspace()])
      } else {
        toast(response.error ?? "Publish failed", "error")
      }
    } catch (cause) {
      const error = cause as Error & { code?: string; body?: PublishResult }
      if (error.code === "not-connected") setAccount({ connected: false })
      const payload = error.body ?? { ok: false, error: error.message }
      setResult(payload)
      toast(payload.error ?? "Publish failed", "error")
    } finally {
      setPublishing(false)
    }
  }

  const commands = [
    ["Typecheck", "npm run typecheck"],
    ["Validate", "npm run validate"],
    ["Bump version", `npm run bump -- ${bumpMode}`],
    ["Build bundle", "npm run build"],
    ["Zip for upload", "npm run pack"],
    ["Publish (dashboard session)", "npm run publish -- --app-url https://selldoes.com"],
    ["Publish (CI token)", "npm run publish -- --app-url https://selldoes.com --token $SELLDOES_PUBLISH_TOKEN"],
  ] as const

  return (
    <div className="space-y-4">
      <PageHead
        title="Validate & publish"
        description="Ship when the preview looks right. One click builds, bumps the version and uploads the release for review."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {/* ── Release ─────────────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Rocket className="h-4 w-4" />
                Release
              </CardTitle>
              <CardDescription>
                Publishing uploads to your developer account and opens a marketplace review. Stores can update once an admin approves.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Current version</p>
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="text-2xl font-extrabold tracking-tight">v{manifest.version}</span>
                    {bumpEnabled && nextVersion && nextVersion !== manifest.version ? (
                      <>
                        <span className="text-sm text-muted-foreground">→</span>
                        <span className="text-2xl font-extrabold tracking-tight text-primary">v{nextVersion}</span>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {manifest.slug} · {manifest.name}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {status.rebuilds} dev rebuild(s)
                </Badge>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-[12.5px] font-medium">
                  <Checkbox checked={bumpEnabled} onCheckedChange={(value) => setBumpEnabled(value === true)} />
                  Bump version before publish
                </label>
                <div className="space-y-1">
                  <Label className="text-[10.5px] text-muted-foreground">Increase</Label>
                  <Select value={bumpMode} onValueChange={(value) => setBumpMode(value as BumpMode)} disabled={!bumpEnabled}>
                    <SelectTrigger className="h-8 w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BUMP_MODES.map((entry) => (
                        <SelectItem key={entry.value} value={entry.value}>
                          {entry.label} <span className="text-muted-foreground">({entry.hint})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[10.5px] leading-snug text-muted-foreground">
                The default comes from Settings → Releases. Publishing the same version again is rejected by the platform — keep this
                checked unless you are intentionally re-submitting an identical build.
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="release-notes" className="text-xs">
                  Release notes <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="release-notes"
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="What changed in this version?"
                  className="min-h-[56px] text-sm"
                />
              </div>

              {!connected ? (
                <ConnectForm workspaceMode={workspaceMode} defaultAppUrl={account?.appUrl} onConnected={handleConnected} />
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    Connected as <strong>{account?.name ?? "developer account"}</strong>
                    {account?.email ? ` <${account.email}>` : ""}
                    {account?.unreachable ? " — platform unreachable" : ""}
                  </span>
                  {account?.appUrl ? <span className="shrink-0 text-[10.5px] text-emerald-700">{account.appUrl}</span> : null}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <Button size="sm" disabled={!canPublish} onClick={() => void publish()}>
                  {publishing ? <Loader2 className="animate-spin" /> : <CloudUpload />}
                  {publishing ? "Publishing…" : bumpEnabled && nextVersion ? `Publish v${nextVersion}` : "Publish"}
                </Button>
                {validation.errors.length > 0 ? (
                  <p className="text-[11px] text-destructive">Fix the validation errors below before publishing.</p>
                ) : !connected ? (
                  <p className="text-[11px] text-muted-foreground">Connect a developer account to publish.</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Builds, zips and uploads in one step.</p>
                )}
              </div>

              {result && !result.ok ? (
                <Callout kind="danger">
                  <p className="font-semibold">{result.code === "not-connected" ? "Developer account needed" : "Publish failed"}</p>
                  <p className="mt-0.5">{result.error}</p>
                  {result.violations && result.violations.length > 0 ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {result.violations.map((violation, index) => (
                        <li key={index}>{violation.message ?? String(violation)}</li>
                      ))}
                    </ul>
                  ) : null}
                  {result.log && result.log.length > 0 ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] font-semibold">Build log</summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10.5px]">{result.log.join("\n")}</pre>
                    </details>
                  ) : null}
                </Callout>
              ) : null}

              {result?.ok ? (
                <Callout kind="success">
                  <p className="font-semibold">
                    Published v{result.version}
                    {result.listing?.status === "pending" ? " — pending admin review." : "."}
                  </p>
                  {result.bumped ? (
                    <p className="mt-0.5 text-[12px]">
                      Version bumped {result.bumped.from} → {result.bumped.to}.
                    </p>
                  ) : null}
                  <p className="mt-1 text-[12px]">
                    {account?.appUrl ? (
                      <a
                        className="inline-flex items-center gap-1 font-semibold underline"
                        href={`${account.appUrl}/developers/dashboard/plugins`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open the developer portal <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </p>
                </Callout>
              ) : null}
            </CardContent>
          </Card>

          {/* ── Validation ──────────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {validation.errors.length > 0 ? <AlertCircle className="h-4 w-4 text-destructive" /> : <Check className="h-4 w-4 text-emerald-600" />}
                Validation
              </CardTitle>
              <CardDescription>The same checks the platform runs when you upload. Errors block; warnings are advisory.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {validation.errors.length > 0 ? (
                <Callout kind="danger">
                  <p className="font-semibold">{validation.errors.length} error(s)</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {validation.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </Callout>
              ) : (
                <Callout kind="success">
                  <strong>plugin.json is valid</strong> — entry file, routes, pages and UI checks passed.
                </Callout>
              )}
              {validation.warnings.length > 0 ? (
                <Callout kind="warn">
                  <p className="font-semibold">{validation.warnings.length} warning(s)</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {validation.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </Callout>
              ) : null}
              {validation.errors.length > 0 ? (
                <Button size="sm" variant="outline" onClick={() => setAssistantOpen(true)}>
                  <Rocket />
                  Ask AI to fix them
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {/* ── CLI commands (collapsed reference) ──────────────────────────── */}
          <Card>
            <CardHeader className="cursor-pointer pb-3" onClick={() => setShowCommands((value) => !value)}>
              <CardTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4" />
                Do it from the terminal
                <ChevronDown className={cn("ml-auto h-4 w-4 text-muted-foreground transition-transform", showCommands && "rotate-180")} />
              </CardTitle>
              <CardDescription>The same release steps as `selldoes` commands, for scripts and CI.</CardDescription>
            </CardHeader>
            {showCommands ? (
              <CardContent className="space-y-2">
                {commands.map(([label, command]) => (
                  <div key={command} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold">{label}</p>
                      <code className="text-[10.5px] text-muted-foreground">{command}</code>
                    </div>
                    <CopyButton text={command} />
                  </div>
                ))}
              </CardContent>
            ) : null}
          </Card>
        </div>

        {/* ── Release flow ──────────────────────────────────────────────────── */}
        <Card className="self-start">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="h-4 w-4" />
              Release flow
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="list-decimal space-y-2 pl-4 text-[12.5px] leading-relaxed">
              <li>
                <strong>Publish</strong> — builds the bundle, bumps <code>version</code> and uploads the release. The marketplace listing
                goes <code>pending</code>.
              </li>
              <li>
                <strong>Review</strong> — an admin approves it; the previous approved version is kept for rollback.
              </li>
              <li>
                <strong>Store update</strong> — stores that installed the plugin see <em>Update available</em> and update in one click.
              </li>
              <li>
                <strong>Keep iterating</strong> — bump again and publish; pulling the published source is{" "}
                <code>selldoes pull {manifest.slug} --update</code>.
              </li>
            </ol>
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Badge variant="outline">slug {manifest.slug}</Badge>
              <Badge variant="outline">v{manifest.version}</Badge>
              <Badge variant="outline">{status.rebuilds} dev rebuild(s)</Badge>
            </div>
            <Callout kind="info">
              Want the listing to look its best before review? Check{" "}
              <Link to="/listing" className="font-semibold underline">
                Listing
              </Link>{" "}
              and polish your description, icon and screenshots on the{" "}
              <Link to="/details" className="font-semibold underline">
                Details
              </Link>{" "}
              page.
            </Callout>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
