import { Loader2, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { BumpMode } from "@/lib/types"
import { cn } from "@/lib/utils"
import { type BusySet, EDITOR_OPTIONS } from "./shared"

interface PreferencesCardProps {
  busy: BusySet
  editorChoice: string
  onEditorChoiceChange: (editor: string) => void
  editorCustom: string
  onEditorCustomChange: (editor: string) => void
  releaseBump: BumpMode | null
  onSaveEditor: () => void
  onSaveBump: (mode: BumpMode) => void
}

export function PreferencesCard({
  busy,
  editorChoice,
  onEditorChoiceChange,
  editorCustom,
  onEditorCustomChange,
  releaseBump,
  onSaveEditor,
  onSaveBump,
}: PreferencesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4" />
          Preferences
        </CardTitle>
        <CardDescription>
          Defaults for this machine — `selldoes open` and the Ship page fall back to these when a project has no override.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="user-editor" className="text-xs">
            Editor for <code className="font-mono">selldoes open</code>
          </Label>
          <div className="flex flex-wrap gap-2">
            <select
              id="user-editor"
              value={editorChoice}
              onChange={(event) => onEditorChoiceChange(event.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {EDITOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {editorChoice === "custom" ? (
              <Input
                value={editorCustom}
                onChange={(event) => onEditorCustomChange(event.target.value)}
                placeholder="command, e.g. idea or sublime"
                className="h-9 w-56 font-mono text-xs"
              />
            ) : null}
            <Button size="sm" variant="outline" className="h-9" disabled={busy.anyBusy} onClick={onSaveEditor}>
              {busy.isBusy("editor") ? <Loader2 className="animate-spin" /> : null}
              Save editor
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The <code className="font-mono">SELDOES_EDITOR</code> environment variable still wins when set.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">
            Default release bump <span className="font-normal text-muted-foreground">(Ship page fallback)</span>
          </Label>
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
                onClick={() => onSaveBump(entry.value)}
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
            A project can override this in Project settings → Releases; when it doesn't, the Ship page pre-checks with this mode.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
