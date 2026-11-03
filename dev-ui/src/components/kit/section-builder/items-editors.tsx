import { Plus, Trash2 } from "lucide-react"
import { str } from "@/components/kit/section-builder/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function StatsItemsEditor({ items, onChange }: { items: unknown[]; onChange: (items: unknown[]) => void }) {
  const rows = items as { label?: unknown; value?: unknown; hint?: unknown }[]
  const update = (index: number, patch: Record<string, unknown>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="space-y-1.5 rounded-lg border border-border p-2">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Stat {index + 1}</p>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </Button>
          </div>
          <Input value={str(row.label)} placeholder="Label" onChange={(event) => update(index, { label: event.target.value })} />
          <Input value={str(row.value)} placeholder="Value" onChange={(event) => update(index, { value: event.target.value })} />
          <Input
            value={str(row.hint)}
            placeholder="Hint (optional)"
            onChange={(event) => update(index, { hint: event.target.value })}
          />
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...rows, { label: "Metric", value: "0", hint: "" }])}>
        <Plus />
        Add stat
      </Button>
    </div>
  )
}

export function LinksItemsEditor({ items, onChange }: { items: unknown[]; onChange: (items: unknown[]) => void }) {
  const rows = items as { label?: unknown; href?: unknown }[]
  const update = (index: number, patch: Record<string, unknown>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="space-y-1.5 rounded-lg border border-border p-2">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Link {index + 1}</p>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </Button>
          </div>
          <Input value={str(row.label)} placeholder="Label" onChange={(event) => update(index, { label: event.target.value })} />
          <Input
            value={str(row.href)}
            placeholder="https://…"
            onChange={(event) => update(index, { href: event.target.value })}
          />
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...rows, { label: "Link", href: "https://" }])}>
        <Plus />
        Add link
      </Button>
    </div>
  )
}
