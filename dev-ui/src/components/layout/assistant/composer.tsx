import { ChevronRight, FileCode2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { urlPage } from "@/lib/project-url"
import { type AssistantTarget, useApp } from "@/state/app"
import type { AssistantConfig } from "./shared"

// ─── Composer ────────────────────────────────────────────────────────────────

export function Composer({
  config,
  busy,
  input,
  onInputChange,
  quick,
  target,
  onClearTarget,
  onSend,
}: {
  config: AssistantConfig | null
  busy: boolean
  input: string
  onInputChange: (value: string) => void
  quick: string[]
  target: AssistantTarget | null
  onClearTarget: () => void
  onSend: (prompt?: string) => void
}) {
  const { bootstrap } = useApp()
  return (
    <div className="shrink-0 border-t border-border p-3">
      {target ? (
        <div className="mb-2 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px]">
          <FileCode2 className="h-3 w-3 shrink-0 text-primary" />
          <span className="truncate">
            {target.file}
            {target.selection ? ` · lines ${target.selection.startLine}–${target.selection.endLine}` : ""}
          </span>
          {target.selection ? (
            <>
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => void onSend("Explain the selected code briefly.")}
              >
                Explain
              </button>
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => void onSend("Improve the selected code and propose the edit.")}
              >
                Improve
              </button>
            </>
          ) : null}
          <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={onClearTarget}>
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {quick.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-primary/40 hover:bg-muted hover:text-foreground disabled:opacity-50"
            disabled={busy || !config?.configured}
            onClick={() => void onSend(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          rows={1}
          className="min-h-[40px] text-[13px]"
          placeholder={config?.configured ? "Ask for a change…" : "Add an API key to enable the assistant"}
          value={input}
          disabled={!config?.configured || busy}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void onSend()
            }
          }}
        />
        <Button size="icon" disabled={busy || !config?.configured || !input.trim()} onClick={() => void onSend()} title="Send">
          <ChevronRight />
        </Button>
      </div>
      <p className="mt-1.5 text-[10.5px] text-muted-foreground">
        Enter to send · Shift+Enter for a new line. Edits wait for your approval; applied changes refresh open editors — undo from
        History.
      </p>
      {bootstrap ? (
        <p className="mt-0.5 text-[10.5px] text-muted-foreground">
          Context: <code className="text-[10px]">{bootstrap.manifest.slug}</code> · {urlPage()}
        </p>
      ) : null}
    </div>
  )
}
