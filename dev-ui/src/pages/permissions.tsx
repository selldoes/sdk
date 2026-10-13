import * as React from "react"
import { BarChart3, Loader2, ScanLine, Search, Shield } from "lucide-react"
import { ManifestSaveBar } from "@/components/manifest-save-bar"
import { PageHead, Callout } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { scanPermissions, type PermissionScanResult } from "@/lib/permission-scan"
import { PERMISSION_INFO, PERMISSION_ORDER, RISK_STYLES, filterPermissions, highestRisk } from "@/lib/permissions"
import { useManifestDraft } from "@/lib/use-manifest-draft"
import { useVisit } from "@/lib/use-visit"
import { cn } from "@/lib/utils"
import { useApp } from "@/state/app"

export function PermissionsPage() {
  const { setAssistantPage } = useApp()
  useVisit("permissions")
  const draft = useManifestDraft({ label: "Permissions" })
  const manifest = draft.manifest
  const set = draft.set

  const permissions = (manifest.permissions ?? []) as string[]
  const allowedTables = manifest.allowedTables ?? []
  const tablesText = allowedTables.join(", ")
  const [permissionQuery, setPermissionQuery] = React.useState("")
  const visiblePermissions = filterPermissions(PERMISSION_ORDER, permissionQuery)
  const [scanning, setScanning] = React.useState(false)
  const [scanResult, setScanResult] = React.useState<PermissionScanResult | null>(null)
  const [scanOpen, setScanOpen] = React.useState(false)
  const { toast } = useApp()

  const runScan = async () => {
    setScanning(true)
    try {
      setScanResult(await scanPermissions(manifest))
      setScanOpen(true)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setScanning(false)
    }
  }

  const addMissingPermissions = () => {
    if (!scanResult) return
    const next = [...permissions]
    for (const { permission } of scanResult.missing) {
      if (!next.includes(permission)) next.push(permission)
    }
    set({ permissions: next })
    setScanOpen(false)
    toast(`${scanResult.missing.length} permission(s) added — save to apply`, "success")
  }

  const removeUnusedPermissions = () => {
    if (!scanResult) return
    const unused = new Set<string>(scanResult.unused)
    set({ permissions: permissions.filter((permission) => !unused.has(permission)) })
    setScanOpen(false)
    toast(`${scanResult.unused.length} unneeded permission(s) removed — save to apply`, "success")
  }

  /** "high" → "High" for the summary row. */
  const riskLabel = (risk: string) => risk.charAt(0).toUpperCase() + risk.slice(1)

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is on the Permissions page. Current permissions: ${JSON.stringify(
        permissions,
      )}; allowedTables: ${JSON.stringify(allowedTables)}.`,
      quick: ["Do I request any permission I don't need?", "Explain what each permission allows"],
    })
  }, [setAssistantPage]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <PageHead
        title="Permissions"
        description="Ask for the minimum. Every permission is shown to store owners before they install — the risk and impact text comes from the platform itself. Written to plugin.json."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4" />
                  Permissions
                </CardTitle>
                <CardDescription>
                  Tick what the plugin genuinely needs. Store owners see the full list with risk levels at install time.
                </CardDescription>
              </div>
              <Badge variant="outline" className="shrink-0">
                {permissions.length} selected · {highestRisk(permissions)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={permissionQuery}
                onChange={(event) => setPermissionQuery(event.target.value)}
                placeholder={`Search ${PERMISSION_ORDER.length} permissions…`}
                className="h-9 pl-8"
                aria-label="Search permissions"
              />
            </div>
            {visiblePermissions.map((permission) => {
              const info = PERMISSION_INFO[permission]
              const checked = permissions.includes(permission)
              const styles = RISK_STYLES[info.risk]
              return (
                <label
                  key={permission}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
                    checked ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30",
                  )}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    onCheckedChange={(value) => {
                      const next = value === true ? [...permissions, permission] : permissions.filter((entry) => entry !== permission)
                      set({ permissions: next })
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold">{info.label}</span>
                      <code className="text-[10.5px] text-muted-foreground">{permission}</code>
                      <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", styles.badge)}>
                        {info.risk} risk
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">{info.description}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                      <strong>Impact:</strong> {info.impact}
                    </span>
                  </span>
                </label>
              )
            })}
            {visiblePermissions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                No permissions match “{permissionQuery}”.
              </p>
            ) : null}

            <div className="pt-2">
              <Label htmlFor="tables">Allowed store tables</Label>
              <Input
                id="tables"
                className="mt-1.5 max-w-xl"
                placeholder="products, store_pages"
                value={tablesText}
                onChange={(event) =>
                  set({
                    allowedTables: event.target.value
                      .split(",")
                      .map((table) => table.trim())
                      .filter(Boolean),
                  })
                }
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Comma-separated platform tables the plugin may read/write. Your own <code>plugin_&lt;slug&gt;_*</code> tables are always
                available and don't need listing.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4" />
                Summary
              </CardTitle>
              <CardDescription>What store owners will be asked to approve.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 text-[12.5px]">
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-muted-foreground">Permissions</span>
                <span className="font-semibold">{permissions.length}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-muted-foreground">Highest risk</span>
                <span className="font-semibold">{riskLabel(highestRisk(permissions))}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-muted-foreground">Allowed tables</span>
                <span className="font-semibold">{allowedTables.length}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ScanLine className="h-4 w-4" />
                Scan code
              </CardTitle>
              <CardDescription>
                Greps your source for ctx.* capability calls and reports permissions the code needs but plugin.json
                doesn&apos;t declare yet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" onClick={() => void runScan()} disabled={scanning}>
                {scanning ? <Loader2 className="animate-spin" /> : <ScanLine />}
                {scanning ? "Scanning…" : "Scan for permissions"}
              </Button>
            </CardContent>
          </Card>

          {draft.validation.warnings.length > 0 ? (
            <Callout kind="warn">
              <p className="font-semibold">Warnings</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {draft.validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </div>
      </div>

      <ManifestSaveBar draft={draft} saveLabel="Save permissions" />

      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Permission scan</DialogTitle>
            <DialogDescription>
              Scanned {scanResult?.filesScanned ?? 0} source file(s) for ctx.* capability calls
              {scanResult?.truncated ? " (results truncated — some usages may be missing)" : ""}.
            </DialogDescription>
          </DialogHeader>

          {scanResult && scanResult.missing.length > 0 ? (
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {scanResult.missing.map(({ permission, evidence }) => {
                const info = PERMISSION_INFO[permission]
                const styles = RISK_STYLES[info.risk]
                return (
                  <div key={permission} className={cn("rounded-lg border px-3 py-2", styles.badge)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold">{info.label}</span>
                      <code className="text-[10.5px] opacity-70">{permission}</code>
                      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{info.risk} risk</span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed opacity-80">{info.impact}</p>
                    <p className="mt-1 text-[10.5px] opacity-60">
                      Found in:{" "}
                      {evidence.map((hit, index) => (
                        <React.Fragment key={`${hit.path}:${hit.line}`}>
                          {index > 0 ? ", " : null}
                          <code>
                            {hit.path}
                            {hit.line > 0 ? `:${hit.line}` : ""}
                          </code>
                        </React.Fragment>
                      ))}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            <Callout kind="success">
              <p className="font-semibold">Nothing missing</p>
              <p className="mt-0.5 text-[12px]">
                Every capability the scan found in your code is already covered by the current permissions.
              </p>
            </Callout>
          )}

          {scanResult && scanResult.unused.length > 0 ? (
            <div>
              <p className="text-[12px] font-semibold">Possibly not needed</p>
              <p className="text-[11px] text-muted-foreground">
                Declared in plugin.json but no use found in code
                {!scanResult.unusedReliable ? " (treat as a hint — the scan truncated, some files were skipped)" : ""}.
              </p>
              <div className="mt-1.5 space-y-1.5">
                {scanResult.unused.map((permission) => {
                  const info = PERMISSION_INFO[permission]
                  const styles = RISK_STYLES[info.risk]
                  return (
                    <div key={permission} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", styles.dot)} />
                      <span className="text-[12.5px]">{info.label}</span>
                      <code className="text-[10.5px] text-muted-foreground">{permission}</code>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {scanResult && scanResult.missing.length === 0 && scanResult.unused.length === 0 ? null : (
            <p className="text-[11.5px] text-muted-foreground">Changes stay unsaved until you press the save button.</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setScanOpen(false)}>
              No thanks
            </Button>
            {scanResult && scanResult.unused.length > 0 ? (
              <Button variant="destructive" onClick={removeUnusedPermissions}>
                Remove {scanResult.unused.length} unneeded
              </Button>
            ) : null}
            {scanResult && scanResult.missing.length > 0 ? (
              <Button onClick={addMissingPermissions}>Yes, add {scanResult.missing.length} permission(s)</Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
