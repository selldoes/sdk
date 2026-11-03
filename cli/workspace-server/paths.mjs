import path from "node:path"
import { fileURLToPath } from "node:url"

// This file lives in `cli/workspace-server/`, so the CLI dir is one level up
// and the SDK root two.
const HERE = path.dirname(fileURLToPath(import.meta.url))

export const SDK_ROOT = path.resolve(HERE, "..", "..")
export const CLI_DIR = path.join(SDK_ROOT, "cli")
export const UI_DIST = path.join(CLI_DIR, "plugin", "dev", "ui-dist")
export const BIN = path.join(SDK_ROOT, "bin", "selldoes.mjs")

export const UI_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
].join("; ")

export const MAX_LOG_LINES = 200
