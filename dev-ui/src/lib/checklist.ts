import type { DevActivity, PluginManifest, Validation } from "./types"
import { highestRisk } from "./permissions"

export interface ChecklistItem {
  key: string
  title: string
  note: string
  to: string
  done: boolean
}

export function buildChecklist(manifest: PluginManifest, activity: DevActivity, validation: Validation): ChecklistItem[] {
  const visits = activity.visits ?? {}
  const jobs = manifest.jobs ?? []
  const routes = [...(manifest.apiRoutes ?? []), ...(manifest.publicRoutes ?? [])]
  const storefront = Boolean(manifest.storefrontWidget?.entry) || (manifest.storefrontPages ?? []).length > 0
  const permissions = (manifest.permissions ?? []) as string[]

  const items: (ChecklistItem | null)[] = [
    {
      key: "details",
      title: "Describe your plugin",
      note: "Name, description, icon and category — the first thing store owners see.",
      to: "/details",
      done: Boolean(manifest.name && String(manifest.description ?? "").trim().length > 12 && (manifest.icon || manifest.iconUrl)),
    },
    {
      key: "permissions",
      title: "Review permissions",
      note: `${permissions.length} requested · highest risk ${highestRisk(permissions)}${
        (manifest.allowedTables ?? []).length ? ` · ${manifest.allowedTables!.length} table(s)` : ""
      }`,
      to: "/details",
      done: visits.details === true && permissions.length > 0,
    },
    {
      key: "listing",
      title: "See it inside Selldoes",
      note: "Marketplace card, listing page, install dialog and dashboard page.",
      to: "/listing",
      done: visits.listing === true,
    },
    jobs.length
      ? {
          key: "jobs",
          title: "Run a job",
          note: `${jobs.length} declared — run one and watch progress, items and logs.`,
          to: "/jobs",
          done: (activity.jobs?.count ?? 0) > 0,
        }
      : null,
    routes.length
      ? {
          key: "api",
          title: "Call an API route",
          note: `${routes.length} route(s) declared — send a request from the console.`,
          to: "/api",
          done: (activity.routes?.count ?? 0) > 0,
        }
      : null,
    storefront
      ? {
          key: "storefront",
          title: "Check the storefront",
          note: manifest.storefrontWidget?.entry ? "Widget + pages rendered on a demo store." : "Your public pages on a demo store.",
          to: "/storefront",
          done: visits.storefront === true,
        }
      : null,
    manifest.ui?.entry
      ? {
          key: "dashboard",
          title: "Try your dashboard UI",
          note: "Rendered in a sandboxed iframe, exactly like the host does.",
          to: "/dashboard",
          done: visits.dashboard === true,
        }
      : null,
    {
      key: "ship",
      title: "Validate & publish",
      note: validation.errors.length
        ? `${validation.errors.length} error(s) to fix before publishing.`
        : "Bump the version and publish for review in one click.",
      to: "/ship",
      done: visits.ship === true && validation.errors.length === 0,
    },
  ]

  return items.filter((item): item is ChecklistItem => item !== null)
}
