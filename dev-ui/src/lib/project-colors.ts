/**
 * Accent colors for workspace projects. Chosen in the New-workspace wizard,
 * stored on the workspace entry (`~/.selldoes/workspace.json`) and used for the
 * glyph tiles in the sidebar switcher.
 *
 * Static Tailwind classes only — never build these dynamically.
 */

import type { WsProject } from "@/lib/ws-api"

export type AccentName = "orange" | "violet" | "sky" | "emerald" | "rose" | "amber"

export const ACCENT_NAMES: AccentName[] = ["orange", "violet", "sky", "emerald", "rose", "amber"]

export const ACCENTS: Record<AccentName, { tile: string; swatch: string; ring: string; text: string }> = {
  orange: {
    tile: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    swatch: "bg-orange-500",
    ring: "ring-orange-500",
    text: "text-orange-600 dark:text-orange-400",
  },
  violet: {
    tile: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    swatch: "bg-violet-500",
    ring: "ring-violet-500",
    text: "text-violet-600 dark:text-violet-400",
  },
  sky: {
    tile: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    swatch: "bg-sky-500",
    ring: "ring-sky-500",
    text: "text-sky-600 dark:text-sky-400",
  },
  emerald: {
    tile: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    swatch: "bg-emerald-500",
    ring: "ring-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  rose: {
    tile: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    swatch: "bg-rose-500",
    ring: "ring-rose-500",
    text: "text-rose-600 dark:text-rose-400",
  },
  amber: {
    tile: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    swatch: "bg-amber-500",
    ring: "ring-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
}

/** Stable accent for projects that don't have one yet (e.g. imported folders). */
export function accentFor(project: Pick<WsProject, "slug" | "kind" | "color">): AccentName {
  if (project.color && ACCENT_NAMES.includes(project.color as AccentName)) return project.color as AccentName
  const source = `${project.kind}:${project.slug}`
  let hash = 0
  for (let index = 0; index < source.length; index++) hash = (hash * 31 + source.charCodeAt(index)) >>> 0
  // Themes lean violet/palette, plugins take the rest.
  if (project.kind === "theme") return hash % 2 === 0 ? "violet" : "rose"
  return ACCENT_NAMES[hash % ACCENT_NAMES.length]
}
