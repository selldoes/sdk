import * as React from "react"
import type { DevStatus } from "./types"

/**
 * Subscribes to the dev server's live stream (`/__dev/stream`).
 *
 * `key` re-subscribes when the workspace project changes — the shell proxies
 * the stream to whichever preview child is current, so a stale connection
 * would keep reporting the old project.
 */
export type DevStreamEvent =
  | { type: "files"; paths: string[] }
  | { type: "build"; status: DevStatus }
  | { type: "log"; line: string }
  | { type: "snapshots" }

export function useDevStream(onEvent: (event: DevStreamEvent) => void, options: { key?: string | null; enabled?: boolean } = {}) {
  const handlerRef = React.useRef(onEvent)
  handlerRef.current = onEvent
  const { key = null, enabled = true } = options

  React.useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return
    let source: EventSource
    try {
      source = new EventSource("/__dev/stream")
    } catch {
      return
    }
    const parse = (event: MessageEvent) => {
      try {
        return JSON.parse(event.data)
      } catch {
        return null
      }
    }
    const onFiles = (event: MessageEvent) => {
      const data = parse(event)
      handlerRef.current({ type: "files", paths: Array.isArray(data?.paths) ? data.paths.map(String) : [] })
    }
    const onBuild = (event: MessageEvent) => {
      const data = parse(event)
      if (data) handlerRef.current({ type: "build", status: data as DevStatus })
    }
    const onLog = (event: MessageEvent) => {
      const data = parse(event)
      if (typeof data?.line === "string") handlerRef.current({ type: "log", line: data.line })
    }
    const onSnapshots = () => handlerRef.current({ type: "snapshots" })
    source.addEventListener("files", onFiles)
    source.addEventListener("build", onBuild)
    source.addEventListener("log", onLog)
    source.addEventListener("snapshots", onSnapshots)
    return () => {
      source.removeEventListener("files", onFiles)
      source.removeEventListener("build", onBuild)
      source.removeEventListener("log", onLog)
      source.removeEventListener("snapshots", onSnapshots)
      source.close()
    }
  }, [enabled, key])
}
