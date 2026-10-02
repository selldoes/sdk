import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Composed loading placeholders. Pages that fetch their own data (Dashboard
 * host replica, Store data, Email, Realtime, Console, Code, Settings) render
 * these until the first response lands, so the layout never jumps and the
 * user never sees an empty screen.
 */

export function SkeletonPageHead({ className }: { className?: string }) {
  return (
    <div className={cn("mb-5 space-y-2", className)}>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-full max-w-2xl" />
    </div>
  )
}

export function SkeletonCard({
  rows = 3,
  className,
  width = "full",
}: {
  rows?: number
  className?: string
  width?: "full" | "narrow"
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", width === "narrow" && "max-w-sm", className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className={index % 2 === 0 ? "h-4 w-full" : "h-4 w-4/5"} />
        ))}
      </div>
    </div>
  )
}

/** A vertical stack of card placeholders. */
export function SkeletonCards({ count = 3, rows = 3 }: { count?: number; rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} rows={rows} />
      ))}
    </div>
  )
}

/** A generic list of rows inside one bordered card. */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y divide-border rounded-xl border border-border bg-card", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Sidebar switcher placeholder shown before the workspace bootstrap settles. */
export function SkeletonWorkspaceSwitcher() {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2">
      <Skeleton className="h-8 w-8 rounded-md" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-2.5 w-36" />
      </div>
    </div>
  )
}

/** Editor-shaped placeholder (Code page file tree + editor). */
export function SkeletonEditor({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full min-h-[420px] overflow-hidden rounded-xl border border-border bg-card", className)}>
      <div className="w-56 shrink-0 space-y-2 border-r border-border p-3">
        {Array.from({ length: 10 }).map((_, index) => (
          <Skeleton key={index} className="h-3.5" style={{ width: `${45 + ((index * 13) % 45)}%` }} />
        ))}
      </div>
      <div className="flex-1 space-y-2.5 p-4">
        {Array.from({ length: 14 }).map((_, index) => (
          <Skeleton key={index} className="h-3.5" style={{ width: `${30 + ((index * 17) % 60)}%` }} />
        ))}
      </div>
    </div>
  )
}

/**
 * The dashboard layout rendered behind the locked onboarding dialog — looks
 * like a real project page but is entirely placeholder, so a first-run user
 * sees the shell taking shape instead of a blank or a stray empty-state card.
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <PageHeadSkeleton />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <SkeletonCard rows={5} />
        <div className="space-y-4">
          <SkeletonCard rows={2} />
          <SkeletonCard rows={4} />
        </div>
      </div>
      <Skeleton className="h-3 w-32" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

function PageHeadSkeleton() {
  return (
    <div className="mb-5 space-y-2">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-4 w-full max-w-xl" />
    </div>
  )
}

