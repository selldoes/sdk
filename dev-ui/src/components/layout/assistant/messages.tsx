import { AlertCircle } from "lucide-react"
import { applyFeedback, type ChatItem } from "./chat"
import { EditCard } from "./edit-card"
import { Markdownish } from "./markdown"

// ─── Chat transcript ─────────────────────────────────────────────────────────

export function ChatMessages({ items, onSystem }: { items: ChatItem[]; onSystem: (message: string) => void }) {
  return (
    <>
      {items.map((item) => {
        if (item.kind === "edits")
          return (
            <EditCard key={item.id} item={item} onApplied={(result) => onSystem(applyFeedback(result))} onSystem={onSystem} />
          )
        if (item.kind === "user") {
          return (
            <div
              key={item.id}
              className="ml-auto max-w-[92%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-[12.5px] text-primary-foreground"
            >
              {item.content}
            </div>
          )
        }
        if (item.kind === "assistant") {
          return (
            <div key={item.id} className="max-w-[95%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-[12.5px]">
              <Markdownish text={item.content} />
            </div>
          )
        }
        if (item.kind === "error") {
          return (
            <div
              key={item.id}
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {item.content}
            </div>
          )
        }
        return (
          <p
            key={item.id}
            className="whitespace-pre-wrap rounded-lg border border-dashed border-border px-3 py-2 text-center text-[11px] text-muted-foreground"
          >
            {item.content}
          </p>
        )
      })}
    </>
  )
}
