import fs from "node:fs"
import path from "node:path"
import readline from "node:readline/promises"
import { die, findPluginRoot } from "./util.mjs"
import { validatePluginDir } from "./plugin/validate.mjs"

/**
 * `selldoes ask` — the assistant in your terminal, no browser required.
 *
 *   selldoes ask "add a /stats API route that counts rows"   one-shot
 *   selldoes ask                                             interactive chat
 *   … --yes        apply proposed edits without prompting
 *   … --dry-run    never write files (default without --yes in pipes)
 */

function loadAssistantConfig(pluginDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(pluginDir, "selldoes.config.json"), "utf8"))
    return cfg && typeof cfg === "object" ? cfg : {}
  } catch {
    return {}
  }
}

async function applyEdits(pluginDir, edits) {
  const root = path.resolve(pluginDir)
  const manifestPath = path.join(root, "plugin.json")
  let current = {}
  try {
    current = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  } catch {
    // no readable manifest — apply files only
  }
  if (edits.manifest && String(edits.manifest.slug) !== String(current.slug)) {
    throw new Error("The assistant tried to change the slug — that is not allowed")
  }
  const applied = []
  for (const file of edits.files) {
    const full = path.resolve(root, file.path)
    if (!full.startsWith(root + path.sep)) continue
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, file.content)
    applied.push(file.path)
  }
  if (edits.manifest) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(edits.manifest, null, 2)}\n`)
    applied.push("plugin.json")
  }
  return applied
}

export async function askCommand(args, flags) {
  const pluginDir = flags.dir ? path.resolve(String(flags.dir)) : findPluginRoot()
  if (!pluginDir || !fs.existsSync(path.join(pluginDir, "plugin.json"))) {
    die("Run inside a plugin project or pass --dir <path> (the assistant is plugin-only for now)")
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8"))
  const config = loadAssistantConfig(pluginDir)
  const validation = validatePluginDir(pluginDir)
  const { assistantChat } = await import("./plugin/dev/assistant.mjs")

  const history = []
  const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null

  const round = async (question) => {
    history.push({ role: "user", content: question })
    let result
    try {
      result = await assistantChat({
        pluginDir,
        manifest,
        validation,
        activity: {},
        messages: history,
        config,
        log: (line) => process.stderr.write(`${line}\n`),
      })
    } catch (error) {
      console.error(`✗ ${error.message}`)
      return
    }
    if (result.text) console.log(`\nassistant ›\n${result.text}`)
    history.push({ role: "assistant", content: result.text || "(proposed file edits)" })
    if (!result.edits) return

    console.log(`\nProposed changes${result.edits.summary ? ` — ${result.edits.summary}` : ""}:`)
    for (const file of result.edits.files) {
      const before = file.before ?? ""
      console.log(`  • ${file.path}  (${file.exists === false ? "new file" : "modified"}, ${before.length} → ${file.content.length} chars)`)
    }

    if (flags["dry-run"] === true) {
      console.log("--dry-run: nothing written")
      return
    }
    let apply = flags.yes === true
    if (!apply && rl) {
      const answer = (await rl.question("Apply these changes? [y/N] ")).trim().toLowerCase()
      apply = answer === "y" || answer === "yes"
    } else if (!apply) {
      console.log("Non-interactive shell — pass --yes to apply (or --dry-run to silence this).")
      return
    }
    if (!apply) return

    try {
      const applied = await applyEdits(pluginDir, result.edits)
      console.log(`✓ Applied ${applied.length} file(s): ${applied.join(", ")}`)
      const after = validatePluginDir(pluginDir)
      console.log(`Validation after apply: ${after.errors.length} error(s), ${after.warnings.length} warning(s)`)
      for (const error of after.errors.slice(0, 5)) console.error(`  ✗ ${error}`)
    } catch (error) {
      console.error(`✗ Apply failed: ${error.message}`)
    }
  }

  const question = args.filter((arg) => !arg.startsWith("-")).join(" ").trim()
  if (question) await round(question)

  if (!rl) {
    if (!question) die("Ask a question: selldoes ask \"…\" (an interactive chat needs a TTY)")
    return
  }
  if (!question) console.log(`Selldoes assistant — ${manifest.slug} v${manifest.version ?? "?"} (Ctrl+C or "exit" to quit)`)
  for (;;) {
    let line
    try {
      line = (await rl.question("\nyou › ")).trim()
    } catch {
      break // Ctrl+C
    }
    if (!line) continue
    if (line === "exit" || line === "quit") break
    await round(line)
  }
  rl.close()
}
