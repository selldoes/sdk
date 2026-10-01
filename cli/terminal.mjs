import { spawn } from "node:child_process"
import { WebSocketServer } from "ws"

/**
 * Terminal sessions for the dev shell.
 *
 * Prefers `node-pty` (a real TTY — colors, arrow keys, ctrl-c) and falls back
 * to a piped child process (no TTY, but npm/build/validate still work) when
 * the optional native dependency is unavailable. The UI shows which mode a
 * session runs in.
 */

let ptyPromise = null

function loadPty() {
  if (!ptyPromise) {
    ptyPromise = import("node-pty").catch(() => null)
  }
  return ptyPromise
}

export function defaultShell() {
  if (process.platform === "win32") return process.env.COMSPEC || "cmd.exe"
  return process.env.SHELL || "/bin/bash"
}

export async function createTerminalSession({ cwd, cols = 80, rows = 24, onData, onExit }) {
  const pty = await loadPty()
  if (pty?.spawn) {
    const child = pty.spawn(defaultShell(), [], {
      name: "xterm-256color",
      cwd,
      cols,
      rows,
      env: { ...process.env, SELDOES_NO_UPDATE_CHECK: "1" },
    })
    child.onData((data) => onData(data))
    child.onExit(({ exitCode }) => onExit(exitCode ?? 0))
    return {
      mode: "pty",
      write: (data) => {
        try {
          child.write(data)
        } catch {
          // session died
        }
      },
      resize: (nextCols, nextRows) => {
        try {
          child.resize(Math.max(2, nextCols), Math.max(1, nextRows))
        } catch {
          // resize not supported on this platform
        }
      },
      kill: () => {
        try {
          child.kill()
        } catch {
          // already gone
        }
      },
    }
  }

  const isWin = process.platform === "win32"
  const child = isWin
    ? spawn(process.env.COMSPEC || "cmd.exe", ["/Q"], { cwd, env: process.env, windowsHide: true })
    : spawn(process.env.SHELL || "/bin/bash", ["-i"], { cwd, env: process.env })
  child.stdout.on("data", (chunk) => onData(chunk.toString("utf8")))
  child.stderr.on("data", (chunk) => onData(chunk.toString("utf8")))
  child.on("exit", (code) => onExit(code ?? 0))
  return {
    mode: "pipes",
    write: (data) => {
      try {
        child.stdin.write(data)
      } catch {
        // stdin closed
      }
    },
    resize: () => {},
    kill: () => {
      try {
        child.kill()
      } catch {
        // already gone
      }
    },
  }
}

/**
 * Attaches a WebSocket terminal endpoint to an HTTP server.
 *
 *   WS <path>?…  →  JSON frames { type: "output"|"exit"|"ready" } out,
 *                   { type: "input"|"resize" } in.
 */
export function attachTerminalServer({ server, path: wsPath, resolveCwd, log = () => {} }) {
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Set()

  server.on("upgrade", (req, socket, head) => {
    let url
    try {
      url = new URL(req.url ?? "/", "http://localhost")
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== wsPath) return
    const cwd = resolveCwd(url)
    if (!cwd) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void startSession(ws, cwd)
    })
  })

  const startSession = async (ws, cwd) => {
    let session = null
    let closed = false
    const entry = { kill: () => session?.kill() }
    sessions.add(entry)

    const close = () => {
      if (closed) return
      closed = true
      sessions.delete(entry)
      session?.kill()
      try {
        ws.close()
      } catch {
        // already closed
      }
    }

    const send = (payload) => {
      if (closed || ws.readyState !== ws.OPEN) return
      try {
        ws.send(JSON.stringify(payload))
      } catch {
        close()
      }
    }

    try {
      session = await createTerminalSession({
        cwd,
        onData: (data) => send({ type: "output", data }),
        onExit: (code) => {
          send({ type: "exit", code })
          close()
        },
      })
    } catch (error) {
      send({ type: "error", error: error instanceof Error ? error.message : String(error) })
      close()
      return
    }

    log(`terminal session started (${session.mode}) in ${cwd}`)
    send({ type: "ready", mode: session.mode, cwd })

    ws.on("message", (raw) => {
      let message
      try {
        message = JSON.parse(String(raw))
      } catch {
        return
      }
      if (message?.type === "input" && typeof message.data === "string") session.write(message.data)
      if (message?.type === "resize" && Number.isFinite(message.cols) && Number.isFinite(message.rows)) {
        session.resize(Number(message.cols), Number(message.rows))
      }
    })
    ws.on("close", close)
    ws.on("error", close)
  }

  return {
    closeAll() {
      for (const entry of [...sessions]) entry.kill()
      sessions.clear()
      wss.close()
    },
  }
}
