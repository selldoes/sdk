import { Database, History, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface DangerZoneCardProps {
  onResetData: () => void
  onClearUndo: () => void
}

export function DangerZoneCard({ onResetData, onClearUndo }: DangerZoneCardProps) {
  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <Trash2 className="h-4 w-4" />
          Danger zone
        </CardTitle>
        <CardDescription>Local preview data for this project. None of this touches a published plugin.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
          <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Reset mock store data</p>
            <p className="text-[11px] text-muted-foreground">
              Deletes <code className="font-mono">.selldoes-dev/db.json</code> and reseeds the demo tables — see the{" "}
              <Link to="/data" className="text-primary hover:underline">
                Store data
              </Link>{" "}
              page.
            </p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 text-destructive" onClick={onResetData}>
            Reset data
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
          <History className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Clear undo history</p>
            <p className="text-[11px] text-muted-foreground">
              Deletes every snapshot under <code className="font-mono">.selldoes-dev/undo/</code> — History can no longer restore
              past saves.
            </p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 text-destructive" onClick={onClearUndo}>
            Clear snapshots
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
