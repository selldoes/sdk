import { Loader2, Sparkles } from "lucide-react"
import { Callout } from "@/components/shared"
import { SkeletonCard } from "@/components/skeletons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DevConfigResponse, UserSettingsResponse } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { BusySet } from "./shared"

const ASSISTANT_PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", placeholder: "anthropic/claude-sonnet-4", env: "OPENROUTER_API_KEY" },
  { id: "openai", label: "OpenAI", placeholder: "gpt-4o-mini", env: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", placeholder: "claude-sonnet-4-5", env: "ANTHROPIC_API_KEY" },
  { id: "gemini", label: "Gemini", placeholder: "gemini-2.5-flash", env: "GEMINI_API_KEY" },
  { id: "deepinfra", label: "DeepInfra", placeholder: "deepseek-ai/DeepSeek-V4-Flash", env: "DEEPINFRA_API_KEY" },
  { id: "ollama", label: "Ollama (local, no key)", placeholder: "qwen3:8b", env: "OLLAMA_HOST" },
]

interface AssistantCardProps {
  settingsError: string | null
  userSettings: UserSettingsResponse | null
  config: DevConfigResponse | null
  busy: BusySet
  provider: string
  onProviderChange: (provider: string) => void
  model: string
  onModelChange: (model: string) => void
  apiKey: string
  onApiKeyChange: (apiKey: string) => void
  baseUrl: string
  onBaseUrlChange: (baseUrl: string) => void
  testResult: { ok: boolean; message: string } | null
  onSave: () => void
  onClearKey: () => void
  onTest: () => void
}

export function AssistantCard({
  settingsError,
  userSettings,
  config,
  busy,
  provider,
  onProviderChange,
  model,
  onModelChange,
  apiKey,
  onApiKeyChange,
  baseUrl,
  onBaseUrlChange,
  testResult,
  onSave,
  onClearKey,
  onTest,
}: AssistantCardProps) {
  const activeProvider = ASSISTANT_PROVIDERS.find((entry) => entry.id === provider)
  const envDetected = activeProvider ? Boolean(config?.env?.[activeProvider.env]) : false

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          Assistant (AI)
        </CardTitle>
        <CardDescription>
          Provider for the assistant panel, Describe-AI scaffolds and <code className="font-mono">selldoes ask</code>. Projects
          may pin a different model in Project settings — the key always stays here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {settingsError ? (
          <Callout kind="warn">
            <p className="font-semibold">Could not load the user settings</p>
            <p className="mt-0.5 text-[12px]">{settingsError}</p>
          </Callout>
        ) : null}
        {userSettings === null && !settingsError ? (
          <SkeletonCard rows={4} className="border-0 bg-transparent p-0" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Provider</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ASSISTANT_PROVIDERS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={busy.anyBusy}
                      onClick={() => onProviderChange(entry.id)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
                        provider === entry.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-assistant-model" className="text-xs">
                  Model <span className="font-normal text-muted-foreground">(default for all projects)</span>
                </Label>
                <Input
                  id="user-assistant-model"
                  value={model}
                  onChange={(event) => onModelChange(event.target.value)}
                  placeholder={activeProvider?.placeholder ?? "model id"}
                  className="h-9 font-mono text-xs"
                  disabled={busy.anyBusy}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-assistant-key" className="text-xs">
                  API key{" "}
                  {userSettings?.assistant.apiKeySet ? (
                    <span className="text-emerald-600">· saved ({userSettings.assistant.apiKeyMasked})</span>
                  ) : (
                    <span className="font-normal text-muted-foreground">· none saved</span>
                  )}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="user-assistant-key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => onApiKeyChange(event.target.value)}
                    placeholder={userSettings?.assistant.apiKeySet ? "saved — leave blank to keep" : "sk-…"}
                    className="h-9 min-w-0 flex-1 font-mono text-xs"
                    disabled={busy.anyBusy || provider === "ollama"}
                  />
                  {userSettings?.assistant.apiKeySet ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 text-destructive"
                      disabled={busy.anyBusy}
                      onClick={onClearKey}
                    >
                      {busy.isBusy("assistant-clear-key") ? <Loader2 className="animate-spin" /> : null}
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-assistant-base" className="text-xs">
                  Base URL <span className="font-normal text-muted-foreground">(optional — proxies, gateways)</span>
                </Label>
                <Input
                  id="user-assistant-base"
                  value={baseUrl}
                  onChange={(event) => onBaseUrlChange(event.target.value)}
                  placeholder="https://…"
                  className="h-9 font-mono text-xs"
                  disabled={busy.anyBusy}
                />
              </div>
            </div>
            {activeProvider ? (
              <p className="text-[11px] text-muted-foreground">
                {envDetected
                  ? `${activeProvider.label} is detected via an environment variable — no key needed here.`
                  : `Set the provider's environment variable, or paste a key above. Keys are read locally and only sent to the provider you choose.`}
              </p>
            ) : null}
            {testResult ? (
              <Callout kind={testResult.ok ? "success" : "danger"}>
                <p className="text-[12.5px]">{testResult.message}</p>
              </Callout>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy.anyBusy} onClick={onSave}>
                {busy.isBusy("assistant") ? <Loader2 className="animate-spin" /> : null}
                Save
              </Button>
              <Button size="sm" variant="outline" disabled={busy.anyBusy} onClick={onTest}>
                {busy.isBusy("assistant-test") ? <Loader2 className="animate-spin" /> : null}
                Test connection
              </Button>
              {config?.env ? (
                <span className="text-[10.5px] text-muted-foreground">
                  env keys:{" "}
                  {Object.entries(config.env)
                    .filter(([, present]) => present)
                    .map(([key]) => key)
                    .join(", ") || "none set"}
                </span>
              ) : null}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {userSettings?.file ?? "~/.selldoes/settings.json"}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
