import { Blocks, Braces, Sparkles, Undo2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function SectionBuilderHeader({
  pageLabel,
  dirty,
  tab,
  onSwitchTab,
  onUndo,
  onAskAi,
  onClose,
}: {
  pageLabel: string
  dirty: boolean
  tab: "components" | "json"
  onSwitchTab: (tab: "components" | "json") => void
  onUndo: () => void
  onAskAi: () => void
  onClose: () => void
}) {
  return (
    <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b px-5 py-3">
      <div className="min-w-0">
        <DialogTitle className="flex items-center gap-2 text-base">
          <Blocks className="h-4 w-4" />
          Components — {pageLabel}
          {dirty ? <Badge className="border-0 bg-amber-100 text-amber-700">unsaved</Badge> : null}
        </DialogTitle>
        <DialogDescription className="text-[11.5px]">
          Palette on the left, live preview in the middle, settings on the right — saved to <code>dashboardPages[].sections</code>
          .
        </DialogDescription>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" variant={tab === "components" ? "secondary" : "ghost"} onClick={() => onSwitchTab("components")}>
          <Blocks />
          Components
        </Button>
        <Button size="sm" variant={tab === "json" ? "secondary" : "ghost"} onClick={() => onSwitchTab("json")}>
          <Braces />
          JSON
        </Button>
        <Button size="sm" variant="outline" onClick={onUndo} title="Restore plugin.json from the last save">
          <Undo2 />
          Undo
        </Button>
        <Button size="sm" variant="outline" onClick={onAskAi}>
          <Sparkles />
          Ask AI
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
    </DialogHeader>
  )
}
