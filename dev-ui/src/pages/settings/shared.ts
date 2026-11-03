import type { ReactNode } from "react"
import type { useBusySet } from "@/lib/use-busy"

/** The busy-tracking object returned by `useBusySet()` — shared by the settings cards. */
export type BusySet = ReturnType<typeof useBusySet>

/** A pending confirmation owned by the page (remove project, reset data, clear undo). */
export interface ConfirmAction {
  title: string
  description: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
}
