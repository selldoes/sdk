import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { loadUserSettings } from "./user-settings.mjs"

const run = promisify(execFile)

/** Editors we know how to jump to a specific file/line with. */
const CANDIDATES = [
  { id: "code", label: "VS Code", command: "code", goto: true },
  { id: "cursor", label: "Cursor", command: "cursor", goto: true },
  { id: "windsurf", label: "Windsurf", command: "windsurf", goto: true },
  { id: "code-insiders", label: "VS Code Insiders", command: "code-insiders", goto: true },
]

async function commandExists(command) {
  try {
    const locator = process.platform === "win32" ? "where" : "which"
    await run(locator, [command], { windowsHide: true, timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/** The editor saved in the user settings (~/.selldoes/settings.json), if any. */
function savedEditor() {
  try {
    const value = String(loadUserSettings().editor ?? "").trim()
    return value && value !== "auto" ? value : ""
  } catch {
    return ""
  }
}

/** Picks the editor to open: explicit → SELDOES_EDITOR → user settings → known CLIs. */
export async function resolveEditor(preferred) {
  const requested = String(preferred ?? "").trim() || process.env.SELDOES_EDITOR || process.env.VISUAL || process.env.EDITOR || savedEditor() || ""
  if (requested) {
    const known = CANDIDATES.find((candidate) => candidate.command === requested || candidate.id === requested)
    return known ?? { id: "custom", label: requested, command: requested, goto: false }
  }
  for (const candidate of CANDIDATES) {
    if (await commandExists(candidate.command)) return candidate
  }
  return null
}

function launch(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

function openWithOs(target) {
  if (process.platform === "win32") return launch("cmd", ["/c", "start", "", target], undefined)
  if (process.platform === "darwin") return launch("open", [target], undefined)
  return launch("xdg-open", [target], undefined)
}

/**
 * Opens a project (and optionally a file at a line) in the developer's
 * editor. Falls back to the OS file manager when no known editor is found.
 */
export async function openInEditor({ dir, file, line, column, editor, dryRun = false } = {}) {
  const cwd = path.resolve(dir)
  if (!fs.existsSync(cwd)) throw new Error(`Folder does not exist: ${cwd}`)
  const target = await resolveEditor(editor)
  if (target) {
    const args = []
    if (file) {
      const absolute = path.resolve(cwd, file)
      if (target.goto) {
        args.push(cwd, "--goto", `${absolute}:${Math.max(1, Number(line) || 1)}:${Math.max(1, Number(column) || 1)}`)
      } else {
        args.push(cwd, absolute)
      }
    } else {
      args.push(cwd)
    }
    if (dryRun) return { opened: false, dryRun: true, editor: target.id, command: target.command, args }
    await launch(target.command, args, cwd)
    return { opened: true, editor: target.id, command: target.command, args }
  }
  const osTarget = file ? path.resolve(cwd, file) : cwd
  if (dryRun) {
    const command = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open"
    return { opened: false, dryRun: true, editor: "os", command, args: [osTarget] }
  }
  await openWithOs(osTarget)
  return { opened: true, editor: "os", command: null, args: [] }
}

/**
 * Opens an OS terminal at the project root. The in-browser terminal lives in
 * the workspace server; this is the always-available fallback.
 */
export async function openTerminal({ dir } = {}) {
  const cwd = path.resolve(dir)
  if (!fs.existsSync(cwd)) throw new Error(`Folder does not exist: ${cwd}`)
  if (process.platform === "win32") {
    if (await commandExists("wt")) {
      await launch("wt", ["-d", cwd], cwd)
      return { opened: true, terminal: "wt" }
    }
    await launch("cmd", ["/c", "start", "cmd", "/k", `cd /d "${cwd}"`], cwd)
    return { opened: true, terminal: "cmd" }
  }
  if (process.platform === "darwin") {
    await launch("open", ["-a", "Terminal", cwd], cwd)
    return { opened: true, terminal: "Terminal" }
  }
  for (const candidate of [
    { command: "x-terminal-emulator", args: ["--working-directory", cwd] },
    { command: "gnome-terminal", args: [`--working-directory=${cwd}`] },
    { command: "konsole", args: ["--workdir", cwd] },
    { command: "xterm", args: [] },
  ]) {
    if (await commandExists(candidate.command)) {
      await launch(candidate.command, candidate.args, cwd)
      return { opened: true, terminal: candidate.command }
    }
  }
  throw new Error("No terminal emulator found")
}

export function availableEditors() {
  return CANDIDATES.map((candidate) => ({ id: candidate.id, label: candidate.label, command: candidate.command }))
}
