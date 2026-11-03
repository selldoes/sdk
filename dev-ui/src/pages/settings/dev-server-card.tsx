import { Check, Database, Loader2 } from "lucide-react"
import { SkeletonCard } from "@/components/skeletons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { DevConfigResponse } from "@/lib/types"
import type { BusySet } from "./shared"

interface DevServerCardProps {
  busy: BusySet
  config: DevConfigResponse | null
  configError: string | null
  storeId: string
  onStoreIdChange: (value: string) => void
  storeSlug: string
  onStoreSlugChange: (value: string) => void
  storeName: string
  onStoreNameChange: (value: string) => void
  port: string
  onPortChange: (value: string) => void
  host: string
  onHostChange: (value: string) => void
  emailDisabled: boolean
  onEmailDisabledChange: (value: boolean) => void
  mockReply: string
  onMockReplyChange: (value: string) => void
  sampleJobs: string
  onSampleJobsChange: (value: string) => void
  onSave: () => void
}

export function DevServerCard({
  busy,
  config,
  configError,
  storeId,
  onStoreIdChange,
  storeSlug,
  onStoreSlugChange,
  storeName,
  onStoreNameChange,
  port,
  onPortChange,
  host,
  onHostChange,
  emailDisabled,
  onEmailDisabledChange,
  mockReply,
  onMockReplyChange,
  sampleJobs,
  onSampleJobsChange,
  onSave,
}: DevServerCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" />
          Dev-server config
        </CardTitle>
        <CardDescription>
          Writes <code className="font-mono">selldoes.config.json</code> — the mock store identity, listen address and runtime
          mocks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {config === null && !configError ? (
          <SkeletonCard rows={5} className="border-0 bg-transparent p-0" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="cfg-store-id" className="text-xs">
                  Mock store id
                </Label>
                <Input
                  id="cfg-store-id"
                  value={storeId}
                  onChange={(event) => onStoreIdChange(event.target.value)}
                  className="h-9 font-mono text-xs"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-store-slug" className="text-xs">
                  Mock store slug
                </Label>
                <Input
                  id="cfg-store-slug"
                  value={storeSlug}
                  onChange={(event) => onStoreSlugChange(event.target.value)}
                  className="h-9 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-store-name" className="text-xs">
                  Mock store name
                </Label>
                <Input
                  id="cfg-store-name"
                  value={storeName}
                  onChange={(event) => onStoreNameChange(event.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-port" className="text-xs">
                  Port <span className="font-normal text-muted-foreground">(no --port)</span>
                </Label>
                <Input
                  id="cfg-port"
                  value={port}
                  onChange={(event) => onPortChange(event.target.value)}
                  className="h-9 font-mono text-xs"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-host" className="text-xs">
                  Host
                </Label>
                <Input
                  id="cfg-host"
                  value={host}
                  onChange={(event) => onHostChange(event.target.value)}
                  className="h-9 font-mono text-xs"
                />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch checked={emailDisabled} onCheckedChange={onEmailDisabledChange} id="cfg-email" />
                <Label htmlFor="cfg-email" className="cursor-pointer text-xs">
                  Disable email sending
                </Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-mock-reply" className="text-xs">
                Mock AI reply <span className="font-normal text-muted-foreground">(ctx.ai mock text)</span>
              </Label>
              <Input
                id="cfg-mock-reply"
                value={mockReply}
                onChange={(event) => onMockReplyChange(event.target.value)}
                placeholder="(mock AI reply — set ai.mockReply in selldoes.config.json)"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-sample-jobs" className="text-xs">
                Sample jobs <span className="font-normal text-muted-foreground">(JSON — prefill for the Jobs page)</span>
              </Label>
              <Textarea
                id="cfg-sample-jobs"
                value={sampleJobs}
                onChange={(event) => onSampleJobsChange(event.target.value)}
                placeholder={'{ "import-products": { "input": { "url": "https://…" }, "maxTicks": 10 } }'}
                rows={3}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy.anyBusy} onClick={onSave}>
                {busy.isBusy("server") ? <Loader2 className="animate-spin" /> : <Check />}
                Save dev-server config
              </Button>
              <span className="text-[10.5px] text-muted-foreground">
                Store identity, port and mocks apply on preview restart — the workspace restarts it for you.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
