import { AlertTriangle, Loader2, Palette, Puzzle, RefreshCw, SquarePen, SquareTerminal, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ACCENT_NAMES, ACCENTS, type AccentName } from "@/lib/project-colors"
import type { PluginManifest } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { WsProject } from "@/lib/ws-api"
import type { BusySet } from "./shared"

interface ProjectCardProps {
  workspaceMode: boolean
  current: WsProject | null
  manifest: PluginManifest
  activeAccent: AccentName
  busy: BusySet
  onSetColor: (name: AccentName) => void
  onOpenEditor: () => void
  onOpenTerminal: () => void
  onRestartPreview: () => void
  onRemove: () => void
  onDeleteFiles: () => void
}

export function ProjectCard({
  workspaceMode,
  current,
  manifest,
  activeAccent,
  busy,
  onSetColor,
  onOpenEditor,
  onOpenTerminal,
  onRestartPreview,
  onRemove,
  onDeleteFiles,
}: ProjectCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Puzzle className="h-4 w-4" />
          Project
        </CardTitle>
        <CardDescription>The workspace entry for {workspaceMode ? "the current project" : "this preview"}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", ACCENTS[activeAccent].tile)}>
            {current?.kind === "theme" ? <Palette className="h-5 w-5" /> : <Puzzle className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-bold">
              {current?.name ?? manifest.name}
              <Badge variant="outline" className="text-[9px] uppercase">
                {current?.kind ?? "plugin"}
              </Badge>
              {current?.missing ? (
                <span className="text-[10px] font-bold uppercase text-destructive">missing on disk</span>
              ) : null}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              /{current?.slug ?? manifest.slug} v{manifest.version}
              {current ? "" : " · standalone preview"}
            </p>
          </div>
        </div>

        {current ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Accent</span>
              {ACCENT_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  disabled={busy.anyBusy}
                  onClick={() => onSetColor(name)}
                  className={cn(
                    "h-5 w-5 rounded-full ring-offset-2 ring-offset-background transition-all hover:scale-110",
                    ACCENTS[name].swatch,
                    current.color === name && `ring-2 ${ACCENTS[name].ring}`,
                  )}
                />
              ))}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy.anyBusy || current.missing} onClick={onOpenEditor}>
                {busy.isBusy("open-editor") ? <Loader2 className="animate-spin" /> : <SquarePen />}
                Open in editor
              </Button>
              <Button variant="outline" size="sm" disabled={busy.anyBusy || current.missing} onClick={onOpenTerminal}>
                {busy.isBusy("open-terminal") ? <Loader2 className="animate-spin" /> : <SquareTerminal />}
                Terminal
              </Button>
              <Button variant="outline" size="sm" disabled={busy.anyBusy || current.missing} onClick={onRestartPreview}>
                {busy.isBusy("restart") ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Restart preview
              </Button>
            </div>
          </div>
        ) : null}

        {workspaceMode && current ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Danger zone — local
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={current.missing} onClick={onRemove}>
                Remove from workspace
              </Button>
              <span className="text-[11px] text-muted-foreground">unregisters it — files stay on disk</span>
              <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
              <Button variant="outline" size="sm" className="text-destructive" disabled={current.missing} onClick={onDeleteFiles}>
                <Trash2 />
                Delete files from disk
              </Button>
              <span className="text-[11px] text-muted-foreground">deletes the folder — typed-slug confirm</span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
