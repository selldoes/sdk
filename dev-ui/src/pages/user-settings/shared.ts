import type { ReactNode } from "react"
import type { useBusySet } from "@/lib/use-busy"

/** The busy-tracking object returned by `useBusySet()` — shared by the settings cards. */
export type BusySet = ReturnType<typeof useBusySet>

/** Editor choices for `selldoes open` — also used when normalising the saved value. */
export const EDITOR_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "code", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "windsurf", label: "Windsurf" },
  { value: "code-insiders", label: "VS Code Insiders" },
  { value: "custom", label: "Custom command…" },
]

/** How a workspace project was added — surfaced by the registry. */
export const SOURCE_LABELS: Record<string, string> = {
  folder: "imported folder",
  zip: "imported zip",
  create: "created here",
  account: "pulled from account",
}

/** A pending confirmation owned by the page (remove project, clear registry). */
export interface ConfirmAction {
  title: string
  description: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
}
