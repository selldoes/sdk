import fs from "node:fs"
import path from "node:path"
import { parseArgs, findPluginRoot, openBrowser, die } from "./util.mjs"
import { getUpdateInfo, printUpdateNotice } from "./update-check.mjs"

const HELP = `selldoes — build Selldoes plugins and themes

Usage: selldoes <command> [options]

Workspace (the SDK is your workspace — projects live anywhere on disk)
  (no command)             Start the web workspace and open it in your browser
  workspace [--dev]        Start the web workspace. --dev = SDK development mode
                           (dev-ui on Vite with hot reload), --no-open = don't
                           launch the browser, --port <n> (default 4590)
  home                     Terminal launcher: recent projects, import, create
  import <path>            Add an existing plugin/theme project to your workspace
                           (a folder with plugin.json/manifest.json, or a .zip)
  open [file[:line[:col]]] Open the project (or a file at a line) in your editor.
                           --editor <cmd> picks a specific editor; --terminal
                           opens an OS terminal at the project root instead;
                           --print prints the command without launching it

Create
  create [dir]              Scaffold a new plugin or theme (interactive)
  create [dir] --ai "…"     Scaffold with AI — describe the plugin in plain
                            language; the model writes plugin.json + entry + UI

Assistant (the same brain as the preview's right panel)
  ask ["question"]          Chat with the AI about the current plugin project;
                            proposed edits are shown and (with --yes or your
                            confirmation) applied. --dry-run never writes.

Plugin projects (a directory with plugin.json)
  dev                       Local preview server (dashboard UI, storefront, API console, jobs)
  build                     Bundle the plugin into dist/ (--zip to also write <slug>.zip)
  pack                      Bundle + zip without publishing
  validate                  Validate plugin.json, entries and route declarations
  publish                   Build, zip and publish to a SellDesk instance

  (dev/build/… run outside a project folder open the workspace: \`dev\`
   starts the web workspace, the other commands open the terminal launcher
   and run the command on the project you pick.)

Theme projects (a directory with manifest.json)
  dev [--store <slug>]      Live preview against a real store (hot reload)
  build                     Bundle src/*.tsx → dist/ + manifest
  publish [--public]        Build and upload the theme
  apply --store <slug>      Apply the uploaded theme to a store
  init <template-id>        Download an existing theme as a local project

Account
  login [--token sk_dev_…]   Connect a developer account (portal → API tokens)
                             (a plain sk_… key logs the theme lane in instead)
  packages                   List the packages your developer account owns
  pull <slug>                Download one of your packages and keep developing it
                             (--dir <path> to choose where it lands)
  logout                     Remove saved credentials
  whoami                     Show connected identities (developer + themes)

Theme account (merchant API keys)
  login --api-key sk_…      Authenticate with an API key (Dashboard → Settings → API Keys)
  logout                    Remove saved credentials
  whoami                    Show the connected account + stores

Maintenance
  update                    Check npm and update the CLI (asks before installing)

Options
  --dir <path>              Project directory (default: nearest plugin.json / manifest.json)
  --port <n> --host <addr>  Dev server address (plugin default 4590, theme default 4173)
  --open                    Open the preview in your browser (plugin dev)
  --file <path[:line]>      open: file to reveal (also a positional argument)
  --editor <command>        open: editor command (default: $SELDOES_EDITOR, code, cursor, windsurf)
  --terminal                open: launch an OS terminal at the project root instead
  --print                   open: print the launch command without running it
  --app-url <url>           SellDesk instance (or SELLDOES_APP_URL; saved by login)
  --token <token>           Developer token sk_dev_… (or SELLDOES_DEV_TOKEN; saved by login)
  --store <id|slug>         Store id (plugin publish) or store slug (theme dev/apply)
  --notes <text>            Publish: release notes
  --currency <code>         Publish: price currency (default USD)
  --trial-days <n>          Publish: marketplace trial days (0-90)
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
  // Bare `selldoes` = the web workspace (flags like --no-open pass through).
  if (argv.length === 0 || argv[0].startsWith("--")) argv.unshift("workspace")
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

      case "workspace": {
        await workspaceCommand(args, flags)
        return
      }

      case "ask": {
        const { askCommand } = await import("./ask.mjs")
        await askCommand(args, flags)
        return
      }

      case "import": {
        const { importCommand } = await import("./home.mjs")
        await importCommand(args, flags)
        return
      }

      case "open": {
        const { openCommand } = await import("./open.mjs")
        await openCommand(args, flags)
        return
      }

      case "login":
      case "logout":
      case "whoami": {
        const account = await import("./account.mjs")
        if (command === "login") return account.loginCommand(args, flags)
        if (command === "logout") return account.logoutCommand(args, flags)
        return account.whoamiCommand(args, flags)
      }

      case "packages": {
        const { packagesCommand } = await import("./account.mjs")
        await packagesCommand(args, flags)
        return
      }

      case "pull": {
        const { pullCommand } = await import("./account.mjs")
        await pullCommand(args, flags)
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

/** Starts the web workspace (bare `selldoes` / `selldoes workspace`). */
async function workspaceCommand(args, flags) {
  const { startWorkspaceServer } = await import("./workspace-server.mjs")
  const devMode = flags.dev === true || process.env.SELLDOES_SDK_DEV === "1"
  const server = await startWorkspaceServer({
    port: flags.port ? Number(flags.port) : 4590,
    dev: devMode,
  })
  console.log(`\n  Selldoes workspace → ${server.url}`)
  console.log(devMode ? "  SDK-dev mode — dev-ui served by Vite (hot reload)" : "  Web workspace — projects, previews, AI assistant")
  console.log("  Ctrl+C stops the server and any running previews\n")
  if (flags["no-open"] !== true) openBrowser(server.url)
}

async function runProjectCommand(command, args, flags) {
  const projectDir = resolveProjectDir(flags)
  const kind = projectKind(projectDir)

  if (!kind) {
    if (flags.dir !== undefined) {
      die(`No plugin.json or manifest.json in ${projectDir}`)
    }
    // Not inside a project — open the workspace. `dev` starts the web
    // workspace; other commands let the terminal launcher pick a project and
    // then run the command on it.
    if (command === "dev") {
      if (!process.stdin.isTTY) {
        die("No plugin.json or manifest.json here — run `selldoes` in a terminal to open the workspace, or pass --dir <path>.")
      }
      console.log("No plugin.json or manifest.json in this folder — starting the web workspace.\n")
      return workspaceCommand([], flags)
    }
    if (!process.stdin.isTTY) {
      die(`No plugin.json or manifest.json here — pass --dir <path>, or run \`selldoes ${command}\` inside a project.`)
    }
    console.log(`No plugin.json or manifest.json in this folder — pick a project to run \`${command}\` on.\n`)
    const { homeCommand } = await import("./home.mjs")
    await homeCommand([], flags, {
      commandLabel: command,
      onSelect: (project) => runProjectCommand(command, [], { ...flags, dir: project.path }),
    })
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
      const { developerAuth, loadConfig } = await import("./account.mjs")
      const cfg = loadConfig()
      const auth = developerAuth(flags, cfg)
      const result = await publishPlugin({
        pluginDir: projectDir,
        appUrl: flags["app-url"] ? String(flags["app-url"]) : auth.appUrl,
        token: flags.token ? String(flags.token) : auth.token ?? undefined,
        notes: flags.notes ? String(flags.notes) : undefined,
        price: Number(flags.price ?? 0) || 0,
        currency: flags.currency ? String(flags.currency) : "USD",
        billingPeriod: String(flags.billing ?? "one_time"),
        trialDays: Number(flags["trial-days"] ?? 0) || 0,
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
