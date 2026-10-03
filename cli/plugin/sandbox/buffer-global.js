/**
 * Injected before the plugin bundle: installs `Buffer` from the allow-listed
 * polyfill when the sandbox realm has none. Guarded so a real global always
 * wins (Node preview) and the bundle stays self-contained (QuickJS).
 */
import { Buffer as BufferShim } from "buffer"

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = BufferShim
}
