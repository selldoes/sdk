import * as React from "react"
import { Radio, RefreshCw } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHead } from "@/components/shared"
import { dev } from "@/lib/api"
import { timeAgo } from "@/lib/utils"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

interface EventEntry {
  id: number
  channel: string
  event: string
  data: unknown
  at: string
}

export function RealtimePage() {
  const { toast, setAssistantPage } = useApp()
  useVisit("realtime")
  const [events, setEvents] = React.useState<EventEntry[] | null>(null)

  const load = React.useCallback(async () => {
    try {
      const data = await dev.events()
      setEvents(data.events)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }, [toast])

  React.useEffect(() => {
    setAssistantPage({
      context: "The developer is inspecting realtime events published through ctx.realtime.publish().",
      quick: ["Explain realtime events", "Add a realtime notification to my plugin"],
    })
  }, [setAssistantPage])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <PageHead
        title="Realtime"
        description={
          <>
            Events published through <code>ctx.realtime.publish()</code> in this session. Production pushes them to subscribed clients;
            here you can inspect the stream.
          </>
        }
      />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw />
          Refresh
        </Button>
      </div>

      {events && events.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {[...events].reverse().map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                  <Radio className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px]">
                      <code>{entry.channel}</code> → <strong>{entry.event}</strong>
                    </p>
                    <p className="text-[10.5px] text-muted-foreground">{timeAgo(entry.at)}</p>
                    {entry.data !== undefined ? (
                      <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border bg-muted p-2.5 text-[11px]">
                        {JSON.stringify(entry.data, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : events ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Radio className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm font-semibold">No events yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Publish with <code>ctx.realtime.publish(channel, event, data)</code> (needs the <code>realtime:publish</code> permission).
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
