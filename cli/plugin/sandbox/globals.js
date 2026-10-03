/**
 * Sandbox globals shim — injected into every runtime bundle.
 *
 * Production plugins run in QuickJS: no `require()`, no Node globals and none
 * of the browser's encoding helpers. Packages use these at module load (for
 * example `entities`, used by cheerio and htmlparser2, base64-decodes its
 * lookup tables at import time), so the bundle must carry its own tiny
 * implementations instead of hoping the host provides them.
 *
 * Rules for this file:
 *   - dependency-free and side-effect-only (it is `inject`ed, not imported)
 *   - never overwrite a real implementation (feature-detect first)
 *   - UTF-8 only for TextDecoder; other labels fall back to UTF-8
 */

if (typeof globalThis.atob !== "function") {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  globalThis.atob = (input) => {
    const clean = String(input).replace(/[^A-Za-z0-9+/=]/g, "")
    let out = ""
    for (let i = 0; i < clean.length; i += 4) {
      const b1 = B64.indexOf(clean[i])
      const b2 = B64.indexOf(clean[i + 1])
      const b3 = B64.indexOf(clean[i + 2])
      const b4 = B64.indexOf(clean[i + 3])
      if (b1 < 0 || b2 < 0) break
      out += String.fromCharCode(((b1 << 2) | (b2 >> 4)) & 0xff)
      if (b3 >= 0) out += String.fromCharCode((((b2 & 15) << 4) | (b3 >> 2)) & 0xff)
      if (b4 >= 0) out += String.fromCharCode((((b3 & 3) << 6) | b4) & 0xff)
    }
    return out
  }
}

if (typeof globalThis.btoa !== "function") {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  globalThis.btoa = (input) => {
    const text = String(input)
    let out = ""
    for (let i = 0; i < text.length; i += 3) {
      const c1 = text.charCodeAt(i) & 0xff
      const c2 = i + 1 < text.length ? text.charCodeAt(i + 1) & 0xff : null
      const c3 = i + 2 < text.length ? text.charCodeAt(i + 2) & 0xff : null
      out += B64[c1 >> 2]
      out += B64[((c1 & 3) << 4) | (c2 === null ? 0 : c2 >> 4)]
      out += c2 === null ? "=" : B64[((c2 & 15) << 2) | (c3 === null ? 0 : c3 >> 6)]
      out += c3 === null ? "=" : B64[c3 & 63]
    }
    return out
  }
}

if (typeof globalThis.TextEncoder !== "function") {
  class SandboxTextEncoder {
    get encoding() {
      return "utf-8"
    }
    encode(input = "") {
      const text = String(input)
      const bytes = []
      for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i)
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
          const low = text.charCodeAt(i + 1)
          if (low >= 0xdc00 && low <= 0xdfff) {
            code = ((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000
            i++
          }
        }
        if (code < 0x80) bytes.push(code)
        else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
        else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
        else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
      }
      return new Uint8Array(bytes)
    }
    encodeInto(source, destination) {
      const bytes = this.encode(source)
      const written = Math.min(bytes.length, destination.length)
      destination.set(bytes.subarray(0, written))
      return { read: String(source).length, written }
    }
  }
  globalThis.TextEncoder = SandboxTextEncoder
}

if (typeof globalThis.TextDecoder !== "function") {
  class SandboxTextDecoder {
    constructor(label, options) {
      this.encoding = String(label ?? "utf-8").toLowerCase()
      this.fatal = Boolean(options && options.fatal)
      this.ignoreBOM = Boolean(options && options.ignoreBOM)
    }
    decode(input) {
      if (input === undefined) return ""
      const bytes =
        input instanceof Uint8Array
          ? input
          : input instanceof ArrayBuffer
            ? new Uint8Array(input)
            : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      let out = ""
      let i = 0
      while (i < bytes.length) {
        const b0 = bytes[i]
        let code = -1
        let size = 1
        if (b0 < 0x80) code = b0
        else if ((b0 & 0xe0) === 0xc0) {
          code = b0 & 0x1f
          size = 2
        } else if ((b0 & 0xf0) === 0xe0) {
          code = b0 & 0x0f
          size = 3
        } else if ((b0 & 0xf8) === 0xf0) {
          code = b0 & 0x07
          size = 4
        }
        if (size > 1) {
          if (i + size > bytes.length) {
            if (this.fatal) throw new TypeError("The encoded data was not valid for encoding utf-8")
            out += "\ufffd"
            break
          }
          let valid = true
          for (let k = 1; k < size; k++) {
            const byte = bytes[i + k]
            if ((byte & 0xc0) !== 0x80) {
              valid = false
              break
            }
            code = (code << 6) | (byte & 0x3f)
          }
          if (!valid || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
            if (this.fatal) throw new TypeError("The encoded data was not valid for encoding utf-8")
            out += "\ufffd"
            i += 1
            continue
          }
        }
        out += String.fromCodePoint(code)
        i += size
      }
      if (!this.ignoreBOM && out.charCodeAt(0) === 0xfeff) out = out.slice(1)
      return out
    }
  }
  globalThis.TextDecoder = SandboxTextDecoder
}

if (typeof globalThis.queueMicrotask !== "function") {
  globalThis.queueMicrotask = (callback) => {
    Promise.resolve().then(callback)
  }
}

if (typeof globalThis.performance !== "object" || typeof globalThis.performance?.now !== "function") {
  globalThis.performance = { now: () => Date.now() }
}
