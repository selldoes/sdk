/** A light JSON schema for plugin.json — powers Monaco validation + hints. */

export const PLUGIN_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Selldoes plugin manifest",
  type: "object",
  required: ["slug", "name", "description", "version", "entry"],
  properties: {
    slug: { type: "string", description: "Permanent identifier (lowercase, dashes). Cannot change after publishing." },
    name: { type: "string", description: "Display name in the marketplace." },
    description: { type: "string" },
    version: { type: "string", description: "Semver, e.g. 0.1.0" },
    author: { type: "string" },
    icon: { type: "string", description: "Built-in icon name." },
    iconUrl: { type: "string", description: "Custom icon path inside the plugin, or an absolute URL." },
    homepage: { type: "string" },
    entry: { type: "string", description: "Runtime entry file, e.g. ./index.js" },
    permissions: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "db:read",
          "db:write",
          "db:schema",
          "api:external",
          "ai:use",
          "email:send",
          "files:read",
          "files:write",
          "products:read",
          "products:write",
          "realtime:publish",
          "webhooks:register",
          "sections:register",
          "dashboard:pages",
        ],
      },
    },
    allowedTables: { type: "array", items: { type: "string" }, description: "Store tables the plugin may read/write." },
    dependencies: { type: "object", additionalProperties: { type: "string" } },
    dashboardPages: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "path"],
        properties: {
          label: { type: "string" },
          path: { type: "string" },
          icon: { type: "string" },
          group: { type: "string" },
          entry: { type: "string", description: "Plugin-root-relative HTML entry for this page (falls back to ui.entry)." },
          sections: {
            type: "array",
            description:
              "No-code components compiled into the page's UI entry on build (text, stats, table, job, settings, logs, links); a hand-written entry wins.",
            items: {
              type: "object",
              required: ["type"],
              properties: {
                id: { type: "string" },
                type: { type: "string", enum: ["text", "stats", "table", "job", "settings", "logs", "links"] },
                settings: { type: "object" },
              },
            },
          },
        },
      },
    },
    ui: {
      type: "object",
      properties: {
        entry: { type: "string", description: "Dashboard UI HTML entry (plain JS or bundled TSX)." },
        title: { type: "string" },
        height: { type: "number" },
      },
    },
    delivery: { type: "boolean", description: "Exports deliveryProvider(order, ctx)." },
    apiRoutes: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "methods"],
        properties: {
          path: { type: "string" },
          methods: { type: "array", items: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] } },
        },
      },
    },
    publicRoutes: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "methods"],
        properties: {
          path: { type: "string" },
          methods: { type: "array", items: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] } },
        },
      },
    },
    storefrontWidget: {
      type: "object",
      required: ["entry"],
      properties: { entry: { type: "string" }, width: { type: "number" }, height: { type: "number" } },
    },
    storefrontPages: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "title", "entry"],
        properties: { path: { type: "string" }, title: { type: "string" }, entry: { type: "string" } },
      },
    },
    jobs: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "name"],
        properties: {
          type: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          tickBudgetMs: { type: "number" },
        },
      },
    },
    configSchema: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "label", "type"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          type: { type: "string", enum: ["string", "text", "number", "boolean", "select", "secret"] },
          description: { type: "string" },
          placeholder: { type: "string" },
          default: { type: ["string", "number", "boolean"] },
          options: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" } } } },
          required: { type: "boolean" },
        },
      },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "name"],
        properties: { type: { type: "string" }, name: { type: "string" }, description: { type: "string" } },
      },
    },
    tags: { type: "array", items: { type: "string" } },
    category: { type: "string" },
    screenshots: { type: "array", items: { type: "string" } },
  },
} as const
