import path from "node:path"
import fs from "node:fs"
import { openInEditor, openTerminal, resolveEditor } from "./open-editor.mjs"
import { die, fileExists } from "./util.mjs"

/** Walks up from cwd looking for a project root (plugin or theme). */
function findProjectDir() {
  let dir = path.resolve()
  for (let depth = 0; depth < 12; depth += 1) {
    if (fileExists(path.join(dir, "plugin.json")) || fileExists(path.join(dir, "manifest.json"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** `src/app.tsx:12:4` → `{ file, line, column }` (Windows drive letters safe). */
function splitFileSpec(spec) {
  const parts = String(spec).split(":")
  let file = String(spec)
  let line
  let column
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
    if (parts.length >= 3 && /^\d+$/.test(parts[parts.length - 2])) {
      column = Number(parts[parts.length - 1])
      line = Number(parts[parts.length - 2])
      file = parts.slice(0, -2).join(":")
    } else {
      line = Number(parts[parts.length - 1])
      file = parts.slice(0, -1).join(":")
    }
  }
  return { file, line, column }
}

/**
 * `selldoes open [file[:line[:col]]] [--dir <path>] [--editor code]
 *  [--terminal] [--print]`
 *
 * Opens the current project (or a file inside it) in the developer's editor,
 * or an OS terminal at the project root with --terminal.
 */
export async function openCommand(args, flags) {
  const dir = flags.dir !== undefined ? path.resolve(String(flags.dir)) : findProjectDir()
  if (!dir) {
    die("No plugin.json or manifest.json found — pass --dir <path>")
  }
  if (!fs.existsSync(dir)) die(`Folder does not exist: ${dir}`)

  const spec = flags.file !== undefined ? String(flags.file) : args[0] ? String(args[0]) : null
  const parsed = spec ? splitFileSpec(spec) : { file: null, line: undefined, column: undefined }
  const editor = flags.editor !== undefined ? String(flags.editor) : undefined

  if (flags.terminal === true) {
    const result = await openTerminal({ dir })
    console.log(`✓ terminal opened (${result.terminal}) at ${dir}`)
    return
  }

  const result = await openInEditor({
    dir,
    file: parsed.file ?? undefined,
    line: parsed.line,
    column: parsed.column,
    editor,
    dryRun: flags.print === true,
  })

  if (flags.print === true) {
    const command = result.command ? [result.command, ...result.args].join(" ") : "(system open)"
    console.log(command)
    return
  }

  const target = parsed.file ? `${parsed.file}${parsed.line ? `:${parsed.line}` : ""}` : "project folder"
  console.log(`✓ opened ${target} in ${result.editor === "os" ? "the system default" : result.editor}`)
}

export { splitFileSpec, findProjectDir, resolveEditor }
