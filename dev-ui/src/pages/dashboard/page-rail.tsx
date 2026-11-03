import { resolveIcon } from "@/components/app-icon"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { ResolvedPage } from "./types"

/** The page rail — full-bleed hides it below lg (the toolbar's page picker takes over). */
export function PageRail({
  groups,
  activePath,
  fullBleed,
  onSelect,
}: {
  groups: { group: string | null; pages: ResolvedPage[] }[]
  activePath?: string
  fullBleed: boolean
  onSelect: (path: string) => void
}) {
  return (
    <Card className={cn("min-h-0", fullBleed ? "hidden h-full flex-col lg:flex" : "h-fit")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Sidebar pages</CardTitle>
        <CardDescription className="text-[11.5px]">
          From <code>dashboardPages</code> in plugin.json.
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("space-y-3", fullBleed && "min-h-0 flex-1 overflow-y-auto")}>
        {groups.map((bucket) => (
          <div key={bucket.group ?? "__ungrouped__"} className="space-y-1">
            {bucket.group ? (
              <p className="px-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{bucket.group}</p>
            ) : null}
            {bucket.pages.map((page) => {
              const Icon = resolveIcon(page.icon)
              const isActive = page.path === activePath
              return (
                <button
                  key={page.path}
                  type="button"
                  onClick={() => onSelect(page.path)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12.5px] transition-colors",
                    isActive ? "border-primary bg-primary/5 font-semibold" : "border-border hover:bg-muted",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{page.label}</span>
                  <code className="shrink-0 text-[9.5px] text-muted-foreground">
                    {page.entry ? page.entry.replace(/^ui\//, "") : "kit"}
                  </code>
                </button>
              )
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
