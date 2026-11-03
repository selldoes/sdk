import type { ApplyResult } from "@/lib/api"
import type { AssistantEdits, Validation } from "@/lib/types"

// ─── Chat item types ─────────────────────────────────────────────────────────

export type ChatItem =
  | { id: number; kind: "user"; content: string }
  | { id: number; kind: "assistant"; content: string }
  | { id: number; kind: "system"; content: string }
  | { id: number; kind: "error"; content: string }
  | { id: number; kind: "edits"; edits: AssistantEdits; applied?: { validation: Validation; applied: string[] } }

let cursor = 0

export const nextId = () => ++cursor

/** Keep the id counter ahead of any restored ids so new items never collide. */
export function seedCursor(ids: number[]): void {
  if (ids.length) cursor = Math.max(cursor, ...ids)
}

/** Only conversation text survives a reload — edit cards would be stale. */
export function isPersistable(item: ChatItem): boolean {
  return item.kind === "user" || item.kind === "assistant" || item.kind === "system" || item.kind === "error"
}

/** Human summary of an apply result — shown in the chat as a system note. */
export function applyFeedback(result: ApplyResult): string {
  const parts = [
    `Applied ${result.applied.length} file(s): ${result.applied.join(", ") || "—"}.`,
    `Validation: ${result.validation.errors.length} error(s), ${result.validation.warnings.length} warning(s).`,
  ]
  if (result.rebuildError) parts.push(`Rebuild failed: ${result.rebuildError}`)
  const test = result.test
  if (test) {
    if (test.skipped) parts.push(`Test job: ${test.skipped}.`)
    else if (test.error) parts.push(`Test job ${test.type ?? "?"} failed: ${test.error}`)
    else {
      parts.push(
        `Test job ${test.type}: ${test.ticks ?? 0} tick(s) · ${test.done ? "done" : "tick limit reached"}${test.result ? ` · ${JSON.stringify(test.result).slice(0, 160)}` : ""}`,
      )
    }
  }
  return parts.join("\n")
}
