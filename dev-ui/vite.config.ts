import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const rootDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Builds the preview SPA into `cli/plugin/dev/ui-dist/`, which the dev server
 * serves at http://127.0.0.1:4590/preview.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/preview/",
  resolve: {
    alias: { "@": path.resolve(rootDir, "src") },
  },
  // `npm run dev-ui` (Vite dev server with HMR) proxies the dev endpoints to a
  // running `selldoes dev` (default port 4590).
  server: {
    port: 5174,
    proxy: {
      "/__dev": "http://127.0.0.1:4590",
      "/api": "http://127.0.0.1:4590",
    },
  },
  build: {
    outDir: path.resolve(rootDir, "../cli/plugin/dev/ui-dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
})
