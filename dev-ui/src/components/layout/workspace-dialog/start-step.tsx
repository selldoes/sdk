import { Check, Puzzle, Sparkles, Wand2 } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { STARTERS, Thumb, thumbFor } from "./shared"

// ─── Step 1 · Start ──────────────────────────────────────────────────────────

export function StepStart({
  approach,
  setApproach,
  exampleId,
  onChooseStarter,
  prompt,
  setPrompt,
  onOpenImport,
  onOpenPull,
}: {
  approach: "template" | "ai"
  setApproach: (approach: "template" | "ai") => void
  exampleId: string
  onChooseStarter: (starter: (typeof STARTERS)[number]) => void
  prompt: string
  setPrompt: (prompt: string) => void
  onOpenImport: () => void
  onOpenPull: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            {
              id: "template",
              title: "Start from an example",
              desc: "Pick a complete, working project and adjust everything next.",
              icon: Puzzle,
            },
            {
              id: "ai",
              title: "Describe it, AI builds it",
              desc: "Write what the plugin should do and generate the files.",
              icon: Sparkles,
            },
          ] as const
        ).map(({ id, title, desc, icon: Icon }) => {
          const selected = approach === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setApproach(id)}
              className={cn(
                "rounded-xl border-2 p-3 text-left transition-all",
                selected ? "border-primary bg-primary/[0.03]" : "border-border hover:border-primary/40",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <p className="mt-2 text-xs font-semibold">{title}</p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{desc}</p>
            </button>
          )
        })}
      </div>

      {approach === "template" ? (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">What are you building?</p>
          <div className="grid grid-cols-2 gap-3">
            {STARTERS.map((starter) => {
              const selected = starter.id === exampleId
              return (
                <button
                  key={starter.id}
                  type="button"
                  onClick={() => onChooseStarter(starter)}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border-2 p-2.5 text-left transition-all",
                    selected ? "border-primary bg-primary/[0.03] shadow-sm" : "border-border hover:border-primary/40",
                  )}
                >
                  <Thumb variant={thumbFor(starter.id, starter.kind)} accent={starter.accent} className="h-24 w-full" />
                  <div className="mt-2.5 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                        {starter.name}
                        {starter.badge ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">
                            {starter.badge}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{starter.desc}</p>
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
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Wand2 className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-xs font-semibold">Describe your plugin</p>
              <p className="text-[10.5px] text-muted-foreground">
                The AI scaffolds a full project — you name it in the next step.
              </p>
            </div>
          </div>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            autoFocus
            placeholder={'e.g. "a plugin that shows a live visitor counter on product pages"'}
            className="text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              "a plugin that shows a live visitor counter on product pages",
              "reward customers with points on every order",
              "a scraper that imports products from a supplier feed",
            ].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setPrompt(sample)}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {sample}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5">
        <span className="text-[10.5px] text-muted-foreground">Already have a project?</span>
        <button type="button" onClick={onOpenImport} className="text-[11px] font-semibold text-primary hover:underline">
          Import a folder
        </button>
        <span className="text-muted-foreground/50">·</span>
        <button type="button" onClick={onOpenPull} className="text-[11px] font-semibold text-primary hover:underline">
          Pull from your account
        </button>
      </div>
    </div>
  )
}
