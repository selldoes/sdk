import { Loader2, RefreshCw, Settings, Sparkles } from "lucide-react"
import type * as React from "react"
import { Button } from "@/components/ui/button"
import { useApp } from "@/state/app"

export function SystemIntro() {
  return (
    <p className="border-b border-dashed border-border pb-3 text-center text-[11px] text-muted-foreground">
      I can read your plugin, explain errors and propose file edits — you review before anything is written.
    </p>
  )
}

export function SetupCard({
  checking,
  onCheck,
  onOpenSettings,
}: {
  checking: boolean
  onCheck: () => void
  onOpenSettings: () => void
}) {
  const { toast } = useApp()
  return (
    <div className="space-y-3 text-[12px]">
      <Calloutish>
        <strong>One-time setup.</strong> The assistant calls an AI provider directly from your machine. Configure it here — no
        restart needed.
      </Calloutish>
      <div className="flex gap-2">
        <Button size="sm" onClick={onOpenSettings}>
          <Settings />
          Open settings
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={checking}
          onClick={() => {
            onCheck()
            toast("Re-checking provider…")
          }}
        >
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Check again
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Environment variables work too: <code>OPENROUTER_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>,{" "}
        <code>GEMINI_API_KEY</code>, <code>OPENAI_API_KEY</code>, <code>DEEPINFRA_API_KEY</code> — or <code>ollama</code> for
        local models, no key needed.
      </p>
    </div>
  )
}

function Calloutish({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900">
      <p className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{children}</span>
      </p>
    </div>
  )
}
