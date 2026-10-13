/** Route helpers shared by the API console and the New route dialog. Mirrors cli/plugin/dev/code-scaffold.mjs. */

export const ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

/** Conventional scaffold location for a route — mirrors `safeFileStem` in code-scaffold.mjs. */
export function routeFileHint(routePath: string): string {
  const stem =
    routePath
      .replace(/^\//, "")
      .replace(/:/g, "-")
      .replace(/[^a-z0-9:_-]+/gi, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "item"
  return `routes/${stem}.js`
}

/** `:param` names in a path, in order, deduped — `["id"]` for `/products/:id`. */
export function routeParamNames(routePath: string): string[] {
  return [...new Set(Array.from(routePath.matchAll(/:([A-Za-z0-9_]+)/g)).map((match) => match[1]))]
}

/** Substitutes `:param` segments with encoded values; empty values keep a `1` placeholder. */
export function resolveRouteUrl(routePath: string, params: Record<string, string>): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => encodeURIComponent(params[name]?.trim() || "1"))
}

/** The module template written when a route file is created. Mirrors code-scaffold.mjs. */
export function routeModuleTemplate(routePath: string, methods: string[], routeKind: "api" | "public" = "api"): string {
  const key = routePath.replace(/^\//, "")
  const scope =
    routeKind === "public"
      ? ` * /${key} — public API route (visitors; no session — the store is resolved by the host).`
      : ` * /${key} — dashboard API route (session + store ownership enforced by the host).`
  const paramNote = /(^|\/):[A-Za-z0-9_]+/.test(routePath)
    ? ` * Path parameters arrive as request.params, e.g. request.params.id for "/:id" segments.\n`
    : ""
  const handlers = methods
    .map((method) => {
      const body =
        method === "GET"
          ? "return { ok: true, path: request.path, params: request.params, query: request.query }"
          : "return { ok: true, path: request.path, params: request.params, body: request.body }"
      return `    /** ${method} — session + store ownership enforced by the host. */\n    async ${method}(ctx, request) {\n      ${body}\n    },`
    })
    .join("\n")
  return `/**
${scope}
${paramNote} * @param {import("selldoes").PluginContext} ctx
 * @param {import("selldoes").PluginApiRequest} request
 */
module.exports = {
  "${key}": {
${handlers}
  },
}
`
}
