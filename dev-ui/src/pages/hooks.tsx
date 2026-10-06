import * as React from "react"
import { Loader2, Plus, Webhook } from "lucide-react"
import { CreateHookDialog } from "@/components/create-dialogs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, PageHead } from "@/components/shared"
import { dev } from "@/lib/api"
import { healMissingDeclaration, parseMissingDeclaration } from "@/lib/self-heal"
import type { PluginManifest, Validation } from "@/lib/types"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

interface HookDeclaration {
  handler?: string
  component?: string
  types?: string[]
}

export function HooksPage() {
  const { bootstrap, setAssistantPage, applyManifest, refresh, toast } = useApp()
  useVisit("hooks")
  const manifest = bootstrap!.manifest
  const hooks = Object.entries((manifest.hooks ?? {}) as Record<string, HookDeclaration>)

  // ── Creation: New hook (scaffold into hooks/ + plugin.json + entry) ──────
  const [createOpen, setCreateOpen] = React.useState(false)

  const handleScaffolded = React.useCallback(
    (next: PluginManifest, validation: Validation, message: string) => {
      applyManifest(next, validation)
      toast(message, "success")
      void refresh()
    },
    [applyManifest, refresh, toast],
  )

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is on the Hooks page. Declared hooks: ${JSON.stringify(hooks.map(([name]) => name))}.`,
      quick: ["Explain hooks in plain language", "Add a hook that reacts to orders"],
    })
  }, [setAssistantPage]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <PageHead
        title="Hooks"
        description="Events your plugin subscribes to. Fire one here and inspect the return value — the same handler the host calls."
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            New hook
          </Button>
        }
      />

      {hooks.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="No hooks declared"
          message={
            <>
              Declare hooks in plugin.json and export them from your entry as <code>hooks["name"]</code> — or scaffold one.
            </>
          }
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus />
              New hook
            </Button>
          }
        />
      ) : (
        hooks.map(([name, declaration]) => <HookCard key={name} name={name} declaration={declaration} />)
      )}

      <CreateHookDialog open={createOpen} onOpenChange={setCreateOpen} onScaffolded={handleScaffolded} />
    </div>
  )
}

function HookCard({ name, declaration }: { name: string; declaration: HookDeclaration }) {
  const { toast, bootstrap, applyManifest, refresh } = useApp()
  const [payload, setPayload] = React.useState('{\n  "storeId": 1\n}')
  const [result, setResult] = React.useState("—")
  const [busy, setBusy] = React.useState(false)
  const [parseError, setParseError] = React.useState<string | null>(null)

  /** Fire = just run it; a missing plugin.json declaration is added and the fire retried once. */
  const fire = async (healed = false) => {
    let parsed: unknown = {}
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {}
      setParseError(null)
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error))
      return
    }
    setBusy(true)
    setResult("…")
    try {
      const data = await dev.runHook(name, parsed)
      if (typeof data.error === "string" && data.error && !healed) {
        const missing = parseMissingDeclaration(data.error)
        if (missing) {
          const changed = await healMissingDeclaration(missing, { manifest: bootstrap!.manifest, applyManifest, refresh, toast })
          if (changed) {
            setBusy(false)
            await fire(true)
            return
          }
        }
      }
      setResult(JSON.stringify(data.result ?? data, null, 2))
      if (typeof data.error === "string" && data.error) toast(data.error, "error")
      else toast(`Hook ${name} fired`, "success")
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  const description = declaration.handler
    ? `handler: ${declaration.handler}`
    : declaration.component
      ? `component: ${declaration.component}`
      : declaration.types
        ? `types: ${(declaration.types ?? []).join(", ")}`
        : ""

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{name}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea className="font-mono text-xs" value={payload} onChange={(event) => setPayload(event.target.value)} />
        {parseError ? <p className="text-[11px] text-destructive">{parseError}</p> : null}
        <Button size="sm" onClick={() => void fire()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Webhook />}
          Fire hook
        </Button>
        <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11.5px]">{result}</pre>
      </CardContent>
    </Card>
  )
}
