/**
 * Optional peer packages for `selldoes/node`, loaded at runtime from the
 * plugin's own `node_modules`. Declared here so the SDK compiles (and emits
 * helper types) without depending on sharp/Playwright. This file is not
 * emitted to `dist/`.
 */

declare module "sharp" {
  export interface SharpPipeline {
    resize(width: number, height: number, options?: unknown): SharpPipeline
    flatten(options?: unknown): SharpPipeline
    webp(options?: unknown): SharpPipeline
    png(options?: unknown): SharpPipeline
    jpeg(options?: unknown): SharpPipeline
    toBuffer(options?: unknown): Promise<Buffer>
    metadata(): Promise<Record<string, unknown>>
  }
  export interface SharpFactory {
    (input?: Buffer | Uint8Array | string, options?: unknown): SharpPipeline
    kernel: { lanczos3: string; [name: string]: string }
  }
  const sharp: SharpFactory
  export default sharp
}

declare module "playwright-core" {
  export interface Page {
    goto(url: string, options?: unknown): Promise<unknown>
    content(): Promise<string>
    close(): Promise<void>
    [key: string]: unknown
  }
  export interface BrowserContext {
    newPage(options?: unknown): Promise<Page>
    close(): Promise<void>
  }
  export interface Browser {
    newPage(options?: unknown): Promise<Page>
    newContext(options?: unknown): Promise<BrowserContext>
    close(): Promise<void>
  }
  export const chromium: {
    launch(options?: unknown): Promise<Browser>
  }
}

declare module "@sparticuz/chromium" {
  const chromium: {
    args: string[]
    executablePath(): Promise<string>
  }
  export default chromium
}
