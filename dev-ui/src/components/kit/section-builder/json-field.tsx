import * as React from "react"
import { Textarea } from "@/components/ui/textarea"

export function JsonField({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: unknown
  onChange: (value: unknown) => void
  placeholder?: string
  rows?: number
}) {
  const [text, setText] = React.useState(value === undefined ? "" : JSON.stringify(value, null, 2))
  const [error, setError] = React.useState<string | null>(null)
  return (
    <div className="space-y-1">
      <Textarea
        rows={rows}
        className="font-mono text-[11.5px]"
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          if (!next.trim()) {
            setError(null)
            onChange(undefined)
            return
          }
          try {
            onChange(JSON.parse(next))
            setError(null)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        }}
      />
      {error ? <p className="text-[10.5px] text-destructive">Invalid JSON: {error}</p> : null}
    </div>
  )
}
