import * as React from "react"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { dev } from "@/lib/api"
import type { AssistantConfigResponse } from "@/lib/types"
import { useApp } from "@/state/app"

const PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", env: "OPENROUTER_API_KEY", placeholder: "anthropic/claude-sonnet-4" },
  { id: "openai", label: "OpenAI", env: "OPENAI_API_KEY", placeholder: "gpt-4o-mini" },
  { id: "anthropic", label: "Anthropic", env: "ANTHROPIC_API_KEY", placeholder: "claude-sonnet-4-5" },
  { id: "gemini", label: "Gemini", env: "GEMINI_API_KEY", placeholder: "gemini-2.5-flash" },
  { id: "deepinfra", label: "DeepInfra", env: "DEEPINFRA_API_KEY", placeholder: "deepseek-ai/DeepSeek-V4-Flash" },
  { id: "ollama", label: "Ollama (local, no key)", env: "OLLAMA_HOST", placeholder: "qwen3:8b" },
]

interface AssistantSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

export function AssistantSettingsDialog({ open, onOpenChange, onSaved }: AssistantSettingsDialogProps) {
  const { toast } = useApp()
  const [config, setConfig] = React.useState<AssistantConfigResponse | null>(null)
  const [provider, setProvider] = React.useState("")
  const [model, setModel] = React.useState("")
  const [apiKey, setApiKey] = React.useState("")
  const [baseUrl, setBaseUrl] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null)

  React.useEffect(() => {
    if (!open) return
    setTestResult(null)
    setApiKey("")
    void dev
      .config()
      .then((data) => {
        setConfig(data)
        setProvider(data.assistant.provider ?? "openrouter")
        setModel(data.assistant.model ?? "")
        setBaseUrl(data.assistant.baseUrl ?? "")
      })
      .catch(() => setConfig(null))
  }, [open])

  const save = async () => {
    setBusy(true)
    try {
      await dev.saveConfig({
        provider: provider || undefined,
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      })
      toast("Assistant settings saved — applied immediately", "success")
      onSaved?.()
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await dev.testAssistant()
      setTestResult({ ok: true, message: `Connected — ${result.provider ?? "provider"} · ${result.model ?? "model"}` })
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  const activeProvider = PROVIDERS.find((entry) => entry.id === provider)
  const envDetected = activeProvider ? Boolean(config?.env?.[activeProvider.env]) : false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dismissible>
        <DialogHeader>
          <DialogTitle className="text-base">AI assistant settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5 text-[12.5px]">
          <div className="space-y-1.5">
            <Label htmlFor="assistant-provider">Provider</Label>
            <select
              id="assistant-provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {PROVIDERS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            {activeProvider ? (
              <p className="text-[11px] text-muted-foreground">
                {envDetected
                  ? `${activeProvider.env} is detected in your environment — no key needed here.`
                  : `Set ${activeProvider.env} in your environment, or paste a key below (saved to ~/.selldoes/settings.json — applies to every project).`}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assistant-model">Model</Label>
            <Input id="assistant-model" value={model} placeholder={activeProvider?.placeholder ?? "model id"} onChange={(event) => setModel(event.target.value)} />
          </div>

          {provider !== "ollama" ? (
            <div className="space-y-1.5">
              <Label htmlFor="assistant-key">API key</Label>
              <Input
                id="assistant-key"
                type="password"
                value={apiKey}
                placeholder={config?.assistant.apiKey ? `saved (${config.assistant.apiKey}) — leave empty to keep` : "sk-…"}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="assistant-base">Base URL (advanced)</Label>
            <Input id="assistant-base" value={baseUrl} placeholder="default" onChange={(event) => setBaseUrl(event.target.value)} />
          </div>

          {testResult ? (
            <p className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[11.5px] ${testResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
              {testResult.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              {testResult.message}
            </p>
          ) : null}

          <p className="text-[11px] text-muted-foreground">
            Keys are read locally by the dev server and only sent to the provider you choose. They live in{" "}
            <code>~/.selldoes/settings.json</code> (User settings) — never inside a project folder, so nothing leaks into git. A project can
            pin a different model in Project settings.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : null}
            Test connection
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
