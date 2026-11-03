/** Background job run history and transcripts. */

/** One background job run (the job history). */
export interface JobRunRow {
  id: number
  type: string
  status: string
  runtime?: string
  total?: number
  processed?: number
  failed?: number
  skipped?: number
  error?: string | null
  progress?: { message?: string } | null
  result?: unknown
  startedAt?: string | null
  completedAt?: string | null
  createdAt?: string | null
}

/** A run with its transcript: per-item results, log lines and the result. */
export interface JobRunDetail {
  job?: JobRunRow
  items?: { ref?: string; status?: string; error?: string | null; data?: unknown; productId?: number }[]
  logs?: { level?: string; message?: string }[]
}
