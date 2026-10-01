import fs from "node:fs"
import path from "node:path"
import { parseArgs, findPluginRoot, openBrowser, die } from "./util.mjs"
import { getUpdateInfo, printUpdateNotice } from "./update-check.mjs"

const HELP = `selldoes — build Selldoes plugins and themes

Usage: selldoes <command> [options]

Workspace (the SDK is your workspace — projects live anywhere on disk)
  (no command)             Open the launcher: recent projects, import, create
  home                     Same as running selldoes with no command
  import <path>            Add an existing plugin/theme folder to your workspace

Create
  create [dir]              Scaffold a new plugin or theme (interactive)

Plugin projects (a directory with plugin.json)
  dev                       Local preview server (dashboard UI, storefront, API console, jobs)
  build                     Bundle the plugin into dist/ (--zip to also write <slug>.zip)
  pack                      Bundle + zip without publishing
  validate                  Validate plugin.json, entries and route declarations
  publish                   Build, zip and publish to a SellDesk instance

  (dev/build/… run outside a project folder open the workspace launcher
   instead of failing — pick the project there and the command runs on it.)

Theme projects (a directory with manifest.json)
  dev [--store <slug>]      Live preview against a real store (hot reload)
  build                     Bundle src/*.tsx → dist/ + manifest
  publish [--public]        Build and upload the theme
  apply --store <slug>      Apply the uploaded theme to a store
  init <template-id>        Download an existing theme as a local project

Account (themes)
  login --api-key sk_…      Authenticate with an API key (Dashboard → Settings → API Keys)
  logout                    Remove saved credentials
  whoami                    Show the connected account + stores

Maintenance
  update                    Check npm and update the CLI (asks before installing)

Options
  --dir <path>              Project directory (default: nearest plugin.json / manifest.json)
  --port <n> --host <addr>  Dev server address (plugin default 4590, theme default 4173)
  --open                    Open the preview in your browser (plugin dev)
  --app-url <url>           SellDesk instance for publish (or SELLDOES_APP_URL)
  --token <token>           Service publish token (or SELLDOES_PUBLISH_TOKEN)
  --cookie <session=…>      Dashboard session cookie (or SELLDOES_SESSION_COOKIE)
  --store <id|slug>         Store id (plugin publish) or store slug (theme dev/apply)
  --price <amount>          Marketplace price (default 0 = free)
  --billing <period>        one_time | monthly | yearly (default one_time)
  --base <url>              SellDesk base URL for themes (or SELLDOES_BASE)
  --api-key <key>           Theme API key (or SELLDOES_API_KEY)
  --check                   update: report only, never install (exit 1 when outdated)
  --yes                     update: skip the confirmation prompt
  --global / --local        update: force the install target
  --public                  Theme: make the uploaded theme public
  --force                   create: overwrite a non-empty directory
  -y, --yes                 create: accept all defaults (plugin unless --theme)
  --plugin / --theme        create: skip the type prompt
  --no-ui                   create: plugin without a dashboard UI
  --ui js|react             create: dashboard UI flavor (default js; react = TSX bundled by esbuild)
  --no-install              create: skip npm install
  --version <v>             create: project version (default 0.1.0)
`

function projectKind(dir) {
  if (fs.existsSync(path.join(dir, "plugin.json"))) return "plugin"
  if (fs.existsSync(path.join(dir, "manifest.json"))) return "theme"
  return null
}

function resolveProjectDir(flags) {
  if (flags.dir !== undefined) return path.resolve(String(flags.dir))
  const pluginRoot = findPluginRoot()
  if (pluginRoot) return pluginRoot
  let dir = path.resolve()
  for (let depth = 0; depth < 12; depth++) {
    if (fs.existsSync(path.join(dir, "manifest.json"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

export async function main() {
  const argv = process.argv.slice(2)
  // Bare `selldoes` = the workspace launcher.
  if (argv.length === 0) argv.push("home")
  const { command, args, flags } = parseArgs(argv)
  const normalized =
    command === "--help" || command === "-h"
      ? "help"
      : command === "--version" || command === "-v"
        ? "version"
        : command

  const checkForUpdates =
    normalized !== "help" &&
    normalized !== "version" &&
    normalized !== "update" &&
    !process.env.SELLDOES_NO_UPDATE_CHECK
  const updatePromise = checkForUpdates ? getUpdateInfo() : null

  try {
    const update = updatePromise ? await updatePromise : null
    if (update?.outdated) printUpdateNotice(update)

    switch (normalized) {
      case "help":
        console.log(HELP)
        return

      case "update": {
        const { updateCommand } = await import("./update.mjs")
        await updateCommand(args, flags)
        return
      }

      case "version": {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
        console.log(pkg.version)
        return
      }

      case "create": {
        const { createCommand } = await import("./create.mjs")
        await createCommand(args, flags)
        return
      }

      case "home": {
        const { homeCommand } = await import("./home.mjs")
        await homeCommand(args, flags)
        return
      }

      case "import": {
        const { importCommand } = await import("./home.mjs")
        await importCommand(args, flags)
        return
      }

      case "login":
      case "logout":
      case "whoami": {
        const { themeCommand } = await import("./theme.mjs")
        await themeCommand(command, args, flags)
        return
      }

      case "dev":
      case "build":
      case "pack":
      case "validate":
      case "publish":
      case "upload":
      case "apply":
      case "init":
        return runProjectCommand(command, args, flags)

      default:
        console.error(`Unknown command "${command}"\n`)
        console.log(HELP)
        process.exitCode = 1
    }
  } catch (error) {
    die(error instanceof Error ? error.message : String(error))
  }
}

async function runProjectCommand(command, args, flags) {
  const projectDir = resolveProjectDir(flags)
  const kind = projectKind(projectDir)

  if (!kind) {
    if (flags.dir !== undefined) {
      die(`No plugin.json or manifest.json in ${projectDir}`)
    }
    // Not inside a project — open the workspace launcher instead of failing.
    console.log("No plugin.json or manifest.json in this folder — opening your workspace.\n")
    const { homeCommand } = await import("./home.mjs")
    await homeCommand([], flags)
    return
  }

  // Remember this project in the workspace (last-opened ordering).
  try {
    const { touchProject } = await import("./workspace.mjs")
    touchProject({ dir: projectDir, kind })
  } catch {
    // workspace state is best-effort — never block a command on it
  }

  if (kind === "theme") {
    if (projectDir !== process.cwd()) process.chdir(projectDir)
    const { themeCommand } = await import("./theme.mjs")
    return themeCommand(command, args, flags)
  }

  switch (command) {
    case "dev": {
      const { startDevServer } = await import("./plugin/dev/server.mjs")
      const server = await startDevServer({
        pluginDir: projectDir,
        port: flags.port ? Number(flags.port) : undefined,
        host: flags.host ? String(flags.host) : undefined,
      })
      console.log(`\n  Selldoes plugin preview → ${server.url}`)
      console.log("  Press Ctrl+C to stop\n")
      if (flags.open) openBrowser(server.url)
      return
    }

    case "build":
    case "pack": {
      const { buildPlugin } = await import("./plugin/build.mjs")
      const zip = command === "pack" || flags.zip === true
      const built = await buildPlugin(projectDir, { zip })
      console.log(
        `✓ ${built.manifest.slug} → ${path.relative(process.cwd(), built.outDir)}/ (bundle.js ${built.sizeKb} KB)`
      )
      if (built.zipPath) console.log(`  → ${path.relative(process.cwd(), built.zipPath)}`)
      return
    }

    case "validate": {
      const { validatePluginDir } = await import("./plugin/validate.mjs")
      const result = validatePluginDir(projectDir)
      for (const warning of result.warnings) console.warn(`  ! ${warning}`)
      if (result.errors.length > 0) {
        console.error(`✗ ${result.slug}`)
        for (const error of result.errors) console.error(`    ${error}`)
        process.exit(1)
      }
      console.log(`✓ ${result.slug}@${result.manifest.version} is valid`)
      return
    }

    case "publish": {
      const { publishPlugin } = await import("./plugin/publish.mjs")
      const result = await publishPlugin({
        pluginDir: projectDir,
        appUrl: String(flags["app-url"] ?? process.env.SELLDOES_APP_URL ?? ""),
        token: String(flags.token ?? process.env.SELLDOES_PUBLISH_TOKEN ?? "") || undefined,
        cookie: String(flags.cookie ?? process.env.SELLDOES_SESSION_COOKIE ?? "") || undefined,
        storeId: flags.store,
        price: Number(flags.price ?? 0) || 0,
        billingPeriod: String(flags.billing ?? "one_time"),
      })
      if (!result.ok) process.exit(1)
      return
    }

    case "init":
    case "apply":
    case "upload":
      die(`"${command}" is for theme projects — this directory contains a plugin.json`)
      return

    default:
      die(`Unknown command "${command}"`)
  }
}
