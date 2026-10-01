import fs from "node:fs"
import path from "node:path"
import * as prompts from "@clack/prompts"
import { die, openBrowser } from "./util.mjs"
import {
  detectKind,
  getProject,
  listProjects,
  normalizePath,
  projectMeta,
  relativeTime,
  removeProject,
  touchProject,
} from "./workspace.mjs"

/**
 * The workspace front door.
 *
 *   selldoes                 → home (bare command = the launcher)
 *   selldoes home            → the launcher
 *   selldoes import <path>   → register an existing project
 *
 * Plugin/theme projects live anywhere on disk; this launcher is what lets the
 * SDK be "the place you develop from" instead of each plugin folder.
 */

function cancel() {
  prompts.cancel("Cancelled")
  process.exit(0)
}

/**
 * Validates a candidate project directory and registers it.
 * Throws Error with a user-facing message when the folder cannot be a project.
 */
export function importProject(target, { source = "folder" } = {}) {
  const dir = normalizePath(target)
  if (!fs.existsSync(dir)) throw new Error(`No such folder: ${dir}`)
  if (!fs.statSync(dir).isDirectory()) throw new Error(`Not a folder: ${dir}`)
  const kind = detectKind(dir)
  if (!kind) throw new Error(`No plugin.json or manifest.json in ${dir}`)
  const manifestFile = path.join(dir, kind === "theme" ? "manifest.json" : "plugin.json")
  try {
    JSON.parse(fs.readFileSync(manifestFile, "utf8"))
  } catch (error) {
    throw new Error(`${path.basename(manifestFile)} is not valid JSON: ${error.message}`)
  }
  return touchProject({ dir, kind, source })
}

/** Opens a project the same way `selldoes dev` would. */
async function openProject(project, flags = {}) {
  if (project.missing) {
    console.error(`\n  ✗ ${project.path} no longer exists.`)
    console.error("    Remove it from the list with `selldoes home` → Remove.\n")
    return false
  }
  process.chdir(project.path)
  if (project.kind === "theme") {
    console.log(`\n  Theme dev → ${project.path}`)
    console.log("  (theme dev previews against a real store — pass --store <slug>)\n")
    const { themeCommand } = await import("./theme.mjs")
    await themeCommand("dev", [], flags)
    return true
  }
  const { startDevServer } = await import("./plugin/dev/server.mjs")
  const server = await startDevServer({
    pluginDir: project.path,
    port: flags.port ? Number(flags.port) : undefined,
    host: flags.host ? String(flags.host) : undefined,
  })
  touchProject({ dir: project.path, kind: project.kind, source: project.source })
  console.log(`\n  ${project.name} → ${server.url}`)
  console.log("  Press Ctrl+C to stop\n")
  if (flags.open) openBrowser(server.url)
  return true
}

function projectOption(project) {
  const state = project.missing ? "⚠ missing on disk" : relativeTime(project.lastOpenedAt)
  return {
    value: `open:${project.id}`,
    label: `${project.name}`,
    hint: `${project.slug} · ${project.kind} · ${state}`,
  }
}

const ADD_DIVIDER = { value: "divider:add", label: "── Add ──", disabled: true }
const MANAGE_DIVIDER = { value: "divider:manage", label: "── Manage ──", disabled: true }

async function importFlow(flags) {
  let target = flags.dir !== undefined ? String(flags.dir) : null
  if (!target) {
    const answer = await prompts.text({
      message: "Path to the plugin/theme folder",
      placeholder: "C:/projects/my-plugin",
      defaultValue: process.cwd(),
    })
    if (prompts.isCancel(answer)) cancel()
    target = String(answer || "").trim()
  }
  if (!target) die("No path given")
  const project = importProject(target, { source: "folder" })
  prompts.log.success(`Imported ${project.name} (${project.kind}) → ${project.path}`)
  return project
}

async function removeFlow() {
  const projects = listProjects()
  if (projects.length === 0) {
    prompts.log.info("No projects in the workspace yet.")
    return
  }
  const answer = await prompts.select({
    message: "Remove which project from the list? (files are never deleted)",
    options: projects.map((project) => ({
      value: project.id,
      label: project.name,
      hint: project.missing ? "⚠ missing on disk" : project.path,
    })),
  })
  if (prompts.isCancel(answer)) cancel()
  const project = getProject(String(answer))
  removeProject(String(answer))
  prompts.log.success(`Removed ${project?.name ?? "project"} from the list (folder kept on disk).`)
}

export async function homeCommand(args, flags = {}) {
  let accountHint = "connect first: selldoes login --token sk_dev_…"
  try {
    const account = await import("./account.mjs")
    const cfg = account.loadConfig()
    if (cfg.developerToken || process.env.SELLDOES_DEV_TOKEN) {
      accountHint = "pull a package your developer account owns"
    }
  } catch {
    // account module unavailable — keep the generic hint
  }

  if (!process.stdin.isTTY) {
    // Non-interactive shells get a listing, not a hanging prompt.
    const projects = listProjects()
    if (projects.length === 0) {
      console.log("Workspace is empty — run `selldoes home` in a terminal, or `selldoes import <path>`.")
      return
    }
    console.log("Workspace projects (run `selldoes home` in a terminal for the launcher):")
    for (const project of projects) {
      const state = project.missing ? "⚠ missing on disk" : relativeTime(project.lastOpenedAt)
      console.log(`  • ${project.name}  [${project.kind}]  ${project.path}  (${state})`)
    }
    return
  }
  // Loop so import/create/remove can return to the menu.
  for (;;) {
    const projects = listProjects()
    const options = [
      ...(projects.length > 0 ? projects.map(projectOption) : [{ value: "none", label: "No projects yet", hint: "import or create one below", disabled: true }]),
      ADD_DIVIDER,
      { value: "import", label: "Import existing plugin/theme…", hint: "register a folder that already has plugin.json / manifest.json" },
      { value: "create", label: "Create new plugin/theme…", hint: "scaffold from a template" },
      { value: "packages", label: "Your packages (Selldoes account)…", hint: accountHint },
      ...(projects.length > 0
        ? [MANAGE_DIVIDER, { value: "remove", label: "Remove a project from the list…", hint: "untracks it — files stay on disk" }]
        : []),
    ]

    const answer = await prompts.select({
      message: "Workspace — recent projects",
      options,
    })
    if (prompts.isCancel(answer)) cancel()
    const choice = String(answer)

    if (choice.startsWith("open:")) {
      const project = getProject(choice.slice(5))
      if (!project) {
        prompts.log.warn("That project is no longer in the workspace.")
        continue
      }
      await openProject(project, flags)
      return
    }

    if (choice === "import") {
      const project = await importFlow(flags)
      const openNow = await prompts.confirm({ message: "Open it now?", initialValue: true })
      if (prompts.isCancel(openNow)) cancel()
      if (openNow) {
        await openProject(getProject(project.id) ?? project, flags)
        return
      }
      continue
    }

    if (choice === "create") {
      const { createCommand } = await import("./create.mjs")
      await createCommand([], {}) // create touches the workspace itself
      const projectsAfter = listProjects()
      const created = projectsAfter[0]
      if (created) {
        const openNow = await prompts.confirm({ message: "Open it now?", initialValue: true })
        if (prompts.isCancel(openNow)) cancel()
        if (openNow) {
          await openProject(created, flags)
          return
        }
      }
      continue
    }

    if (choice === "remove") {
      await removeFlow()
      continue
    }

    if (choice === "packages") {
      try {
        const account = await import("./account.mjs")
        const { appUrl, plugins } = await account.listPackages()
        if (plugins.length === 0) {
          prompts.log.info(`No packages on ${appUrl} yet — publish one with \`selldoes publish\`.`)
          continue
        }
        const pick = await prompts.select({
          message: `Your packages on ${appUrl} — pull one to keep developing`,
          options: [
            ...plugins.map((plugin) => ({
              value: plugin.slug,
              label: `${plugin.name}`,
              hint: `${plugin.slug} · v${plugin.latestVersion} · ${plugin.status}`,
            })),
            { value: "__back", label: "Back to workspace" },
          ],
        })
        if (prompts.isCancel(pick)) cancel()
        if (String(pick) === "__back") continue
        const project = await account.pullPackage(String(pick), {})
        const openNow = await prompts.confirm({ message: "Open it now?", initialValue: true })
        if (prompts.isCancel(openNow)) cancel()
        if (openNow) {
          await openProject(getProject(project.id) ?? project, flags)
          return
        }
      } catch (error) {
        prompts.log.error(error instanceof Error ? error.message : String(error))
      }
      continue
    }
  }
}

/** `selldoes import <path>` — non-interactive when a path is given. */
export async function importCommand(args, flags = {}) {
  const target = args.find((arg) => !arg.startsWith("-")) ?? (flags.dir !== undefined ? String(flags.dir) : null)
  if (!target) {
    if (process.stdin.isTTY) {
      const project = await importFlow(flags)
      console.log(`✓ ${project.name} (${project.kind}) added to the workspace`)
      console.log(`  Open it with \`selldoes dev\` from anywhere, or \`selldoes home\`.`)
      return
    }
    die("Usage: selldoes import <path>")
  }
  const project = importProject(target, { source: flags.source ? String(flags.source) : "folder" })
  console.log(`✓ ${project.name} (${project.kind}) added to the workspace`)
  console.log(`  Path: ${project.path}`)
  console.log(`  Open it with \`selldoes dev\` from anywhere, or \`selldoes home\`.`)
}
