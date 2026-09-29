#!/usr/bin/env node
/**
 * create-selldesk-plugin — scaffold a new SellDesk plugin project.
 *
 *   npm create selldesk-plugin@latest my-plugin
 *   npm create selldesk-plugin@latest my-plugin -- --no-ui
 *
 * Creates a project with:
 *   plugin.json          manifest (API routes, dashboard UI, permissions)
 *   index.js             sandbox runtime entry with typed stubs
 *   ui/                  dashboard UI starter (remove with --no-ui)
 *   selldesk.config.json dev-server settings (store id/slug, mock AI, sample data)
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const templateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "template")
const SDK_VERSION = "^0.2.0"
const CLI_VERSION = "^0.1.0"

const args = process.argv.slice(2)
const flags = new Set(args.filter((argument) => argument.startsWith("--")))
const positional = args.find((argument) => !argument.startsWith("--"))

if (!positional) {
  console.error("Usage: npm create selldesk-plugin@latest <my-plugin> [-- --no-ui] [--force]")
  process.exit(1)
}

const targetDir = path.resolve(positional)
const slug = path
  .basename(targetDir)
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/^-+|-+$/g, "")

if (!slug) {
  console.error(`Cannot derive a plugin slug from "${positional}"`)
  process.exit(1)
}
if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 2) {
  console.error(`Invalid slug "${slug}" — use at least two lowercase letters/digits`)
  process.exit(1)
}

if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0 && !flags.has("--force")) {
  console.error(`✗ ${path.relative(process.cwd(), targetDir) || "."} is not empty (use --force to overwrite)`)
  process.exit(1)
}

const name = slug
  .split("-")
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(" ")

const replacements = {
  __PLUGIN_SLUG__: slug,
  __PLUGIN_NAME__: name,
  __SDK_VERSION__: SDK_VERSION,
  __CLI_VERSION__: CLI_VERSION,
}

const copy = (fromDir, toDir) => {
  fs.mkdirSync(toDir, { recursive: true })
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, entry.name)
    const to = path.join(toDir, entry.name)
    if (entry.isDirectory()) {
      copy(from, to)
      continue
    }
    if (entry.name === ".npmignore" || entry.name === "package-lock.json") continue
    let content = fs.readFileSync(from, "utf8")
    for (const [token, value] of Object.entries(replacements)) content = content.split(token).join(value)
    fs.writeFileSync(to, content)
  }
}

copy(templateDir, targetDir)

if (flags.has("--no-ui")) {
  fs.rmSync(path.join(targetDir, "ui"), { recursive: true, force: true })
  const manifestPath = path.join(targetDir, "plugin.json")
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  delete manifest.ui
  delete manifest.dashboardPages
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

const relative = path.relative(process.cwd(), targetDir) || "."
console.log(`
✓ ${name} created in ${relative}/

Next steps:

  cd ${relative}
  npm install
  npm run dev        # local preview: dashboard UI, storefront, API console, mock data
  npm run validate   # check the manifest and entries
  npm run build      # bundle into dist/
  npm run publish    # upload + marketplace listing (needs --app-url and auth)

Docs: https://selldoes.com/docs/plugins
`)
