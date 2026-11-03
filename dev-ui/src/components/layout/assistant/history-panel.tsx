import { History, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SnapshotInfo } from "@/lib/types"

// ─── History (snapshots) ─────────────────────────────────────────────────────

export function HistoryPanel({
  snapshots,
  loading,
  onRestore,
  onRefresh,
}: {
  snapshots: SnapshotInfo[]
  loading: boolean
  onRestore: (snapshot: SnapshotInfo) => void
  onRefresh: () => void
}) {
  return (
    <div className="space-y-2 pb-4">
      <div className="flex items-start gap-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Every save and AI apply is snapshotted. Restore any point — open editor tabs refresh themselves.
        </p>
        <Button variant="ghost" size="icon" className="ml-auto h-6 w-6 shrink-0" title="Refresh" onClick={onRefresh}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history…
        </p>
      ) : snapshots.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
          No snapshots yet — edit a file or ask the AI for a change.
        </p>
      ) : (
        snapshots.map((snapshot) => (
          <div key={snapshot.name} className="rounded-lg border border-border bg-card p-2.5">
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="truncate text-[12px] font-semibold">{snapshot.reason ?? snapshot.name}</p>
              <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => onRestore(snapshot)}>
                Restore
              </Button>
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              {snapshot.at ? new Date(snapshot.at).toLocaleString() : snapshot.name}
              {snapshot.files?.length
                ? ` · ${snapshot.files
                    .map((file) => file.path)
                    .join(", ")
                    .slice(0, 80)}`
                : ""}
            </p>
          </div>
        ))
      )}
    </div>
  )
}
