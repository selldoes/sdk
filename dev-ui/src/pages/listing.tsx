import * as React from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle,
  Check,
  LayoutDashboard,
  Puzzle,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Store,
} from "lucide-react"
import { AppIcon } from "@/components/app-icon"
import { PermissionList } from "@/components/permission-list"
import { PageHead, Stars, SectionTitle } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { permissionInfo, sortByRisk } from "@/lib/permissions"
import { mediaUrl } from "@/lib/utils"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

export function ListingPage() {
  const { bootstrap, setAssistantPage } = useApp()
  useVisit("listing")
  const manifest = bootstrap!.manifest
  const store = bootstrap!.store
  const permissions = (manifest.permissions ?? []) as string[]
  const screenshots = manifest.screenshots ?? []
  const [acknowledged, setAcknowledged] = React.useState(false)
  const pages = manifest.dashboardPages ?? []

  React.useEffect(() => {
    setAssistantPage({
      context: "The developer is previewing how the plugin appears in the Selldoes marketplace and dashboard.",
      quick: ["Improve my marketplace description", "Make my screenshots list compelling"],
    })
  }, [setAssistantPage])

  return (
    <div className="space-y-5">
      <PageHead
        title="Listing"
        description="Exactly what store owners see: the marketplace card, the listing page, the install dialog and where your plugin lands in the dashboard."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Marketplace card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="h-4 w-4" />
              Marketplace card
            </CardTitle>
            <CardDescription>Shown in the marketplace grid and search results.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-sm rounded-xl border border-border bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex gap-3">
                <AppIcon name={manifest.icon} imageUrl={manifest.iconUrl} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold">
                    {manifest.name}
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">FREE</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">{manifest.description}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-[11px] text-muted-foreground">
                <Stars rating={0} count={0} />
                <span>0 installs</span>
              </div>
              {(manifest.tags ?? []).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {(manifest.tags ?? []).slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Where it appears */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <LayoutDashboard className="h-4 w-4" />
              Where it lands in the dashboard
            </CardTitle>
            <CardDescription>
              {pages.length > 0
                ? "Your dashboardPages entries appear in the store sidebar, grouped like this:"
                : "No dashboardPages declared — declare them in plugin.json to add sidebar items."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-[230px] rounded-xl border border-border bg-card p-3">
              <p className="flex items-center gap-2 border-b border-border pb-2 text-[11px] font-bold">
                <Store className="h-3.5 w-3.5 text-primary" />
                {store.name}
              </p>
              <DidYouKnow />
              {pages.length > 0 ? (
                pages.map((page) => (
                  <div key={page.path} className="mt-1.5 flex items-center gap-2 rounded-lg bg-primary px-2.5 py-1.5 text-[11.5px] font-semibold text-primary-foreground">
                    <Puzzle className="h-3.5 w-3.5" />
                    {page.label}
                  </div>
                ))
              ) : (
                <div className="mt-2 rounded-lg border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">
                  Settings + jobs page (automatic)
                </div>
              )}
              <div className="mt-2 space-y-1 opacity-50">
                {["Products", "Orders", "Plugins", "Settings"].map((entry) => (
                  <p key={entry} className="px-2.5 py-1 text-[11.5px] text-muted-foreground">
                    {entry}
                  </p>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/dashboard">
                  <LayoutDashboard />
                  Open the dashboard page
                </Link>
              </Button>
              {manifest.storefrontWidget?.entry || (manifest.storefrontPages ?? []).length > 0 ? (
                <Button asChild size="sm" variant="outline">
                  <Link to="/storefront">
                    <ShoppingBag />
                    Storefront
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <SectionTitle>Listing page</SectionTitle>
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3.5">
            <AppIcon name={manifest.icon} imageUrl={manifest.iconUrl} className="h-12 w-12" />
            <div>
              <h3 className="text-xl font-extrabold tracking-tight">{manifest.name}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                by {manifest.author || "Community"} · v{manifest.version} · {manifest.category ?? "other"}
              </p>
              <div className="mt-2 flex items-center gap-4">
                <Stars rating={0} count={0} />
                <span className="text-xs text-muted-foreground">0 installs</span>
              </div>
            </div>
          </div>
          <Button className="px-6">Install</Button>
        </div>

        <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">{manifest.description}</p>

        {screenshots.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-3">
            {screenshots.map((path) => (
              <a key={path} href={mediaUrl(path)} target="_blank" rel="noreferrer">
                <img src={mediaUrl(path)} alt="" className="h-32 w-full rounded-lg border border-border object-cover" />
              </a>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No screenshots yet —{" "}
            <Link to="/details" className="text-primary hover:underline">
              add some
            </Link>{" "}
            so the listing stands out.
          </div>
        )}

        <div className="mt-5 max-w-3xl">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Permissions required</p>
          <PermissionList permissions={permissions} allowedTables={manifest.allowedTables ?? []} />
        </div>
      </div>

      <SectionTitle>What owners see when they install</SectionTitle>
      <div className="max-w-xl rounded-xl border border-border bg-card p-5 shadow-lg">
        <p className="flex items-center gap-2 text-[15px] font-extrabold">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Install “{manifest.name}”?
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Version {manifest.version} · <code>{manifest.slug}</code>
        </p>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
          <div className="text-xs text-orange-800">
            <p className="font-semibold">This plugin is not verified by Selldoes.</p>
            <p className="mt-1">
              Its code is unreviewed and will run with the permissions below. It cannot read other stores or platform credentials, but it
              can still change or export anything it is granted here.
            </p>
          </div>
        </div>

        <div className="mt-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">What this plugin can do</p>
          <PermissionList permissions={permissions} allowedTables={manifest.allowedTables ?? []} />
        </div>

        {permissions.some((permission) => ["high", "critical"].includes(permissionInfo(permission).risk)) ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-semibold">High-impact permissions</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {permissions
                .filter((permission) => ["high", "critical"].includes(permissionInfo(permission).risk))
                .map((permission) => (
                  <li key={permission}>{permissionInfo(permission).impact}</li>
                ))}
            </ul>
          </div>
        ) : null}

        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3">
          <Checkbox checked={acknowledged} onCheckedChange={(value) => setAcknowledged(value === true)} className="mt-0.5" />
          <span className="text-xs">
            I understand this plugin can modify or delete data in my store and act with every permission listed above.
          </span>
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setAcknowledged(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={!acknowledged}>
            <Check />
            Install anyway
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-[12.5px]">
          <strong>Tip:</strong> ask the AI assistant to tighten your permissions, rewrite the description or add screenshots — it proposes
          edits you can review first.
        </p>
        <Button asChild size="sm" variant="outline" className="ml-auto">
          <Link to="/details">Edit details</Link>
        </Button>
      </div>
    </div>
  )
}

function DidYouKnow() {
  return (
    <p className="pt-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Plugins</p>
  )
}
