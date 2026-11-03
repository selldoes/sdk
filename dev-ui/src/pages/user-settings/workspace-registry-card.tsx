import { AlertTriangle, FolderOpen, Loader2, Palette, Puzzle, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ACCENTS, accentFor } from "@/lib/project-colors"
import { cn, timeAgo } from "@/lib/utils"
import type { WsBootstrap, WsProject } from "@/lib/ws-api"
import { projectIconUrl } from "@/lib/ws-api"
import type { BusySet } from "./shared"

interface WorkspaceRegistryCardProps {
  workspace: WsBootstrap | null
  current: WsProject | null
  defaultDir: string
  onDefaultDirChange: (dir: string) => void
  busy: BusySet
  onChooseDir: () => void
  onSaveDir: () => void
  onOpenProject: (project: WsProject) => void
  onRemoveProject: (project: WsProject) => void
  onDeleteFiles: (project: WsProject) => void
  onClearRegistry: () => void
}

export function WorkspaceRegistryCard({
  workspace,
  current,
  defaultDir,
  onDefaultDirChange,
  busy,
  onChooseDir,
  onSaveDir,
  onOpenProject,
  onRemoveProject,
  onDeleteFiles,
  onClearRegistry,
}: WorkspaceRegistryCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="h-4 w-4" />
          Workspace registry
        </CardTitle>
        <CardDescription>
          The project list in <code className="font-mono">~/.selldoes/workspace.json</code> — per machine, not per folder.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="default-dir" className="text-xs">
            Default directory for new projects
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="default-dir"
              value={defaultDir}
              onChange={(event) => onDefaultDirChange(event.target.value)}
              placeholder="~/Documents/Selldoes"
              className="h-9 min-w-[240px] flex-1 font-mono text-xs"
            />
            <Button size="sm" className="h-9 shrink-0" disabled={busy.anyBusy} onClick={onChooseDir}>
              {busy.isBusy("choose-dir") ? <Loader2 className="animate-spin" /> : <FolderOpen />}
              Choose folder
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              disabled={busy.anyBusy || !defaultDir.trim()}
              onClick={onSaveDir}
            >
              {busy.isBusy("default-dir") ? <Loader2 className="animate-spin" /> : null}
              Save path
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            New projects land here unless you choose another folder while creating. Saved in{" "}
            <code className="font-mono">~/.selldoes/settings.json</code>.
          </p>
        </div>

        <div className="space-y-1.5">
          {workspace?.projects.map((project) => {
            const isCurrent = project.id === current?.id
            const iconSrc = projectIconUrl(project)
            return (
              <div key={project.id} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md",
                    !iconSrc && ACCENTS[accentFor(project)].tile,
                  )}
                >
                  {iconSrc ? (
                    <img src={iconSrc} alt="" className="h-full w-full object-cover" />
                  ) : project.kind === "theme" ? (
                    <Palette className="h-3.5 w-3.5" />
                  ) : (
                    <Puzzle className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-xs font-semibold">
                    {project.name}
                    {isCurrent ? (
                      <Badge variant="outline" className="shrink-0 text-[9px] text-primary">
                        current
                      </Badge>
                    ) : null}
                    {project.missing ? (
                      <span className="shrink-0 text-[9px] font-bold uppercase text-destructive">missing</span>
                    ) : null}
                  </p>
                  <p className="truncate text-[10.5px] text-muted-foreground">
                    /{project.slug} · {project.kind} · {project.path}
                    {project.lastOpenedAt ? ` · ${timeAgo(project.lastOpenedAt)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!isCurrent && !project.missing ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      disabled={busy.anyBusy}
                      title={project.kind === "theme" ? "Themes preview against a real store" : undefined}
                      onClick={() => onOpenProject(project)}
                    >
                      Open
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-muted-foreground"
                    disabled={busy.anyBusy}
                    onClick={() => onRemoveProject(project)}
                  >
                    Remove
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-destructive"
                    disabled={busy.anyBusy || project.missing}
                    onClick={() => onDeleteFiles(project)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-destructive">Clear the whole registry</p>
            <p className="text-[11px] text-muted-foreground">
              Unregisters every project — folders stay on disk. Running previews stop.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 text-destructive"
            disabled={busy.anyBusy || (workspace?.projects.length ?? 0) === 0}
            onClick={onClearRegistry}
          >
            Clear registry
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
