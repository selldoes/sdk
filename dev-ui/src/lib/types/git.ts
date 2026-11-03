/** Git working-tree status used by the code editor. */

export interface GitFile {
  status: string
  path: string
}

export interface GitStatus {
  repo: boolean
  branch?: string
  ahead?: number
  behind?: number
  files?: GitFile[]
  error?: string
}

export interface GitCommit {
  hash: string
  message: string
}
