import * as React from "react"
import { AlertCircle, AlertTriangle, Check, Copy, Info, Star, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function PageHead({
  title,
  description,
  action,
}: {
  title: string
  description?: React.ReactNode
  /** Top-right slot — page-level actions like "New job". */
  action?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-4xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function Callout({
  kind = "info",
  children,
  className,
}: {
  kind?: "info" | "warn" | "danger" | "success"
  children: React.ReactNode
  className?: string
}) {
  const styles = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[kind]
  const Icon = { info: Info, warn: AlertTriangle, danger: AlertCircle, success: Check }[kind]
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border p-3 text-sm", styles, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon: LucideIcon
  title: string
  message?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold">{title}</p>
        {message ? <p className="max-w-md text-xs text-muted-foreground">{message}</p> : null}
        {action ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
      </CardContent>
    </Card>
  )
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          // clipboard unavailable
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  )
}

export function Stars({ rating = 0, count = 0, className }: { rating?: number; count?: number; className?: string }) {
  const full = Math.round(rating)
  return (
    <span className={cn("flex items-center gap-1 text-xs", className)}>
      <span className="flex">
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            key={index}
            className={cn("h-3.5 w-3.5", index < full ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40")}
          />
        ))}
      </span>
      <span className="text-muted-foreground">{rating > 0 ? rating.toFixed(1) : "New"}{count ? ` (${count})` : ""}</span>
    </span>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 mt-7 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{children}</p>
}
