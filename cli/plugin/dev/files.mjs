import fs from "node:fs"
import path from "node:path"
import {
  guardPath,
  isEditableName,
  isTextName,
  listProjectFiles,
  normalizeRelative,
  projectTree,
  readTextFile,
  searchProject,
  writeTextFile,
} from "./project-files.mjs"

/**
 * The editor's backend: tree, read/write/create/rename/delete, project search,
 * SDK type definitions and snapshot history. Every mutation snapshots first
 * (so History can always undo it) and then rebuilds, returning validation +
 * build status to the client.
 */
export function createFilesService({ pluginDir, sdkRoot, snapshots, rebuild, log = () => {} }) {
  const snapshot = (reason, files) => {
    try {
      snapshots?.create({ reason, files })
    } catch (error) {
      log(`snapshot failed (${reason}): ${error.message}`)
    }
  }

  const rebuildAfter = async () => {
    try {
      await rebuild()
      return { rebuildError: null }
    } catch (error) {
      return { rebuildError: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    projectDir: pluginDir,

    tree() {
      return projectTree(pluginDir)
    },

    read(relative) {
      return readTextFile(pluginDir, relative)
    },

    async write(relative, content) {
      const normalized = normalizeRelative(relative)
      if (!normalized) throw new Error("A file path is required")
      if (!isTextName(normalized)) throw new Error("Only text files can be edited in the preview")
      const full = guardPath(pluginDir, normalized)
      if (fs.existsSync(full) && fs.statSync(full).isFile() && fs.readFileSync(full, "utf8") === content) {
        return { path: normalized, size: Buffer.byteLength(content, "utf8"), unchanged: true, rebuildError: null }
      }
      snapshot(`edit ${normalized}`.slice(0, 40), [normalized])
      const result = writeTextFile(pluginDir, normalized, content)
      log(`saved ${normalized}`)
      return { ...result, ...(await rebuildAfter()) }
    },

    create(relative, type = "file") {
      const normalized = normalizeRelative(relative)
      if (!normalized) throw new Error("A path is required")
      const full = guardPath(pluginDir, normalized)
      if (fs.existsSync(full)) throw new Error(`${normalized} already exists`)
      if (type === "dir") {
        fs.mkdirSync(full, { recursive: true })
        log(`created folder ${normalized}`)
        return { path: normalized, type: "dir" }
      }
      if (!isEditableName(normalized)) throw new Error("Only text files can be created in the preview")
      snapshot(`new ${normalized}`.slice(0, 40), [normalized])
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, "")
      log(`created ${normalized}`)
      return { path: normalized, type: "file" }
    },

    rename(from, to) {
      const source = normalizeRelative(from)
      const target = normalizeRelative(to)
      if (!source || !target) throw new Error("Both paths are required")
      const sourceFull = guardPath(pluginDir, source)
      const targetFull = guardPath(pluginDir, target)
      if (!fs.existsSync(sourceFull)) throw new Error(`${source} does not exist`)
      if (fs.existsSync(targetFull)) throw new Error(`${target} already exists`)
      snapshot(`rename ${source}`.slice(0, 40), [source, target])
      fs.mkdirSync(path.dirname(targetFull), { recursive: true })
      fs.renameSync(sourceFull, targetFull)
      log(`renamed ${source} → ${target}`)
      return { from: source, to: target }
    },

    remove(relative) {
      const normalized = normalizeRelative(relative)
      if (!normalized) throw new Error("A path is required")
      const full = guardPath(pluginDir, normalized)
      if (!fs.existsSync(full)) throw new Error(`${normalized} does not exist`)
      const stat = fs.statSync(full)
      const files = stat.isDirectory()
        ? listProjectFiles(pluginDir, { depth: 12 }).map((file) => file.path).filter((file) => file === normalized || file.startsWith(`${normalized}/`))
        : [normalized]
      snapshot(`delete ${normalized}`.slice(0, 40), files.length ? files : [normalized])
      fs.rmSync(full, { recursive: true, force: true })
      log(`deleted ${normalized}`)
      return { path: normalized }
    },

    search(query, options = {}) {
      return searchProject(pluginDir, { query, ...options })
    },

    sdkTypes() {
      const candidates = [
        path.join(sdkRoot, "dist", "index.d.ts"),
        path.join(sdkRoot, "src", "index.ts"),
      ]
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return { path: candidate, content: fs.readFileSync(candidate, "utf8") }
      }
      return { path: null, content: "" }
    },

    snapshots() {
      if (!snapshots) return []
      return snapshots.listDetailed()
    },

    restoreSnapshot(name) {
      if (!snapshots) throw new Error("Snapshots are unavailable")
      const meta = snapshots.restore(String(name ?? ""))
      if (!meta) throw new Error("Snapshot not found")
      log(`restored snapshot ${name}`)
      return meta
    },
  }
}
