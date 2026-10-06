import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { packageManagerEnv } from "./util.mjs"
import * as prompts from "@clack/prompts"
import { die } from "./util.mjs"

const PACKAGE = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))

/** Strict-enough semver: x.y.z with an optional -prerelease / +build suffix. */
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

/**
 * Starting points shown in `selldoes create` and the workspace's New-workspace
 * dialog. Each entry is a complete template directory; `dir` picks it under
 * `templates/`. Keep this list in sync with the templates on disk — the
 * workspace reads it over the API so the UI can never drift.
 */
export const EXAMPLES = {
  plugin: [
    {
      id: "notes",
      name: "Notes dashboard",
      desc: "Manifest, entry and a plain-JS dashboard UI wired to a notes API route — the canonical starter.",
      dir: "plugin",
      withUi: true,
    },
    {
      id: "react",
      name: "React dashboard",
      desc: "The same starter with a TypeScript + React UI, bundled by esbuild on every save.",
      dir: "plugin",
      withUi: true,
      reactUi: true,
      badge: "runs npm install",
    },
    {
      id: "blank",
      name: "Blank plugin",
      desc: "Manifest + entry file only. Add hooks, jobs and a dashboard UI whenever you need them.",
      dir: "plugin",
      withUi: false,
    },
    {
      id: "importer",
      name: "Web / product importer",
      desc: "Scans a listing page, parses product pages and imports them with chunked jobs, artwork and optional AI copy. A complete scraping pipeline.",
      dir: "plugin-importer",
      withUi: true,
      badge: "jobs + scraping",
    },
    {
      id: "ai-copy",
      name: "AI product copy",
      desc: "Walks the catalog and rewrites descriptions and bullet points through the store's AI provider — one product per step.",
      dir: "plugin-ai-copy",
      withUi: false,
      badge: "ctx.ai",
    },
    {
      id: "delivery",
      name: "Digital delivery",
      desc: "Adds a delivery section to the storefront's order page: download links, license keys and instructions.",
      dir: "plugin-delivery",
      withUi: false,
      badge: "order page",
    },
    {
      id: "widget",
      name: "Storefront widget",
      desc: "A chat bubble on every storefront page that collects visitor messages through a public route into the dashboard.",
      dir: "plugin-widget",
      withUi: true,
      badge: "public routes",
    },
  ],
  theme: [
    {
      id: "starter",
      name: "Starter storefront",
      desc: "A clean home and product page using the theme hooks and components — the starting point for a custom design.",
      dir: "theme",
    },
    {
      id: "editorial",
      name: "Editorial",
      desc: "Magazine-style landing page: serif headline, featured story and a quiet two-column catalogue.",
      dir: "theme-editorial",
    },
    {
      id: "bold",
      name: "Bold drop",
      desc: "Dark, high-contrast storefront with a promo banner and oversized type — built for sales and drops.",
      dir: "theme-bold",
    },
    {
      id: "minimal",
      name: "Minimal",
      desc: "Quiet type, generous whitespace and a five-column catalogue. The products do the talking.",
      dir: "theme-minimal",
    },
  ],
}

/** Catalog entries for the create flows: id, name, description, badge, UI. */
export function listExamples(kind) {
  const entries = EXAMPLES[kind === "theme" ? "theme" : "plugin"] ?? []
  return entries.map(({ id, name, desc, badge, withUi, reactUi }) => ({
    id,
    name,
    description: desc,
    badge: badge ?? null,
    ui: reactUi ? "react" : withUi ? "js" : "none",
  }))
}

/**
 * Resolves the example a project should start from. An explicit `example` id
 * wins; otherwise the legacy `withUi` / `uiFlavor` flags pick the pre-example
 * defaults (blank / notes / react) so old callers keep working.
 */
export function resolveExample(kind, example, { withUi = true, uiFlavor = "js" } = {}) {
  const catalog = EXAMPLES[kind === "theme" ? "theme" : "plugin"]
  if (example) {
    const found = catalog.find((entry) => entry.id === example)
    if (!found) throw new Error(`Unknown ${kind} example "${example}" (available: ${catalog.map((entry) => entry.id).join(", ")})`)
    return found
  }
  if (kind === "theme") return catalog.find((entry) => entry.id === "starter")
  if (!withUi) return catalog.find((entry) => entry.id === "blank")
  if (uiFlavor === "react") return catalog.find((entry) => entry.id === "react")
  return catalog.find((entry) => entry.id === "notes")
}

function cancel() {
  prompts.cancel("Cancelled")
  process.exit(0)
}

function toSlug(value) {
  return path
    .basename(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function toTitle(slug) {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function copyTemplate(fromDir, toDir, replacements) {
  fs.mkdirSync(toDir, { recursive: true })
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, entry.name)
    // npm strips `.gitignore` from tarballs, so templates ship it as `gitignore`
    // and it is restored on scaffold.
    const targetName = entry.name === "gitignore" ? ".gitignore" : entry.name
    const target = path.join(toDir, targetName)
    if (entry.isDirectory()) {
      copyTemplate(from, target, replacements)
      continue
    }
    let content = fs.readFileSync(from, "utf8")
    for (const [token, value] of Object.entries(replacements)) content = content.split(token).join(value)
    fs.writeFileSync(target, content)
  }
}

/**
 * Scaffolds a plugin/theme project from the bundled templates. Shared by the
 * interactive `selldoes create` flow and the web workspace's "Create new".
 */
export async function scaffoldProject({
  kind = "plugin",
  dir,
  slug: slugOverride,
  name: nameOverride,
  version = "0.1.0",
  example,
  withUi = true,
  uiFlavor = "js",
  install = false,
  force = false,
  description,
  author,
  category,
  icon,
  tags,
  permissions,
  color,
}) {
  if (!dir) throw new Error("scaffoldProject: dir is required")
  if (!SEMVER.test(String(version))) throw new Error(`"${version}" is not a valid version (expected e.g. 0.1.0)`)

  const slug = toSlug(slugOverride || dir)
  if (!slug || slug.length < 2) throw new Error(`Cannot derive a project name from "${dir}"`)
  const targetDir = path.resolve(dir)
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0 && !force) {
    throw new Error(`${path.relative(process.cwd(), targetDir) || "."} is not empty (use --force to overwrite)`)
  }

  const name = nameOverride ? String(nameOverride).trim() : toTitle(slug)
  const spec = resolveExample(kind, example, { withUi, uiFlavor })
  const templateDir = fileURLToPath(new URL(`../templates/${spec.dir}/`, import.meta.url))
  const replacements = {
    __PLUGIN_SLUG__: slug,
    __PLUGIN_NAME__: name,
    __THEME_SLUG__: slug,
    __THEME_NAME__: name,
    __VERSION__: version,
    __SELLDOES_VERSION__: PACKAGE.version,
    // JSON-escaped so quotes/newlines in free text can't break the manifest.
    __PLUGIN_DESCRIPTION__: JSON.stringify(description ? String(description) : "A Selldoes plugin.").slice(1, -1),
    __PLUGIN_AUTHOR__: JSON.stringify(author ? String(author) : "Your name").slice(1, -1),
    __PLUGIN_CATEGORY__: JSON.stringify(category ? String(category) : "other").slice(1, -1),
  }
  copyTemplate(templateDir, targetDir, replacements)

  if (kind === "plugin" && spec.reactUi) {
    // Swap the plain-JS UI for the React + TypeScript one, and wire up the
    // dependencies esbuild needs to bundle it (ui/src → assets/index.js).
    fs.rmSync(path.join(targetDir, "ui"), { recursive: true, force: true })
    copyTemplate(fileURLToPath(new URL("../templates/plugin-react-ui/", import.meta.url)), path.join(targetDir, "ui"), replacements)
    const packagePath = path.join(targetDir, "package.json")
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"))
    pkg.dependencies = { react: "^19.0.0", "react-dom": "^19.0.0", ...(pkg.dependencies ?? {}) }
    pkg.devDependencies = {
      ...(pkg.devDependencies ?? {}),
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
    }
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
    fs.writeFileSync(
      path.join(targetDir, "jsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "Bundler",
            lib: ["ES2020", "DOM", "DOM.Iterable"],
            jsx: "react-jsx",
            types: ["node"],
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["index.js", "ui/src/**/*.ts", "ui/src/**/*.tsx"],
        },
        null,
        2,
      )}\n`,
    )
  }

  if (kind === "plugin" && !spec.withUi) {
    fs.rmSync(path.join(targetDir, "ui"), { recursive: true, force: true })
  }

  // Patch manifest metadata the template can't know about (single write).
  if (kind === "plugin") {
    const manifestPath = path.join(targetDir, "plugin.json")
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    let changed = false
    if (!spec.withUi) {
      delete manifest.ui
      delete manifest.dashboardPages
      changed = true
    }
    if (icon) {
      manifest.icon = String(icon)
      changed = true
    }
    if (Array.isArray(tags) && tags.length > 0) {
      manifest.tags = tags.map(String)
      changed = true
    }
    if (Array.isArray(permissions)) {
      manifest.permissions = permissions.map(String)
      changed = true
    }
    if (changed) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  if (install) {
    const spinner = prompts.spinner()
    spinner.start("Installing dependencies…")
    // A single command string with `shell: true` — Node on Windows refuses to
    // spawn `npm.cmd` directly (EINVAL) and deprecates args-with-shell.
    const result = spawnSync("npm install --no-audit --no-fund", {
      cwd: targetDir,
      encoding: "utf8",
      shell: true,
      windowsHide: true,
      // Inherited npm_config_* (e.g. allow-scripts) breaks project installs.
      env: packageManagerEnv(),
    })
    if (result.status === 0) {
      spinner.stop("Dependencies installed")
    } else {
      spinner.stop("Install failed — run `npm install` manually")
      const output = `${result.error?.message || ""}\n${result.stdout || ""}${result.stderr || ""}`.trim()
      if (output) console.error(output.split("\n").slice(-6).join("\n"))
    }
  }

  // Register the new project in the workspace so `selldoes` lists it.
  try {
    const { touchProject } = await import("./workspace.mjs")
    touchProject({ dir: targetDir, kind, source: "create", color })
  } catch {
    // best-effort
  }

  return { targetDir, slug, name, kind, example: spec.id }
}

export async function createCommand(args, flags) {
  const assumeYes = flags.yes === true || flags.y === true || args.includes("-y")
  const interactive = Boolean(process.stdin.isTTY) && !assumeYes
  const kindFlag = flags.plugin === true ? "plugin" : flags.theme === true ? "theme" : null
  const positional = args.filter((arg) => !arg.startsWith("-"))

  if (flags.plugin === true && flags.theme === true) die("Pass either --plugin or --theme, not both")

  prompts.intro("selldoes")

  let kind = kindFlag
  if (!kind) {
    if (assumeYes || flags.ai !== undefined) {
      // AI scaffolding is plugin-only for now — don't ask.
      kind = "plugin"
    } else if (!interactive) {
      die("Non-interactive shell — pass --plugin or --theme (or -y for defaults)")
    } else {
      const answer = await prompts.select({
        message: "What do you want to build?",
        options: [
          { value: "plugin", label: "Plugin", hint: "extend the dashboard and storefront" },
          { value: "theme", label: "Theme", hint: "a full-page storefront design" },
        ],
      })
      if (prompts.isCancel(answer)) cancel()
      kind = answer
    }
  }

  const defaultName = kind === "plugin" ? "my-plugin" : "my-theme"
  let dir = positional[0]
  if (!dir) {
    if (!interactive) {
      dir = defaultName
    } else {
      const answer = await prompts.text({
        message: "Project name",
        placeholder: defaultName,
        defaultValue: defaultName,
      })
      if (prompts.isCancel(answer)) cancel()
      dir = String(answer || defaultName).trim()
    }
  }

  // ── AI scaffold: `selldoes create my-plugin --ai "describe it"` ────────────
  if (flags.ai !== undefined && kind === "plugin") {
    let description = flags.ai === true ? null : String(flags.ai)
    if (!description) {
      if (!interactive) die('Pass a description: selldoes create <dir> --ai "…"')
      const answer = await prompts.text({ message: "Describe the plugin you want", placeholder: "e.g. a plugin that…", defaultValue: "" })
      if (prompts.isCancel(answer)) cancel()
      description = String(answer ?? "").trim()
    }
    if (!description) die("Empty description — say what the plugin should do")

    let config = {}
    try {
      config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "selldoes.config.json"), "utf8"))
    } catch {
      // no local assistant config — environment keys apply
    }

    const spinner = prompts.spinner()
    spinner.start("Generating your plugin with AI…")
    let result
    try {
      const { scaffoldWithAi } = await import("./plugin/ai-scaffold.mjs")
      result = await scaffoldWithAi({
        prompt: description,
        dir: path.resolve(dir),
        config,
        log: (line) => spinner.message(String(line).slice(0, 90)),
      })
      spinner.stop(`Generated ${result.name} — ${result.files.length} file(s)`)
    } catch (error) {
      spinner.stop("AI scaffold failed")
      die(error.message)
    }
    const relative = path.relative(process.cwd(), result.dir) || "."
    prompts.outro(
      [
        `Created ${result.name} (${result.slug}) in ${relative}/`,
        result.summary ? `\n${result.summary}` : "",
        "",
        "Next steps:",
        `  cd ${relative}`,
        "  npm install        # only if the plugin declares dependencies",
        "  npx selldoes dev   # preview it — the AI assistant is right there to iterate",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    return
  }

  let version = flags.version ? String(flags.version) : null
  if (!version) {
    if (!interactive) {
      version = "0.1.0"
    } else {
      const answer = await prompts.text({ message: "Version", placeholder: "0.1.0", defaultValue: "0.1.0" })
      if (prompts.isCancel(answer)) cancel()
      version = String(answer || "0.1.0").trim()
    }
  }
  if (!SEMVER.test(version)) die(`"${version}" is not a valid version (expected e.g. 0.1.0)`)

  // ── Starting example ────────────────────────────────────────────────────────
  // `--example <id>` picks one explicitly; otherwise interactive users choose
  // from the catalog and non-interactive runs fall back to the defaults.
  let example = typeof flags.example === "string" ? String(flags.example) : null
  if (!example && interactive && !assumeYes) {
    const catalog = EXAMPLES[kind === "theme" ? "theme" : "plugin"]
    const answer = await prompts.select({
      message: kind === "theme" ? "Start from an example theme" : "Start from an example plugin",
      options: catalog.map((entry) => ({ value: entry.id, label: entry.name, hint: entry.desc })),
      initialValue: kind === "theme" ? "starter" : "notes",
    })
    if (prompts.isCancel(answer)) cancel()
    example = String(answer)
  }

  let withUi = true
  let uiFlavor = "js"
  if (kind === "plugin") {
    if (flags["no-ui"] === true) withUi = false
    else if (typeof flags.ui === "string") uiFlavor = String(flags.ui).toLowerCase() === "react" ? "react" : "js"
  }

  let description = flags.description !== undefined ? String(flags.description).trim() : null
  if (description === null && interactive) {
    const answer = await prompts.text({ message: "Description (optional)", placeholder: "A Selldoes plugin.", defaultValue: "" })
    if (prompts.isCancel(answer)) cancel()
    description = String(answer ?? "").trim()
  }

  let author = flags.author !== undefined ? String(flags.author).trim() : null
  if (author === null && interactive) {
    const answer = await prompts.text({ message: "Author (optional)", placeholder: "Your name", defaultValue: "" })
    if (prompts.isCancel(answer)) cancel()
    author = String(answer ?? "").trim()
  }

  const category = flags.category !== undefined ? String(flags.category).trim() : undefined
  const icon = flags.icon !== undefined ? String(flags.icon).trim() : undefined
  const tags =
    typeof flags.tags === "string"
      ? flags.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : undefined
  const permissions =
    typeof flags.permissions === "string"
      ? flags.permissions
          .split(",")
          .map((permission) => permission.trim())
          .filter(Boolean)
      : undefined

  let install = true
  if (flags["no-install"] === true) install = false
  else if (interactive) {
    const answer = await prompts.confirm({ message: "Install dependencies now?", initialValue: true })
    if (prompts.isCancel(answer)) cancel()
    install = answer
  }

  const { targetDir, name } = await scaffoldProject({
    kind,
    dir,
    version,
    example,
    withUi,
    uiFlavor,
    install,
    force: flags.force === true,
    description: description || undefined,
    author: author || undefined,
    category,
    icon,
    tags,
    permissions,
  })

  const relative = path.relative(process.cwd(), targetDir) || "."
  const lines = [`Created ${name} in ${relative}/`, "", "Next steps:", `  cd ${relative}`]
  if (!install) lines.push("  npm install")
  lines.push("  (or run `selldoes` anywhere — it's in your workspace now)")
  if (kind === "plugin") {
    lines.push("  npx selldoes dev", "", "Docs: https://selldoes.com/docs/plugins")
  } else {
    lines.push(
      "  npx selldoes login --api-key sk_…    # Dashboard → Settings → API Keys",
      "  npx selldoes dev --store <slug>",
      "",
      "Docs: https://selldoes.com/docs/themes"
    )
  }
  prompts.outro(lines.join("\n"))
}
