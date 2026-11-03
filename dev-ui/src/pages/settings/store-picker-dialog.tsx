import { Loader2, Plug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { StoreVerifyResponse } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { BusySet } from "./shared"

interface StorePickerDialogProps {
  storePicker: StoreVerifyResponse | null
  usingStoredKey: boolean
  storePickId: number | null
  busy: BusySet
  onPick: (id: number) => void
  onClose: () => void
  onConnect: () => void
}

export function StorePickerDialog({
  storePicker,
  usingStoredKey,
  storePickId,
  busy,
  onPick,
  onClose,
  onConnect,
}: StorePickerDialogProps) {
  return (
    <Dialog
      open={storePicker !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Which store to connect?</DialogTitle>
          <DialogDescription>
            {usingStoredKey
              ? "Stores on your saved API key"
              : `Stores on the account at ${storePicker?.appUrl ?? "https://selldoes.com"}`}{" "}
            — <code className="font-mono">ctx.products</code> will proxy to the one you pick.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {storePicker?.stores.map((option, index) => (
            <button
              key={option.id}
              type="button"
              disabled={busy.anyBusy}
              onClick={() => onPick(option.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                storePickId === option.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "h-3.5 w-3.5 shrink-0 rounded-full border",
                  storePickId === option.id ? "border-primary bg-primary" : "border-muted-foreground/40",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">
                  {option.name || option.slug || `Store #${option.id}`}
                  {index === 0 ? <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(first)</span> : null}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                  {option.slug ? `${option.slug} · ` : ""}id {option.id}
                </span>
              </span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy.anyBusy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy.anyBusy || storePickId === null} onClick={onConnect}>
            {busy.isBusy("store-connect") ? <Loader2 className="animate-spin" /> : <Plug />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
