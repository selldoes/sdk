import path from "node:path"
import { fileURLToPath } from "node:url"

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

/** `cli/plugin` — the parent of this folder, home of the sandbox build layer. */
export const HERE = path.resolve(MODULE_DIR, "..")

/** Injected into every runtime bundle (atob/btoa/TextEncoder/TextDecoder…). */
export const GLOBALS_SHIM = path.join(HERE, "sandbox", "globals.js")
export const BUFFER_GLOBAL = path.join(HERE, "sandbox", "buffer-global.js")
export const PROCESS_GLOBAL = path.join(HERE, "sandbox", "process-global.js")
