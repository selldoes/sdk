import { execFile } from "node:child_process"

/**
 * Opens the operating system's native folder picker on the machine running the
 * workspace server. Used by Settings → "Choose folder" so picking the default
 * project directory never means typing an absolute path.
 *
 * Every platform returns `{ path, cancelled }`; when no dialog tool exists we
 * return `{ path: null, cancelled: false, error }` and the UI falls back to the
 * manual path field. Nothing here throws for a user cancel.
 */

const PROMPT = "Choose the default folder for new Selldoes projects"

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 120_000, windowsHide: false, ...options }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          missing: error.code === "ENOENT",
          cancelled: false,
          stderr: String(stderr || error.message || "").trim(),
        })
        return
      }
      resolve({ ok: true, stdout: String(stdout ?? "").trim() })
    })
  })
}

function quote(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

async function pickWindows(initialDir) {
  const selected = initialDir ? String(initialDir).replace(/'/g, "''") : ""
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    `$d.Description = '${PROMPT.replace(/'/g, "''")}'`,
    "$d.ShowNewFolderButton = $true",
    selected ? `$d.SelectedPath = '${selected}'` : "",
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
  ]
    .filter(Boolean)
    .join("; ")

  const args = ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script]
  let result = await run("powershell.exe", args)
  if (result.missing) result = await run("pwsh", ["-NoProfile", "-STA", "-Command", script])
  if (!result.ok) {
    return {
      path: null,
      cancelled: false,
      error: result.missing ? "PowerShell was not found on this system — type the path manually" : result.stderr,
    }
  }
  return { path: result.stdout || null, cancelled: !result.stdout }
}

async function pickMac(initialDir) {
  const location = initialDir ? ` default location POSIX file "${quote(initialDir)}"` : ""
  const script = `POSIX path of (choose folder with prompt "${quote(PROMPT)}"${location})`
  const result = await run("osascript", ["-e", script])
  if (!result.ok) {
    if (/User canceled/i.test(result.stderr)) return { path: null, cancelled: true }
    return {
      path: null,
      cancelled: false,
      error: result.missing ? "osascript was not found on this system — type the path manually" : result.stderr,
    }
  }
  return { path: result.stdout || null, cancelled: !result.stdout }
}

async function pickLinux(initialDir) {
  const start = initialDir ? `${String(initialDir).replace(/\/?$/, "/")}` : null
  const zenity = await run("zenity", [
    "--file-selection",
    "--directory",
    `--title=${PROMPT}`,
    ...(start ? [`--filename=${start}`] : []),
  ])
  if (zenity.ok) return { path: zenity.stdout || null, cancelled: !zenity.stdout }
  if (!zenity.missing && !zenity.stderr) return { path: null, cancelled: true }

  const kdialog = await run("kdialog", ["--getexistingdirectory", initialDir || ".", "--title", PROMPT])
  if (kdialog.ok) return { path: kdialog.stdout || null, cancelled: !kdialog.stdout }
  if (zenity.missing && kdialog.missing) {
    return {
      path: null,
      cancelled: false,
      error: "No folder dialog available — install zenity or kdialog, or type the path manually",
    }
  }
  return { path: null, cancelled: true }
}

export async function chooseFolder({ initialDir } = {}) {
  const start = typeof initialDir === "string" && initialDir ? initialDir : null
  if (process.platform === "win32") return pickWindows(start)
  if (process.platform === "darwin") return pickMac(start)
  return pickLinux(start)
}
