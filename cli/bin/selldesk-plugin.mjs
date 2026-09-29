#!/usr/bin/env node
/**
 * selldesk-plugin — build, preview and publish SellDesk plugins.
 *
 *   selldesk-plugin dev       [--port 4590] [--open] [--host 127.0.0.1]
 *   selldesk-plugin build     [--zip]
 *   selldesk-plugin pack
 *   selldesk-plugin validate
 *   selldesk-plugin publish   --app-url <url> --token <token> | --cookie <session>
 *
 * Run inside a plugin project (a directory containing plugin.json).
 */
import fs from "node:fs"
import path from "node:path"
import { parseArgs, findPluginRoot, openBrowser, die } from "../lib/util.mjs"

const HELP = `selldesk-plugin — build, preview and publish SellDesk plugins

Usage: selldesk-plugin <command> [options]

Commands
  dev                     Start the local preview server (dashboard UI, storefront widget/pages, API console, jobs, hooks)
  build                   Bundle the plugin into dist/ (use --zip to also write <slug>.zip)
  pack                    Bundle + zip only (no publish)
  validate                Validate plugin.json, entries and route declarations
  publish                 Build, zip and publish to a SellDesk instance

Options
  --port <n>              dev server port (default 4590, or selldesk.config.json "port")
  --host <addr>           dev server host (default 127.0.0.1)
  --open                  open the preview in your browser
  --dir <path>            plugin directory (default: nearest folder with plugin.json)
  --app-url <url>         SellDesk instance for publish (or SELDESK_APP_URL)
  --token <token>         service publish token (CI) (or SELDESK_PUBLISH_TOKEN)
  --cookie <session=…>    dashboard session cookie (or SELDESK_SESSION_COOKIE)
  --store <id>            store id for session publish / dev store (or selldesk.config.json "storeId")
  --price <amount>        marketplace price (default 0 = free)
  --billing <period>      one_time | monthly | yearly (default one_time)
  --zip                   with build: also produce a zip for manual upload
`

const argv = process.argv.slice(2)

if (argv[0] === "help" || argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP)
  process.exit(0)
}

const { command, flags } = parseArgs(argv)

if (flags.help) {
  console.log(HELP)
  process.exit(0)
}

const pluginDir = path.resolve(String(flags.dir ?? "") || findPluginRoot() || process.cwd())
if (!fs.existsSync(path.join(pluginDir, "plugin.json"))) {
  die(`No plugin.json found in ${pluginDir} — run this inside a plugin project (or pass --dir)`)
}

switch (command) {
  case "validate": {
    const { validatePluginDir } = await import("../lib/validate.mjs")
    const result = validatePluginDir(pluginDir)
    for (const warning of result.warnings) console.warn(`  ! ${warning}`)
    if (result.errors.length > 0) {
      console.error(`✗ ${result.slug}`)
      for (const error of result.errors) console.error(`    ${error}`)
      process.exit(1)
    }
    console.log(`✓ ${result.slug}@${result.manifest.version} is valid`)
    break
  }

  case "build":
  case "pack": {
    const { buildPlugin } = await import("../lib/build.mjs")
    const zip = command === "pack" || flags.zip === true
    const built = await buildPlugin(pluginDir, { zip })
    console.log(`✓ ${built.manifest.slug} → ${path.relative(process.cwd(), built.outDir)}/ (bundle.js ${built.sizeKb} KB)`)
    if (built.zipPath) console.log(`  → ${path.relative(process.cwd(), built.zipPath)}`)
    break
  }

  case "publish": {
    const { publishPlugin } = await import("../lib/publish.mjs")
    const result = await publishPlugin({
      pluginDir,
      appUrl: String(flags["app-url"] ?? process.env.SELDESK_APP_URL ?? ""),
      token: String(flags.token ?? process.env.SELDESK_PUBLISH_TOKEN ?? "") || undefined,
      cookie: String(flags.cookie ?? process.env.SELDESK_SESSION_COOKIE ?? "") || undefined,
      storeId: flags.store,
      price: Number(flags.price ?? 0) || 0,
      billingPeriod: String(flags.billing ?? "one_time"),
    })
    if (!result.ok) process.exit(1)
    break
  }

  case "dev": {
    const { startDevServer } = await import("../lib/dev/server.mjs")
    const server = await startDevServer({
      pluginDir,
      port: flags.port ? Number(flags.port) : undefined,
      host: flags.host ? String(flags.host) : undefined,
    })
    console.log(`\n  SellDesk plugin preview → ${server.url}`)
    console.log("  Press Ctrl+C to stop\n")
    if (flags.open) openBrowser(server.url)
    break
  }

  default:
    console.error(`Unknown command "${command}"\n`)
    console.log(HELP)
    process.exit(1)
}
