import { Wrench } from "lucide-react"
import { permissionInfo, RISK_STYLES, sortByRisk } from "@/lib/permissions"
import { cn } from "@/lib/utils"

/**
 * The permission list shown in the dashboard host page and the install dialog,
 * copying the platform's component so the preview matches production.
 */
export function PermissionList({
  permissions,
  allowedTables = [],
  compact = false,
}: {
  permissions: string[]
  allowedTables?: string[]
  compact?: boolean
}) {
  if (permissions.length === 0 && allowedTables.length === 0) {
    return <p className="text-xs text-muted-foreground">No special permissions requested.</p>
  }

  return (
    <div className="space-y-2">
      {sortByRisk(permissions).map((permission) => {
        const info = permissionInfo(permission)
        const styles = RISK_STYLES[info.risk]
        return (
          <div key={permission} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2", styles.badge)}>
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", styles.dot)} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{info.label}</span>
                <code className="text-[10px] opacity-70">{permission}</code>
                <span className="text-[10px] uppercase tracking-wide opacity-70">{info.risk} risk</span>
              </div>
              {!compact && <p className="mt-0.5 text-xs opacity-80">{info.description}</p>}
            </div>
          </div>
        )
      })}

      {allowedTables.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">
            <Wrench className="mr-1 inline h-3 w-3" />
            Database tables it may touch
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {allowedTables.map((table) => (
              <code key={table} className="rounded bg-background px-1.5 py-0.5 text-[11px]">
                {table}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
