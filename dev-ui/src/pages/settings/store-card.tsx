import { Loader2, Plug, Store, Unplug } from "lucide-react"
import { SkeletonCard } from "@/components/skeletons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { StoreStatusResponse } from "@/lib/types"
import type { BusySet } from "./shared"

interface StoreCardProps {
  busy: BusySet
  store: StoreStatusResponse | null
  storeError: string | null
  liveApiKey: string
  onLiveApiKeyChange: (value: string) => void
  onOpenStorePicker: (usingStoredKey: boolean) => void
  onDisconnect: () => void
}

export function StoreCard({
  busy,
  store,
  storeError,
  liveApiKey,
  onLiveApiKeyChange,
  onOpenStorePicker,
  onDisconnect,
}: StoreCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" />
          Store
        </CardTitle>
        <CardDescription>
          Connect a real store to test against live catalog data — no publish needed. When connected,{" "}
          <code className="font-mono">ctx.products</code> (and image re-hosting) proxy to the store through the merchant API;
          everything else (plugin tables, AI, email) stays on the local mock.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {store === null ? (
          storeError === null ? (
            <SkeletonCard rows={2} className="border-0 bg-transparent p-0" />
          ) : (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-600">The running dev server does not know /__dev/store</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Restart <code className="font-mono">selldoes dev</code> (and the workspace shell if you use it) so the preview
                picks up the SDK update — the Store card talks to a dev server that is older than the UI.
              </p>
            </div>
          )
        ) : store.active ? (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold">
                Live — {store.connection?.storeSlug || store.connection?.storeId} @ {store.connection?.appUrl}
              </span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" disabled={busy.anyBusy} onClick={() => onOpenStorePicker(true)}>
                  {busy.isBusy("store-verify") ? <Loader2 className="animate-spin" /> : <Store />}
                  Change store
                </Button>
                <Button size="sm" variant="outline" disabled={busy.anyBusy} onClick={onDisconnect}>
                  {busy.isBusy("store-disconnect") ? <Loader2 className="animate-spin" /> : <Unplug />}
                  Disconnect
                </Button>
              </span>
            </div>
            <p className="text-[10.5px] leading-snug text-muted-foreground">
              Jobs and API routes you run now read and write the real store catalog. Disconnect to go back to the mock.
            </p>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="live-api-key" className="text-xs">
                Merchant API key
              </Label>
              <Input
                id="live-api-key"
                type="password"
                value={liveApiKey}
                onChange={(event) => onLiveApiKeyChange(event.target.value)}
                placeholder={store.apiKeySet ? (store.apiKeyMasked ?? "sk_…") : "sk_… (Dashboard → Settings → API Keys)"}
                className="h-9 font-mono text-xs"
                disabled={busy.anyBusy}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy.anyBusy || !liveApiKey.trim()} onClick={() => onOpenStorePicker(false)}>
                {busy.isBusy("store-verify") ? <Loader2 className="animate-spin" /> : <Plug />}
                Connect store
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
