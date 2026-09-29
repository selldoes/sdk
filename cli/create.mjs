import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as prompts from "@clack/prompts"
import { die } from "./util.mjs"

const PACKAGE = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))

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
    const to = path.join(toDir, targetName)
    if (entry.isDirectory()) {
      copyTemplate(from, to, replacements)
      continue
    }
    let content = fs.readFileSync(from, "utf8")
    for (const [token, value] of Object.entries(replacements)) content = content.split(token).join(value)
    fs.writeFileSync(to, content)
  }
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
    if (assumeYes) {
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

  const slug = toSlug(dir)
  if (!slug || slug.length < 2) die(`Cannot derive a project name from "${dir}"`)

  const targetDir = path.resolve(dir)
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0 && flags.force !== true) {
    die(`${path.relative(process.cwd(), targetDir) || "."} is not empty (use --force to overwrite)`)
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
  if (!/^\d+\.\d+\.\d+/.test(version)) die(`"${version}" is not a valid version (expected e.g. 0.1.0)`)

  let withUi = true
  let uiFlavor = "js"
  if (kind === "plugin") {
    if (flags["no-ui"] === true) {
      withUi = false
    } else if (typeof flags.ui === "string") {
      uiFlavor = String(flags.ui).toLowerCase() === "react" ? "react" : "js"
    } else if (flags.ui === true) {
      withUi = true
    } else if (interactive) {
      const answer = await prompts.confirm({ message: "Add a dashboard UI?", initialValue: true })
      if (prompts.isCancel(answer)) cancel()
      withUi = answer
      if (withUi) {
        const flavor = await prompts.select({
          message: "UI style",
          options: [
            { value: "js", label: "Plain JS", hint: "no build step — ui/index.html + app.js" },
            { value: "react", label: "React + TypeScript", hint: "bundled by esbuild, supports npm packages" },
          ],
        })
        if (prompts.isCancel(flavor)) cancel()
        uiFlavor = String(flavor)
      }
    }
  }

  let install = true
  if (flags["no-install"] === true) install = false
  else if (interactive) {
    const answer = await prompts.confirm({ message: "Install dependencies now?", initialValue: true })
    if (prompts.isCancel(answer)) cancel()
    install = answer
  }

  const name = toTitle(slug)
  const templateDir = fileURLToPath(new URL(`../templates/${kind}/`, import.meta.url))
  const replacements = {
    __PLUGIN_SLUG__: slug,
    __PLUGIN_NAME__: name,
    __THEME_SLUG__: slug,
    __THEME_NAME__: name,
    __VERSION__: version,
    __SELLDOES_VERSION__: PACKAGE.version,
  }
  copyTemplate(templateDir, targetDir, replacements)

  if (kind === "plugin" && withUi && uiFlavor === "react") {
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

  if (kind === "plugin" && !withUi) {
    fs.rmSync(path.join(targetDir, "ui"), { recursive: true, force: true })
    const manifestPath = path.join(targetDir, "plugin.json")
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    delete manifest.ui
    delete manifest.dashboardPages
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
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
    })
    if (result.status === 0) {
      spinner.stop("Dependencies installed")
    } else {
      spinner.stop("Install failed — run `npm install` manually")
      const output = `${result.error?.message || ""}\n${result.stdout || ""}${result.stderr || ""}`.trim()
      if (output) console.error(output.split("\n").slice(-6).join("\n"))
    }
  }

  const relative = path.relative(process.cwd(), targetDir) || "."
  const lines = [`Created ${name} in ${relative}/`, "", "Next steps:", `  cd ${relative}`]
  if (!install) lines.push("  npm install")
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
