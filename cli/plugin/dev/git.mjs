import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

/**
 * Thin git wrapper for the dev shell's Changes panel. Everything runs through
 * the system `git` (no new dependencies); a missing binary or a non-repo
 * answers `{ repo: false }` instead of throwing so the UI can offer init.
 */
export function createGit({ pluginDir }) {
  const git = async (args) => {
    const { stdout } = await run("git", ["-c", "core.quotePath=false", ...args], {
      cwd: pluginDir,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 20_000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" },
    })
    return stdout.replace(/\r\n/g, "\n").replace(/\n+$/, "")
  }

  const isRepo = async () => {
    try {
      return (await git(["rev-parse", "--is-inside-work-tree"])) === "true"
    } catch {
      return false
    }
  }

  const parsePorcelain = (output) => {
    const lines = output.split("\n").filter(Boolean)
    let head = ""
    if (lines[0]?.startsWith("##")) head = lines.shift().slice(2)
    const branch = head.split("...")[0].trim() || "HEAD"
    const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
    const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)
    const files = lines.map((line) => {
      const status = line.slice(0, 2)
      let file = line.slice(3)
      const renamed = file.includes(" -> ")
      if (renamed) file = file.split(" -> ")[1]
      return { status, path: file.replace(/^"(.*)"$/, "$1") }
    })
    return { branch, ahead, behind, files }
  }

  return {
    async status() {
      if (!(await isRepo())) return { repo: false }
      try {
        return { repo: true, ...parsePorcelain(await git(["status", "--porcelain=v1", "--branch"])) }
      } catch (error) {
        return { repo: true, error: error.message }
      }
    },

    async diff(filePath, staged = false) {
      if (!(await isRepo())) throw new Error("Not a git repository")
      const args = ["diff", "--no-color", "--unified=3"]
      if (staged) args.push("--cached")
      if (filePath) args.push("--", String(filePath))
      return { diff: await git(args) }
    },

    async stage(paths) {
      if (!(await isRepo())) throw new Error("Not a git repository")
      const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean).map(String)
      await git(list.length ? ["add", "--", ...list] : ["add", "-A"])
      return this.status()
    },

    async unstage(paths) {
      if (!(await isRepo())) throw new Error("Not a git repository")
      const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean).map(String)
      await git(list.length ? ["reset", "-q", "HEAD", "--", ...list] : ["reset", "-q", "HEAD"])
      return this.status()
    },

    async commit(message, paths) {
      if (!(await isRepo())) throw new Error("Not a git repository")
      const text = String(message ?? "").trim()
      if (!text) throw new Error("A commit message is required")
      const list = (Array.isArray(paths) ? paths : []).filter(Boolean).map(String)
      if (list.length) await git(["add", "--", ...list])
      const output = await git(["commit", "-m", text])
      return { message: output.split("\n")[0], ...(await this.status()) }
    },

    async log() {
      if (!(await isRepo())) return { repo: false, commits: [] }
      try {
        const output = await git(["log", "--oneline", "-20", "--no-color"])
        return {
          repo: true,
          commits: output
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [hash, ...rest] = line.split(" ")
              return { hash, message: rest.join(" ") }
            }),
        }
      } catch {
        // repo without commits
        return { repo: true, commits: [] }
      }
    },

    async show(filePath, rev = "HEAD") {
      if (!(await isRepo())) throw new Error("Not a git repository")
      const relative = String(filePath ?? "").replace(/\\/g, "/")
      if (!relative) throw new Error("A file path is required")
      try {
        const content = await git(["show", `${rev}:${relative}`])
        return { content: content ? `${content}\n` : content }
      } catch {
        // new/untracked file — nothing on that revision
        return { content: "" }
      }
    },

    async init() {
      await git(["init"])
      return this.status()
    },
  }
}
