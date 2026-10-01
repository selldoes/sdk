import fs from "node:fs"
import path from "node:path"
import { validatePluginDir } from "../validate.mjs"

const MAX_SNAPSHOTS = 20

/**
 * Snapshots every write (manifest edits, AI file edits) so the developer can
 * always undo. Each snapshot is a folder under `<devDir>/undo/<timestamp>/`
 * holding copies of the touched files plus a meta.json describing them.
 */
export class SnapshotStore {
  constructor({ pluginDir, devDir, log = () => {} }) {
    this.pluginDir = pluginDir
    this.devDir = devDir
    this.root = path.join(devDir, "undo")
    this.log = log
  }

  ensure() {
    fs.mkdirSync(this.root, { recursive: true })
  }

  /** Lists snapshot folders, oldest first. */
  list() {
    if (!fs.existsSync(this.root)) return []
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  }

  count() {
    return this.list().length
  }

  /**
   * Copies the given plugin-relative files into a new snapshot.
   * Returns the snapshot name.
   */
  create({ reason, files = [] }) {
    this.ensure()
    const name = `${Date.now()}-${String(reason).replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`
    const target = path.join(this.root, name)
    fs.mkdirSync(target, { recursive: true })
    const entries = []
    for (const relative of files) {
      const full = path.resolve(this.pluginDir, relative)
      if (!full.startsWith(path.resolve(this.pluginDir) + path.sep) && full !== path.resolve(this.pluginDir, "plugin.json")) {
        continue
      }
      const existed = fs.existsSync(full) && fs.statSync(full).isFile()
      if (existed) {
        const copy = path.join(target, relative)
        fs.mkdirSync(path.dirname(copy), { recursive: true })
        fs.copyFileSync(full, copy)
      }
      entries.push({ path: relative, existed })
    }
    fs.writeFileSync(
      path.join(target, "meta.json"),
      JSON.stringify({ reason, at: new Date().toISOString(), files: entries }, null, 2),
    )
    this.prune()
    return name
  }

  prune() {
    const snapshots = this.list()
    for (const name of snapshots.slice(0, Math.max(0, snapshots.length - MAX_SNAPSHOTS))) {
      fs.rmSync(path.join(this.root, name), { recursive: true, force: true })
    }
  }

  /** Lists snapshot folders with their meta, oldest first. */
  listDetailed() {
    const names = this.list()
    const out = []
    for (const name of names) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(this.root, name, "meta.json"), "utf8"))
        out.push({ name, ...meta })
      } catch {
        out.push({ name })
      }
    }
    return out
  }

  /** Restores a named snapshot. Returns its meta or null. */
  restore(name) {
    if (!name) return null
    const folder = path.join(this.root, String(name))
    if (!fs.existsSync(folder)) return null
    const meta = JSON.parse(fs.readFileSync(path.join(folder, "meta.json"), "utf8"))
    for (const entry of meta.files ?? []) {
      const full = path.resolve(this.pluginDir, entry.path)
      if (!full.startsWith(path.resolve(this.pluginDir) + path.sep)) continue
      const copy = path.join(folder, entry.path)
      if (entry.existed && fs.existsSync(copy)) {
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.copyFileSync(copy, full)
      } else if (!entry.existed && fs.existsSync(full)) {
        fs.rmSync(full, { force: true })
      }
    }
    fs.rmSync(folder, { recursive: true, force: true })
    return meta
  }

  /** Restores the most recent snapshot. Returns its meta or null. */
  restoreLatest() {
    const snapshots = this.list()
    return this.restore(snapshots[snapshots.length - 1])
  }
}

/**
 * Reads and writes plugin.json, validating after every write.
 */
export class ManifestStore {
  constructor({ pluginDir, devDir, log = () => {} }) {
    this.pluginDir = pluginDir
    this.path = path.join(pluginDir, "plugin.json")
    this.snapshots = new SnapshotStore({ pluginDir, devDir, log })
    this.log = log
  }

  read() {
    return JSON.parse(fs.readFileSync(this.path, "utf8"))
  }

  validation() {
    const { errors, warnings } = validatePluginDir(this.pluginDir)
    return { errors, warnings }
  }

  /** Writes plugin.json (with a snapshot first) and returns the new state. */
  write(next) {
    const serialized = `${JSON.stringify(next, null, 2)}\n`
    const current = fs.existsSync(this.path) ? fs.readFileSync(this.path, "utf8") : ""
    if (serialized === current) {
      return { manifest: next, validation: this.validation() }
    }
    this.snapshots.create({ reason: "plugin.json", files: ["plugin.json"] })
    fs.writeFileSync(this.path, serialized)
    this.log("plugin.json saved")
    return { manifest: next, validation: this.validation() }
  }

  undo() {
    const meta = this.snapshots.restoreLatest()
    if (!meta) return null
    this.log(`restored ${meta.reason} snapshot from ${meta.at}`)
    return this.read()
  }

  snapshotCount() {
    return this.snapshots.count()
  }
}
