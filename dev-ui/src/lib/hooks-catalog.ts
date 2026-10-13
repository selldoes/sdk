/**
 * Curated catalogue of the events the Selldoes host fires into plugins.
 *
 * Purely UI guidance — the dev server never validates names against it, so any
 * `namespace:event` name works. The Hooks page and the New hook dialog use it
 * to explain what each event is for, pre-fill a realistic test payload and
 * show what a useful handler returns.
 */

export interface HookCatalogEntry {
  /** Event name as declared in plugin.json `hooks`. */
  name: string
  /** One-liner shown in pickers and on hook cards. */
  description: string
  /** Grouping for the picker (badge + section order). */
  group: "Dashboard" | "Orders" | "Products" | "Customers" | "Checkout" | "Lifecycle"
  /** Pretty JSON the host roughly sends — prefills the Fire hook payload box. */
  samplePayload: string
  /** What the payload carries, in plain words. */
  payloadNote: string
  /** What a useful handler typically returns. */
  returns: string
}

export const HOOK_CATALOG: HookCatalogEntry[] = [
  {
    name: "dashboard:products:columns",
    description: "Add a column to the products table.",
    group: "Dashboard",
    samplePayload: '{\n  "storeId": 1\n}',
    payloadNote: "Just the store id — nothing else is sent.",
    returns: "Column definitions the host renders in the products table.",
  },
  {
    name: "dashboard:orders:columns",
    description: "Add a column to the orders table.",
    group: "Dashboard",
    samplePayload: '{\n  "storeId": 1\n}',
    payloadNote: "Just the store id — nothing else is sent.",
    returns: "Column definitions the host renders in the orders table.",
  },
  {
    name: "dashboard:stats:cards",
    description: "Add a stat card to a dashboard page.",
    group: "Dashboard",
    samplePayload: '{\n  "storeId": 1,\n  "range": "30d"\}',
    payloadNote: "Store id plus the reporting range the page is showing.",
    returns: "Stat cards ({ label, value, hint }) the host renders on the page.",
  },
  {
    name: "order:created",
    description: "React when a customer places an order.",
    group: "Orders",
    samplePayload: '{\n  "storeId": 1,\n  "order": {\n    "id": 1001,\n    "total": 49.9,\n    "currency": "USD"\n  }\n}',
    payloadNote: "Store id plus the new order.",
    returns: "Anything JSON-serializable — it's logged in the dev console.",
  },
  {
    name: "order:paid",
    description: "React when an order is paid.",
    group: "Orders",
    samplePayload: '{\n  "storeId": 1,\n  "order": {\n    "id": 1001,\n    "total": 49.9,\n    "currency": "USD"\n  }\n}',
    payloadNote: "Store id plus the paid order.",
    returns: "Anything JSON-serializable — it's logged in the dev console.",
  },
  {
    name: "order:delivered",
    description: "React when an order is delivered.",
    group: "Orders",
    samplePayload: '{\n  "storeId": 1,\n  "order": {\n    "id": 1001,\n    "total": 49.9,\n    "currency": "USD"\n  }\n}',
    payloadNote: "Store id plus the delivered order.",
    returns: "Anything JSON-serializable — it's logged in the dev console.",
  },
  {
    name: "order:cancelled",
    description: "React when an order is cancelled.",
    group: "Orders",
    samplePayload: '{\n  "storeId": 1,\n  "order": {\n    "id": 1001,\n    "total": 49.9,\n    "currency": "USD"\n  }\n}',
    payloadNote: "Store id plus the cancelled order.",
    returns: "Anything JSON-serializable — it's logged in the dev console.",
  },
  {
    name: "product:created",
    description: "React when a product is added to the catalog.",
    group: "Products",
    samplePayload: '{\n  "storeId": 1,\n  "product": {\n    "id": 12,\n    "sku": "ABC-123",\n    "name": "New product"\n  }\n}',
    payloadNote: "Store id plus the new product.",
    returns: "Anything JSON-serializable — it's logged in the dev console.",
  },
  {
    name: "product:updated",
    description: "React when a product is edited (price, stock, name…).",
    group: "Products",
    samplePayload: '{\n  "storeId": 1,\n  "product": {\n    "id": 12,\n    "sku": "ABC-123",\n    "price": 19.99\n  }\n}',
    payloadNote: "Store id plus the updated product.",
    returns: "Anything JSON-serializable — it's logged in the dev console.",
  },
  {
    name: "product:deleted",
    description: "React when a product is removed from the catalog.",
    group: "Products",
    samplePayload: '{\n  "storeId": 1,\n  "product": {\n    "id": 12,\n    "sku": "ABC-123"\n  }\n}',
    payloadNote: "Store id plus the removed product.",
    returns: "Anything JSON-serializable — it's logged in the dev console.",
  },
  {
    name: "customer:created",
    description: "React when a customer account is created.",
    group: "Customers",
    samplePayload: '{\n  "storeId": 1,\n  "customer": {\n    "id": 7,\n    "email": "customer@example.com"\n  }\n}',
    payloadNote: "Store id plus the new customer.",
    returns: "Anything JSON-serializable — it's logged in the dev console.",
  },
  {
    name: "checkout:summary",
    description: "Add lines to the checkout summary (totals area).",
    group: "Checkout",
    samplePayload: '{\n  "storeId": 1,\n  "subtotal": 49.9,\n  "total": 49.9\n}',
    payloadNote: "Store id plus the cart totals so you can add fees, discounts or notes.",
    returns: "Summary lines ({ label, amount }) the host appends to the totals.",
  },
  {
    name: "store:installed",
    description: "React when this plugin is installed on a store.",
    group: "Lifecycle",
    samplePayload: '{\n  "storeId": 1\n}',
    payloadNote: "Just the store id of the installing store.",
    returns: "Anything JSON-serializable — e.g. a welcome/setup summary.",
  },
]

/** Lookup helper — undefined for custom/unknown hook names. */
export function findHookCatalog(name: string): HookCatalogEntry | undefined {
  return HOOK_CATALOG.find((entry) => entry.name === name)
}

/**
 * Manifest handler paths are hand-writable ("./handlers/columns.js") while
 * the file tree reports plain POSIX paths (`handlers/columns.js`). Normalize
 * declarations before matching, displaying or linking them.
 */
export function normalizeHandlerPath(handler: string): string {
  return String(handler)
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
}

/**
 * Where the scaffold puts a hook's handler file. Mirrors `safeFileStem` in
 * cli/plugin/dev/code-scaffold.mjs so the UI previews the exact path the
 * server will write.
 */
export function handlerPathFor(hookName: string): string {
  const stem =
    String(hookName)
      .replace(/^\//, "")
      .replace(/:/g, "-")
      .replace(/[^a-z0-9:_-]+/i, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "item"
  return `hooks/${stem}.js`
}

/** The module template written when a handler file is created. Mirrors code-scaffold.mjs. */
export function hookModuleTemplate(name: string): string {
  return `/**
 * ${name} — hook handler. The host calls this when the event fires.
 * @param {unknown} payload
 * @param {import("selldoes").PluginContext} ctx
 */
module.exports = {
  "${name}": async (payload, ctx) => {
    // TODO: react to the event.
    return { ok: true, received: Boolean(payload) }
  },
}
`
}
