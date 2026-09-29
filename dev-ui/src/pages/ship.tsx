import * as React from "react"
import { Link } from "react-router-dom"
import { AlertCircle, Check, Rocket, Terminal } from "lucide-react"
import { Callout, CopyButton, PageHead } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

export function ShipPage() {
  const { bootstrap, setAssistantPage, setAssistantOpen } = useApp()
  useVisit("ship")
  const manifest = bootstrap!.manifest
  const validation = bootstrap!.validation
  const status = bootstrap!.status

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is on the Ship page. Validation: ${validation.errors.length} error(s), ${validation.warnings.length} warning(s).`,
      quick: ["Fix my validation errors", "Write release notes for this version"],
    })
  }, [setAssistantPage, validation.errors.length, validation.warnings.length])

  const commands = [
    ["Typecheck", "npm run typecheck"],
    ["Validate", "npm run validate"],
    ["Build bundle", "npm run build"],
    ["Zip for upload", "npm run pack"],
    ["Publish (dashboard session)", "npm run publish -- --app-url https://selldoes.com --store <id>"],
    ["Publish (CI token)", "npm run publish -- --app-url https://selldoes.com --token $SELLDOES_PUBLISH_TOKEN"],
  ] as const

  return (
    <div className="space-y-4">
      <PageHead
        title="Validate & publish"
        description="Ship when the preview looks right. Validation, build and publish run from the CLI — this page shows what each step does."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4" />
                Commands
              </CardTitle>
              <CardDescription>
                Run these from the plugin directory. <code>dev</code> is already running.
              </CardDescription>
            </CardHeader>
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
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="h-4 w-4" />
              Release flow
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="list-decimal space-y-2 pl-4 text-[12.5px] leading-relaxed">
              <li>
                <strong>Bump <code>version</code></strong> in plugin.json — publishing never overwrites an existing release.
              </li>
              <li>
                <strong>Build + pack</strong> — <code>npm run pack</code> writes <code>dist/{manifest.slug}.zip</code>.
              </li>
              <li>
                <strong>Publish</strong> — uploads the release and creates/refreshes the marketplace listing as <code>pending</code>.
              </li>
              <li>
                <strong>Review</strong> — an admin approves it; then stores can install or update.
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
                In Selldoes
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
