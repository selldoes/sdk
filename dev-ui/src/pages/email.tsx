import * as React from "react"
import { Mail, RefreshCw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHead } from "@/components/shared"
import { dev } from "@/lib/api"
import { timeAgo } from "@/lib/utils"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

interface OutboxEntry {
  to: string
  subject: string
  text?: string | null
  html?: string | null
  at: string
}

export function EmailPage() {
  const { toast, setAssistantPage } = useApp()
  useVisit("email")
  const [outbox, setOutbox] = React.useState<OutboxEntry[] | null>(null)

  const load = React.useCallback(async () => {
    try {
      const data = await dev.outbox()
      setOutbox(data.outbox)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }, [toast])

  React.useEffect(() => {
    setAssistantPage({
      context: "The developer is inspecting emails the plugin sent through ctx.email.send().",
      quick: ["Explain how plugin email works", "Add a welcome email to my plugin"],
    })
  }, [setAssistantPage])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <PageHead
        title="Email outbox"
        description={
          <>
            Emails sent through <code>ctx.email.send()</code> in this session. Nothing leaves your machine.
          </>
        }
      />
      <div>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw />
          Refresh
        </Button>
      </div>

      {outbox && outbox.length > 0 ? (
        <div className="space-y-3">
          {[...outbox].reverse().map((entry, index) => (
            <Card key={`${entry.at}-${index}`}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4 text-primary" />
                  {entry.subject || "(no subject)"}
                </CardTitle>
                <CardDescription>
                  to {entry.to} · {timeAgo(entry.at)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11.5px]">
                  {entry.text ?? entry.html ?? "(empty body)"}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : outbox ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Mail className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm font-semibold">No emails sent yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Call <code>ctx.email.send({"{ to, subject, text }"})</code> from a job or route (needs the <code>email:send</code>{" "}
              permission).
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
