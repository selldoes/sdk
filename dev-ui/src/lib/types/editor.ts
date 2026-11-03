/** Code editor file tree, read/write, search and snapshot payloads. */

import type { Validation } from "./manifest"

export interface FileTreeEntry {
  path: string
  type: "file" | "dir"
  size?: number
  mtimeMs?: number
}

export interface FileTree {
  root: string
  entries: FileTreeEntry[]
}

export interface FileRead {
  path: string
  content: string
  size: number
  mtimeMs: number
}

export interface FileWriteResult {
  ok: boolean
  path: string
  size: number
  unchanged?: boolean
  rebuildError?: string | null
  validation?: Validation
}

export interface SearchHit {
  path: string
  line: number
  column: number
  preview: string
}

export interface SearchResult {
  hits: SearchHit[]
  files: number
  truncated: boolean
}

export interface SnapshotInfo {
  name: string
  reason?: string
  at?: string
  files?: { path: string; existed: boolean }[]
}
