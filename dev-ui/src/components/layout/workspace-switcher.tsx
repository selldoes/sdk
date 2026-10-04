import * as React from "react"
import { Check, ChevronDown, Plus } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { resolveIcon } from "@/components/app-icon"
import { ACCENTS, accentFor } from "@/lib/project-colors"
import { cn, timeAgo } from "@/lib/utils"
import { confirmDiscardChanges } from "@/lib/dirty-guard"
import { useBusySet } from "@/lib/use-busy"
import { ws, projectIconUrl } from "@/lib/ws-api"
import type { WsProject } from "@/lib/ws-api"
import { useApp } from "@/state/app"

function ProjectGlyph({
  project,
  className,
}: {
  project: Pick<WsProject, "kind" | "slug" | "icon" | "color"> & { id?: string; iconUrl?: string | null }
  className?: string
}) {
  const src = projectIconUrl(project)
  if (src) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40", className)}>
        <img src={src} alt="" className="h-full w-full object-cover" />
      </span>
    )
  }
  const Icon = resolveIcon(project.icon ?? (project.kind === "theme" ? "palette" : "puzzle"))
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-md", ACCENTS[accentFor(project)].tile, className)}>
      <Icon className="h-4 w-4" />
    </span>
  )
}

/**
 * The workspace switcher in the sidebar — the dev shell's take on the
 * dashboard's store dropdown. Click a project to switch, "New workspace" opens
 * the create/import/pull dialog.
 */
export function WorkspaceSwitcher() {
  const { workspace, refreshWorkspace, refresh, toast, openWorkspaceDialog, noProject } = useApp()
  const busy = useBusySet()
  const current = workspace?.current ?? null
  const projects = workspace?.projects ?? []

  const run = async (key: string, action: () => Promise<void>) => {
    await busy.run(key, async () => {
      try {
        await action()
      } catch (cause) {
        toast(cause instanceof Error ? cause.message : String(cause), "error")
      }
    })
  }

  const select = (project: WsProject) => {
    if (project.id === current?.project.id) return
    if (project.kind === "theme") {
      // Themes render a real storefront and can't boot in the web shell.
      toast(`Themes preview against a real store — run \`selldoes dev --store <slug>\` in ${project.path}`, "default")
      return
    }
    if (!confirmDiscardChanges()) return
    return run(`select:${project.id}`, async () => {
      await ws.select(project.id)
      await Promise.all([refreshWorkspace(), refresh()])
      toast(`Switched to ${project.name}`, "success")
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy.anyBusy}
          title={
            current
              ? `${current.project.path}${workspace?.sdk.dev ? " · SDK-dev mode" : ""}`
              : "Create, import or pull a project"
          }
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 data-[state=open]:border-primary/40 data-[state=open]:bg-muted/50 disabled:opacity-70",
            noProject && "border-dashed",
          )}
        >
          <ProjectGlyph project={current?.project ?? { kind: "plugin", slug: "none" }} className="h-8 w-8" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold">{current ? current.project.name : "No workspace yet"}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {current ? `/${current.project.slug} · ${current.project.kind} · local` : "create or import one"}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Your workspaces
        </DropdownMenuLabel>
        {projects.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No projects yet — create one below.</p>
        ) : (
          projects.map((project) => {
            const isCurrent = project.id === current?.project.id
            return (
              <DropdownMenuItem
                key={project.id}
                disabled={busy.anyBusy || project.missing}
                onSelect={() => void select(project)}
                className="gap-2.5 px-2 py-2"
              >
                <ProjectGlyph project={project} className="h-7 w-7" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold">{project.name}</span>
                    {project.missing ? <span className="shrink-0 text-[9px] font-bold uppercase text-destructive">missing</span> : null}
                  </span>
                  <span className="block truncate text-[10px] font-normal text-muted-foreground">
                    /{project.slug} · {project.kind}
                    {project.lastOpenedAt ? ` · ${timeAgo(project.lastOpenedAt)}` : ""}
                  </span>
                </span>
                {isCurrent ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
              </DropdownMenuItem>
            )
          })
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => openWorkspaceDialog("new")}
          className="gap-2.5 text-primary focus:text-primary"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-primary/40">
            <Plus className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs font-semibold">New workspace</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
