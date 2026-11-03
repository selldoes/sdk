import * as React from "react"
import { cn } from "@/lib/utils"

// ─── Line diff (LCS, capped for large files) ─────────────────────────────────

type DiffLine = { type: "add" | "del" | "same"; text: string }

function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n")
  const b = after.split("\n")
  if (a.length * b.length > 1_500_000) {
    return [...a.map((text): DiffLine => ({ type: "del", text })), ...b.map((text): DiffLine => ({ type: "add", text }))]
  }
  const cols = b.length + 1
  const table = new Uint32Array((a.length + 1) * cols)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j] ? table[(i + 1) * cols + (j + 1)] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      out.push({ type: "del", text: a[i] })
      i += 1
    } else {
      out.push({ type: "add", text: b[j] })
      j += 1
    }
  }
  while (i < a.length) out.push({ type: "del", text: a[i++] })
  while (j < b.length) out.push({ type: "add", text: b[j++] })
  return out
}

const COLLAPSE_CONTEXT = 3

export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = React.useMemo(() => diffLines(before, after), [before, after])
  // Collapse long runs of unchanged lines.
  const visible: (DiffLine | { type: "gap"; text: string })[] = []
  let sameRun: DiffLine[] = []
  const flush = () => {
    if (sameRun.length <= COLLAPSE_CONTEXT * 2 + 1) {
      visible.push(...sameRun)
    } else {
      visible.push(...sameRun.slice(0, COLLAPSE_CONTEXT))
      visible.push({ type: "gap", text: `… ${sameRun.length - COLLAPSE_CONTEXT * 2} unchanged lines …` })
      visible.push(...sameRun.slice(-COLLAPSE_CONTEXT))
    }
    sameRun = []
  }
  for (const line of lines) {
    if (line.type === "same") sameRun.push(line)
    else {
      flush()
      visible.push(line)
    }
  }
  flush()
  const changed = lines.some((line) => line.type !== "same")
  if (!changed) return <p className="px-3 py-2 text-[11px] text-muted-foreground">No changes — file already matches.</p>
  return (
    <pre className="max-h-72 overflow-auto border-t border-border bg-muted/40 text-[11px] leading-relaxed">
      {visible.map((line, index) =>
        line.type === "gap" ? (
          <span key={index} className="diff-line block py-0.5 text-center text-muted-foreground">
            {line.text}
          </span>
        ) : (
          <span
            key={index}
            className={cn("diff-line block", line.type === "add" && "diff-add", line.type === "del" && "diff-del")}
          >
            {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
            {line.text}
          </span>
        ),
      )}
    </pre>
  )
}
