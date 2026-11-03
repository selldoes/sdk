import { Check, Loader2, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"
import { SkeletonCard } from "@/components/skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { DevConfigResponse } from "@/lib/types"
import type { BusySet } from "./shared"

interface AssistantModelCardProps {
  busy: BusySet
  config: DevConfigResponse | null
  configError: string | null
  modelOverride: string
  onModelOverrideChange: (value: string) => void
  onSaveOverride: (value: string | null) => void
}

export function AssistantModelCard({
  busy,
  config,
  configError,
  modelOverride,
  onModelOverrideChange,
  onSaveOverride,
}: AssistantModelCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          Assistant model override
        </CardTitle>
        <CardDescription>
          This project pins its own assistant model — the provider, API key and base URL stay in{" "}
          <Link to="/user-settings" className="text-primary hover:underline">
            User settings
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {config === null && !configError ? (
          <SkeletonCard rows={2} className="border-0 bg-transparent p-0" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>
                Effective: <strong className="font-semibold text-foreground">{config?.assistant.provider ?? "openrouter"}</strong>{" "}
                · <code className="font-mono">{config?.assistant.model ?? "default"}</code>
              </span>
              {config?.assistant.apiKeySet ? (
                <Badge variant="outline" className="text-[9px]">
                  key saved (user)
                </Badge>
              ) : null}
              {config?.assistant.projectModel ? (
                <Badge variant="outline" className="text-[9px] text-primary">
                  project override
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={modelOverride}
                onChange={(event) => onModelOverrideChange(event.target.value)}
                placeholder={config?.assistant.model ?? "model id — blank uses your User settings model"}
                className="h-9 w-72 font-mono text-xs"
                disabled={busy.anyBusy}
              />
              <Button size="sm" disabled={busy.anyBusy} onClick={() => onSaveOverride(modelOverride.trim() || null)}>
                {busy.isBusy("model-override") ? <Loader2 className="animate-spin" /> : <Check />}
                Save override
              </Button>
              {config?.assistant.projectModel ? (
                <Button size="sm" variant="outline" disabled={busy.anyBusy} onClick={() => onSaveOverride(null)}>
                  Clear
                </Button>
              ) : null}
            </div>
            <p className="text-[10.5px] leading-snug text-muted-foreground">
              Saved as <code className="font-mono">assistant.model</code> in this project's selldoes.config.json — safe to commit,
              no credentials involved.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
