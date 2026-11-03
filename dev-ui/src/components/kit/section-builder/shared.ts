import type { PluginDashboardSection } from "@/lib/types"

export const DND_MIME = "application/x-selldoes-kit"

export function cloneSections(sections: PluginDashboardSection[]): PluginDashboardSection[] {
  return JSON.parse(JSON.stringify(sections)) as PluginDashboardSection[]
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

export function settingsOf(section: PluginDashboardSection): Record<string, unknown> {
  return (section.settings ?? {}) as Record<string, unknown>
}

export function sectionIsEmpty(section: PluginDashboardSection): boolean {
  const settings = settingsOf(section)
  if (section.type === "text") return !settings.title && !settings.body
  if (section.type === "stats" || section.type === "links") {
    return !Array.isArray(settings.items) || settings.items.length === 0
  }
  return false
}

/** Keeps only the fields the manifest should carry (drops undefined). */
export function cleanSections(sections: PluginDashboardSection[]): PluginDashboardSection[] {
  return sections.map((section) => {
    const copy: PluginDashboardSection = { type: section.type }
    if (section.id) copy.id = section.id
    if (section.settings !== undefined) copy.settings = JSON.parse(JSON.stringify(section.settings))
    for (const [key, value] of Object.entries(section)) {
      if (key !== "type" && key !== "id" && key !== "settings") copy[key] = value
    }
    return copy
  })
}
