import * as React from "react"

/**
 * Tracks in-flight actions by key so concurrent buttons each keep their own
 * spinner. Starting one action never clears another action's busy state, and
 * finishing one action never re-enables or re-spins the others — unlike a
 * single `busy: string | null` shared by every button on a page.
 */
export function useBusySet() {
  const [busy, setBusy] = React.useState<ReadonlySet<string>>(new Set())

  const isBusy = React.useCallback((key: string) => busy.has(key), [busy])
  const anyBusy = busy.size > 0
  const clear = React.useCallback(() => setBusy(new Set()), [])

  const run = React.useCallback(async (key: string, action: () => Promise<void>) => {
    setBusy((previous) => new Set(previous).add(key))
    try {
      await action()
    } finally {
      setBusy((previous) => {
        const next = new Set(previous)
        next.delete(key)
        return next
      })
    }
  }, [])

  return React.useMemo(() => ({ busy, isBusy, anyBusy, clear, run }), [busy, isBusy, anyBusy, clear, run])
}
