import { Check, Loader2, Rocket } from "lucide-react"
import { SkeletonCard } from "@/components/skeletons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import type { BumpMode, DevConfigResponse } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { BusySet } from "./shared"

interface ReleasesCardProps {
  busy: BusySet
  config: DevConfigResponse | null
  configError: string | null
  releaseBump: BumpMode
  onReleaseBumpChange: (mode: BumpMode) => void
  onSave: () => void
}

export function ReleasesCard({ busy, config, configError, releaseBump, onReleaseBumpChange, onSave }: ReleasesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="h-4 w-4" />
          Releases
        </CardTitle>
        <CardDescription>
          Default version bump the Ship page proposes when you publish. Saved per project in{" "}
          <code className="font-mono">selldoes.config.json</code> — overrides the User settings fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {config === null && !configError ? (
          <SkeletonCard rows={2} className="border-0 bg-transparent p-0" />
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Default bump</Label>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { value: "patch", label: "Patch", hint: "0.4.1 → 0.4.2" },
                    { value: "minor", label: "Minor", hint: "0.4.1 → 0.5.0" },
                    { value: "major", label: "Major", hint: "0.4.1 → 1.0.0" },
                  ] as const
                ).map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    disabled={busy.anyBusy}
                    onClick={() => onReleaseBumpChange(entry.value)}
                    title={entry.hint}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                      releaseBump === entry.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] leading-snug text-muted-foreground">
                The Ship page pre-checks “Bump version before publish” with this mode; you can still change it per release. The
                platform rejects re-publishing a version that already exists.
              </p>
            </div>
            <Button size="sm" disabled={busy.anyBusy} onClick={onSave}>
              {busy.isBusy("release") ? <Loader2 className="animate-spin" /> : <Check />}
              Save
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
