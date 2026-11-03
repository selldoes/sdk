import { KeyRound, Loader2, LogOut, Palette } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { WsThemeStatus } from "@/lib/ws-api"
import type { BusySet } from "./shared"

interface ThemeLaneCardProps {
  theme: WsThemeStatus | null
  busy: BusySet
  themeKey: string
  onThemeKeyChange: (key: string) => void
  themeBase: string
  onThemeBaseChange: (base: string) => void
  themeStore: string
  onThemeStoreChange: (store: string) => void
  onConnect: () => void
  onDisconnect: () => void
}

export function ThemeLaneCard({
  theme,
  busy,
  themeKey,
  onThemeKeyChange,
  themeBase,
  onThemeBaseChange,
  themeStore,
  onThemeStoreChange,
  onConnect,
  onDisconnect,
}: ThemeLaneCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="h-4 w-4" />
          Theme lane — merchant API key
        </CardTitle>
        <CardDescription>
          The API key theme commands (`selldoes dev --store`, `apply`, `publish`) authenticate with — same store as `selldoes
          login --api-key`.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {theme?.connected ? (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <KeyRound className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs font-semibold">{theme.apiKeyMasked}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {theme.baseUrl ?? "—"}
                  {theme.defaultStoreSlug ? ` · store /${theme.defaultStoreSlug}` : ""}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                disabled={busy.anyBusy}
                onClick={onDisconnect}
              >
                {busy.isBusy("theme-disconnect") ? <Loader2 className="animate-spin" /> : <LogOut />}
                Disconnect
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The raw key is never shown after saving. To rotate it, disconnect and connect again with the new key.
            </p>
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={themeKey}
                onChange={(event) => onThemeKeyChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && themeKey.trim()) onConnect()
                }}
                placeholder="sk_… (Dashboard → Settings → API Keys)"
                className="h-9 font-mono text-xs"
              />
              <Input
                value={themeBase}
                onChange={(event) => onThemeBaseChange(event.target.value)}
                placeholder="https://selldoes.com"
                className="h-9 sm:w-52"
              />
              <Input
                value={themeStore}
                onChange={(event) => onThemeStoreChange(event.target.value)}
                placeholder="store slug"
                className="h-9 sm:w-36"
              />
              <Button size="sm" className="h-9 shrink-0" disabled={busy.anyBusy || !themeKey.trim()} onClick={onConnect}>
                {busy.isBusy("theme-connect") ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Connect
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Verified against <code className="font-mono">/api/templates/me</code> before saving — the key lands in{" "}
              <code className="font-mono">~/.selldoes.json</code> next to your developer token.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
