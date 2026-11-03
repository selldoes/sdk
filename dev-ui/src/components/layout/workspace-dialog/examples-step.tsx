import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WsExample } from "@/lib/ws-api"
import { type ExampleKind, styleFor, Thumb, thumbFor } from "./shared"

// ─── Step 2 · Example ────────────────────────────────────────────────────────

export function StepExamples({
  kind,
  examples,
  exampleId,
  onSelect,
}: {
  kind: ExampleKind
  examples: WsExample[]
  exampleId: string
  onSelect: (example: WsExample) => void
}) {
  if (examples.length === 0) {
    return <p className="text-xs text-muted-foreground">Loading examples…</p>
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {examples.map((entry) => (
          <ExampleCard
            key={entry.id}
            example={entry}
            kind={kind}
            selected={entry.id === exampleId}
            onSelect={() => onSelect(entry)}
          />
        ))}
      </div>
      <p className="text-[10.5px] leading-snug text-muted-foreground">
        Every example is a complete project — jobs, routes, dashboard pages and a README explaining how it works. Everything is
        yours to edit after creating.
      </p>
    </div>
  )
}

function ExampleCard({
  example,
  kind,
  selected,
  onSelect,
}: {
  example: WsExample
  kind: ExampleKind
  selected: boolean
  onSelect: () => void
}) {
  const style = styleFor(example.id)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border-2 p-2.5 text-left transition-all",
        selected ? "border-primary bg-primary/[0.03] shadow-sm" : "border-border hover:border-primary/40",
      )}
    >
      <Thumb variant={thumbFor(example.id, kind)} accent={style.accent} className="h-24 w-full" />
      <div className="mt-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            {example.name}
            {example.badge ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{example.badge}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{example.description}</p>
          {kind === "plugin" ? (
            <p className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/80">
              {example.ui === "react" ? "React dashboard UI" : example.ui === "js" ? "Dashboard UI" : "Kit sections only"}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent",
          )}
        >
          <Check className="h-3 w-3" />
        </span>
      </div>
    </button>
  )
}
