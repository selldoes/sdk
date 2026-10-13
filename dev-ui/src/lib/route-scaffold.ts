/** Route helpers shared by the API console and the New route dialog. Mirrors cli/plugin/dev/code-scaffold.mjs. */

export const ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

/** Conventional scaffold location for a route — mirrors `safeFileStem` in code-scaffold.mjs. */
export function routeFileHint(routePath: string): string {
  const stem =
    routePath
      .replace(/^\//, "")
      .replace(/:/g, "-")
      .replace(/[^a-z0-9:_-]+/i, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "item"
  return `routes/${stem}.js`
}

/** The module template written when a route file is created. Mirrors code-scaffold.mjs. */
export function routeModuleTemplate(routePath: string, methods: string[]): string {
  const key = routePath.replace(/^\//, "")
  const handlers = methods
    .map((method) => {
      const body =
        method === "GET"
          ? "return { ok: true, path: request.path, query: request.query }"
          : "return { ok: true, path: request.path, body: request.body }"
      return `    /** ${method} — session + store ownership enforced by the host. */\n    async ${method}(ctx, request) {\n      ${body}\n    },`
    })
    .join("\n")
  return `/**
 * /${key} — dashboard API route (session + store ownership enforced by the host).
 * @param {import("selldoes").PluginContext} ctx
 * @param {import("selldoes").PluginApiRequest} request
 */
module.exports = {
  "${key}": {
${handlers}
  },
}
`
}
