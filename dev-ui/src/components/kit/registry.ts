import {
  Activity,
  BarChart2,
  BookOpen,
  FileText,
  Link2,
  Play,
  ScrollText,
  Settings,
  Table,
  type LucideIcon,
} from "lucide-react"
import type { PluginDashboardSection, PluginManifest } from "@/lib/types"

/**
 * Metadata for the no-code components kit — the single source of truth the
 * visual builder (palette, inspector, templates) reads from. `section-kit.tsx`
 * remains the renderer; keep the two in sync when the host gains a type.
 */

export interface KitComponentMeta {
  type: string
  label: string
  description: string
  icon: LucideIcon
  group: "Content" | "Data" | "Actions"
}

export const KIT_COMPONENTS: KitComponentMeta[] = [
  { type: "text", label: "Text", description: "Title + markdown body — intros, guides, notes.", icon: FileText, group: "Content" },
  { type: "stats", label: "Stats", description: "A row of metric cards (label, value, hint).", icon: BarChart2, group: "Content" },
  { type: "links", label: "Links", description: "Buttons linking to docs, dashboards or your site.", icon: Link2, group: "Content" },
  { type: "table", label: "Table", description: "Live rows from one of your API routes.", icon: Table, group: "Data" },
  { type: "logs", label: "Logs", description: "Recent dev-server output in a monospace panel.", icon: ScrollText, group: "Data" },
  { type: "job", label: "Job runner", description: "Run a declared job with a live transcript.", icon: Play, group: "Actions" },
  { type: "settings", label: "Settings form", description: "Renders your configSchema fields, saved per store.", icon: Settings, group: "Actions" },
]

export function kitComponent(type: string): KitComponentMeta | undefined {
  return KIT_COMPONENTS.find((component) => component.type === type)
}

/** Sensible starting settings for a freshly added component. */
export function defaultSettings(type: string, manifest: PluginManifest): Record<string, unknown> {
  switch (type) {
    case "text":
      return { title: "New text", body: "Write **markdown** here — or ask the AI assistant to fill it in." }
    case "stats":
      return {
        items: [
          { label: "Metric", value: "0", hint: "" },
          { label: "Metric", value: "0", hint: "" },
        ],
      }
    case "table":
      return { title: "Data", route: manifest.apiRoutes?.[0]?.path ?? "", columns: [], maxRows: 50 }
    case "job":
      return { title: "Run a job", job: manifest.jobs?.[0]?.type ?? "", maxTicks: 20 }
    case "logs":
      return { title: "Dev logs", lines: 20 }
    case "links":
      return { items: [{ label: "Documentation", href: "https://selldoes.com" }] }
    default:
      return {}
  }
}

export interface KitTemplate {
  id: string
  label: string
  description: string
  icon: LucideIcon
  build: (manifest: PluginManifest) => PluginDashboardSection[]
}

/** Starter templates — insert a whole page's worth of components at once. */
export const KIT_TEMPLATES: KitTemplate[] = [
  {
    id: "reports",
    label: "Reports",
    description: "Stats row, a table over your first API route and a job runner.",
    icon: BarChart2,
    build: (manifest) => [
      { type: "stats", settings: defaultSettings("stats", manifest) },
      { type: "table", settings: defaultSettings("table", manifest) },
      { type: "job", settings: defaultSettings("job", manifest) },
    ],
  },
  {
    id: "about",
    label: "About",
    description: "An intro text and a row of links.",
    icon: BookOpen,
    build: (manifest) => [
      { type: "text", settings: { title: "About", body: "Describe what this plugin does and how to use it." } },
      { type: "links", settings: defaultSettings("links", manifest) },
    ],
  },
  {
    id: "ops",
    label: "Ops",
    description: "A job runner next to live dev logs.",
    icon: Activity,
    build: (manifest) => [
      { type: "job", settings: defaultSettings("job", manifest) },
      { type: "logs", settings: defaultSettings("logs", manifest) },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    description: "The configSchema form for this plugin.",
    icon: Settings,
    build: () => [{ type: "settings", settings: {} }],
  },
]
