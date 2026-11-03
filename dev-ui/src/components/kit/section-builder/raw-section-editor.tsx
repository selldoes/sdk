import * as React from "react"
import { Callout } from "@/components/shared"
import { Textarea } from "@/components/ui/textarea"
import type { PluginDashboardSection } from "@/lib/types"

export function RawSectionEditor({
  section,
  onReplace,
}: {
  section: PluginDashboardSection
  onReplace: (section: PluginDashboardSection) => void
}) {
  const [text, setText] = React.useState(JSON.stringify(section, null, 2))
  const [error, setError] = React.useState<string | null>(null)
  return (
    <div className="space-y-1.5">
      <Callout kind="warn">
        Unknown component type <code>{section.type}</code> — the host may render it, the preview doesn't know it yet. Its JSON is
        preserved on save; edit it here.
      </Callout>
      <Textarea
        rows={12}
        className="font-mono text-[11.5px]"
        value={text}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          try {
            const parsed = JSON.parse(next) as PluginDashboardSection
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.type !== "string") {
              throw new Error('expected an object with a "type"')
            }
            setError(null)
            onReplace(parsed)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        }}
      />
      {error ? <p className="text-[10.5px] text-destructive">Invalid: {error}</p> : null}
    </div>
  )
}
