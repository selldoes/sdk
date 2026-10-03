/**
 * Injected before the plugin bundle: installs a `process` shim when the realm
 * has none, so packages that read `process.env`/`process.nextTick` at load
 * don't crash. The sandbox never exposes a real Node process.
 */
import processShim from "process"

if (typeof globalThis.process === "undefined") {
  globalThis.process = processShim
}
