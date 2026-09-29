import fs from "node:fs"
import path from "node:path"

const EMPTY = {
  visits: {},
  jobs: { count: 0 },
  routes: { count: 0 },
  hooks: { count: 0 },
  settings: {},
}

/**
 * Persisted developer state: visited pages (drives the checklist), successful
 * job/route/hook runs (drives the checklist) and the settings form values for
 * the host-page preview.
 */
export class DevState {
  constructor({ file }) {
    this.file = file
    this.data = JSON.parse(JSON.stringify(EMPTY))
    this.load()
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const stored = JSON.parse(fs.readFileSync(this.file, "utf8"))
        this.data = {
          visits: stored.visits ?? {},
          jobs: { count: 0, ...(stored.jobs ?? {}) },
          routes: { count: 0, ...(stored.routes ?? {}) },
          hooks: { count: 0, ...(stored.hooks ?? {}) },
          settings: stored.settings ?? {},
        }
      }
    } catch {
      // start fresh on a corrupt file
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }

  visit(page) {
    if (!page || this.data.visits[page] === true) return
    this.data.visits[page] = true
    this.save()
  }

  record(kind, detail = {}) {
    const bucket = this.data[kind]
    if (!bucket) return
    bucket.count = (bucket.count ?? 0) + 1
    bucket.lastAt = new Date().toISOString()
    if (kind === "jobs" && detail.type) bucket.lastType = detail.type
    if (kind === "routes" && detail.path) bucket.lastPath = detail.path
    if (kind === "hooks" && detail.hook) bucket.lastHook = detail.hook
    this.save()
  }

  settings() {
    return this.data.settings ?? {}
  }

  setSettings(values) {
    this.data.settings = values ?? {}
    this.save()
  }
}
