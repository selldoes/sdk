import * as React from "react"
import { ExternalLink, Loader2, Settings2, Sparkles } from "lucide-react"
import { EmptyState, PageHead } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SectionKit } from "@/components/kit/section-kit"
import { SectionBuilder } from "@/components/kit/section-builder"
import { useVisit } from "@/lib/use-visit"
import { dev } from "@/lib/api"
import { useDevStream } from "@/lib/use-dev-stream"
import type { PluginManifest } from "@/lib/types"
import { useApp } from "@/state/app"

/**
 * Design → Settings: the plugin's settings dialog.
 *
 * When a plugin ships `settingsDialog.sections`, the Selldoes plugin manager's
 * Settings button opens the compiled dialog (`ui/kit/settings.html`) in a
 * modal instead of sending the merchant to the plugin home page. Without it,
 * Settings falls back to the plugin home — so this page is optional polish.
 *
 * The sections are authored data; the kit compiler builds the entry on every
 * save/rebuild, exactly like dashboard pages. A hand-written
 * `settingsDialog.entry` (e.g. `ui/settings-dialog.html`) is served as-is and
 * wins over the kit — edit that file directly instead of the builder.
 */
export function SettingsDialogPage() {
  const { bootstrap, applyManifest, refresh, toast, setAssistantPage } = useApp()
  useVisit("settings-dialog")
  const manifest = bootstrap!.manifest
  const store = bootstrap!.store

  const sections = React.useMemo(
    () => (Array.isArray(manifest.settingsDialog?.sections) ? manifest.settingsDialog!.sections! : []),
    [manifest],
  )
  const entry = manifest.settingsDialog?.entry ? String(manifest.settingsDialog.entry).replace(/^\.\//, "") : null
  const hasDesign = sections.length > 0 || Boolean(entry)
  // The kit compiler owns `ui/kit/settings.html`; anything else is hand-written
  // and wins over the kit — adding components would have no effect on it.
  const isHandWritten = Boolean(entry) && entry !== "ui/kit/settings.html"

  const [builderOpen, setBuilderOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [frameNonce, setFrameNonce] = React.useState(0)

  // Rebuilds regenerate ui/kit/settings.html — keep the preview fresh.
  useDevStream(
    (event) => {
      if (event.type === "build") setFrameNonce((nonce) => nonce + 1)
    },
    { key: manifest.slug },
  )

  React.useEffect(() => {
    setAssistantPage({
      context:
        "The developer is designing their plugin's settings dialog — the modal the store owner opens from the plugin manager's Settings button. It renders settingsDialog.sections (kit components); without a designed dialog the merchant sees the plugin's default home page.",
      quick: ["What belongs in a settings dialog?", "Add a settings form component"],
    })
  }, [setAssistantPage])

  const source = entry
    ? `/api/plugins/${manifest.slug}/ui/${entry}?storeId=${store.id}&storeSlug=${encodeURIComponent(store.slug)}&dialog=settings&v=${frameNonce}`
    : null

  /**
   * Creates the settings menu — seeds a `settings` component (the configSchema
   * form) so the first save produces a working dialog — then opens the
   * components builder to add to it.
   */
  const createSettingsMenu = async () => {
    if (creating) return
    setCreating(true)
    try {
      if (sections.length === 0 && !entry) {
        const next = JSON.parse(JSON.stringify(manifest)) as PluginManifest
        next.settingsDialog = {
          ...(next.settingsDialog ?? {}),
          sections: [{ type: "settings", settings: {} }],
        }
        const response = await dev.saveManifest(next)
        applyManifest(response.manifest, response.validation)
        await refresh()
        setFrameNonce((nonce) => nonce + 1)
        toast("Settings menu created — add components to shape it", "success")
      }
      setBuilderOpen(true)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHead
        title="Settings"
        description={
          <>
            Design the dialog merchants open from <strong>Plugins → Settings</strong> in the Selldoes dashboard.
            Without one, Settings takes them to your plugin&apos;s home page — so this is optional polish, not a requirement.
          </>
        }
      />

      {!hasDesign ? (
        <EmptyState
          icon={Settings2}
          title="No plugin settings menu yet"
          message={
            <>
              Merchants open this dialog from the plugin manager&apos;s <strong>Settings</strong> button on the Plugins
              page. Create one to give them a focused, branded dialog instead of the default plugin home — a settings
              form component renders your <code>configSchema</code>, then add text, stats, links or anything else from
              the components kit.
            </>
          }
          action={
            <Button size="sm" onClick={() => void createSettingsMenu()} disabled={creating}>
              {creating ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Create settings menu
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings2 className="h-4 w-4" />
                  Settings dialog
                  {sections.length > 0 ? <Badge className="border-0 bg-violet-100 text-violet-700">components</Badge> : null}
                  {isHandWritten ? <Badge className="border-0 bg-sky-100 text-sky-700">hand-written</Badge> : null}
                </CardTitle>
                <CardDescription>
                  {isHandWritten ? (
                    <>
                      Served from the hand-written entry <code>{entry}</code> — the plugin manager opens this file
                      exactly as-is. Edit it directly; kit components only take over when no entry is declared.
                    </>
                  ) : source ? (
                    <>
                      Compiled from <code>settingsDialog.sections</code> into <code>{entry}</code> — the exact dialog
                      the plugin manager serves. Edit components or ask the AI to rearrange.
                    </>
                  ) : sections.length > 0 ? (
                    <>
                      Compiling from <code>settingsDialog.sections</code> — the next rebuild generates{" "}
                      <code>ui/kit/settings.html</code>.
                    </>
                  ) : (
                    <>Rendered in a self-resizing dialog on the Plugins page. Edit components to start designing.</>
                  )}
                </CardDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isHandWritten && sections.length === 0 ? null : (
                  <Button size="sm" variant="outline" onClick={() => setBuilderOpen(true)}>
                    <Sparkles />
                    {sections.length > 0 ? "Edit components" : "Add components"}
                  </Button>
                )}
                {source ? (
                  <Button size="sm" variant="outline" onClick={() => window.open(source, "_blank")}>
                    <ExternalLink />
                    Open raw
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {source ? (
              <iframe
                key={source}
                src={source}
                title="Plugin settings dialog preview"
                className="h-[420px] w-full rounded-xl border border-border bg-white"
              />
            ) : sections.length > 0 ? (
              <SectionKit slug={manifest.slug} store={store} sections={sections} />
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
                <Settings2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">No dialog designed yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add components (a <code>settings</code> component renders your configSchema form) — the kit compiles
                  them into <code>ui/kit/settings.html</code> on save.
                </p>
                <Button size="sm" className="mt-3" onClick={() => setBuilderOpen(true)}>
                  <Sparkles />
                  Add components
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <SectionBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        slug={manifest.slug}
        store={store}
        manifest={manifest}
        pageLabel="Settings"
        pagePath="/settings"
        hasEntry={Boolean(entry)}
        sections={sections}
        scope="settings"
      />
    </div>
  )
}
