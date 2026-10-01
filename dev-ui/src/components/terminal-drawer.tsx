import * as React from "react"
import { ExternalLink, RefreshCw, SquareTerminal, X } from "lucide-react"
import "@xterm/xterm/css/xterm.css"
import { Button } from "@/components/ui/button"
import { dev } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ws } from "@/lib/ws-api"
import { useApp } from "@/state/app"

/**
 * Bottom terminal drawer (Ctrl/Cmd+`). Backed by a WebSocket — the workspace
 * server keeps the session's cwd at the selected project, so switching
 * projects restarts the shell there.
 */
export function TerminalDrawer() {
  const { terminalOpen, setTerminalOpen, workspace, bootstrap, toast } = useApp()
  const projectKey = workspace?.current?.project.id ?? bootstrap?.manifest.slug ?? null
  const workspaceMode = workspace !== null
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [mode, setMode] = React.useState<"pty" | "pipes" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (!terminalOpen) return
    let disposed = false
    let socket: WebSocket | null = null
    let term: import("@xterm/xterm").Terminal | null = null
    let onWindowResize: (() => void) | null = null

    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
        if (disposed || !containerRef.current) return
        term = new Terminal({
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          cursorBlink: true,
          scrollback: 2000,
          theme: {
            background: "#0f1115",
            foreground: "#d6d8de",
            cursor: "#f97316",
            selectionBackground: "#334155",
          },
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(containerRef.current)
        try {
          fit.fit()
        } catch {
          // container not laid out yet
        }

        const protocol = window.location.protocol === "https:" ? "wss" : "ws"
        const projectId = workspace?.current?.project.id
        const path = workspaceMode ? `/__ws/terminal${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}` : "/__dev/terminal"
        socket = new WebSocket(`${protocol}://${window.location.host}${path}`)
        socket.onopen = () => {
          setError(null)
          const sendResize = () => {
            if (term && socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }))
            }
          }
          sendResize()
        }
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data))
            if (message.type === "output") term?.write(String(message.data))
            else if (message.type === "ready") setMode(message.mode === "pipes" ? "pipes" : "pty")
            else if (message.type === "exit") term?.write(`\r\n\x1b[2m[process exited ${message.code}]\x1b[0m\r\n`)
            else if (message.type === "error") {
              setError(String(message.error))
              term?.write(`\r\n\x1b[31m${message.error}\x1b[0m\r\n`)
            }
          } catch {
            // ignore malformed frames
          }
        }
        socket.onerror = () => setError("Terminal connection failed — try “open OS terminal”")
        socket.onclose = () => term?.write("\r\n\x1b[2m[disconnected]\x1b[0m\r\n")
        term.onData((data) => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }))
        })

        onWindowResize = () => {
          try {
            fit.fit()
            if (term && socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }))
            }
          } catch {
            // ignore
          }
        }
        window.addEventListener("resize", onWindowResize)
        if (disposed) socket.close()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()

    return () => {
      disposed = true
      if (onWindowResize) window.removeEventListener("resize", onWindowResize)
      socket?.close()
      term?.dispose()
      setMode(null)
    }
  }, [terminalOpen, projectKey, workspaceMode, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  const openOsTerminal = () => {
    const request = workspaceMode ? ws.openEditor({ terminal: true }) : dev.openEditor({ terminal: true })
    request
      .then((result) => toast(`Terminal opened (${result.terminal ?? "os"})`, "success"))
      .catch((cause) => toast(cause instanceof Error ? cause.message : String(cause), "error"))
  }

  if (!terminalOpen) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] flex h-[280px] flex-col border-t border-black/40 bg-[#0f1115] shadow-2xl">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-white/10 px-3 text-[11px] text-zinc-300">
        <SquareTerminal className="h-3.5 w-3.5" />
        <span className="font-semibold">Terminal</span>
        {mode === "pipes" ? (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300" title="node-pty is unavailable — shell runs without a TTY">
            limited mode
          </span>
        ) : null}
        {error ? <span className="truncate text-red-400">{error}</span> : null}
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-300 hover:bg-white/10 hover:text-white" title="Reconnect" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-300 hover:bg-white/10 hover:text-white" title="Open an OS terminal instead" onClick={openOsTerminal}>
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-300 hover:bg-white/10 hover:text-white" title="Close" onClick={() => setTerminalOpen(false)}>
            <X className="h-3 w-3" />
          </Button>
        </span>
      </div>
      <div ref={containerRef} className={cn("min-h-0 flex-1 px-2 py-1", !mode && error ? "opacity-60" : "")} />
    </div>
  )
}
