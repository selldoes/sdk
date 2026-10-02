/**
 * Plugin trust & permission metadata, matching the dashboard's
 * `src/lib/plugins/sandbox/permissions.ts`. The preview shows store owners
 * exactly what the real install dialog will show.
 */

import type { PluginPermission } from "./types"

export type PermissionRisk = "low" | "medium" | "high" | "critical"

export interface PermissionInfo {
  label: string
  description: string
  impact: string
  risk: PermissionRisk
}

export const PERMISSION_ORDER: PluginPermission[] = [
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
]

export const PERMISSION_INFO: Record<PluginPermission, PermissionInfo> = {
  "db:read": {
    label: "Read store data",
    description: "Read rows from the store tables the plugin is explicitly allowed to touch.",
    impact: "Can read products, pages, settings and other store records it is granted access to.",
    risk: "medium",
  },
  "db:write": {
    label: "Modify store data",
    description: "Create, update and delete rows in the store tables the plugin is allowed to touch.",
    impact: "Can change or permanently delete products, pages, categories and settings in your store.",
    risk: "high",
  },
  "db:schema": {
    label: "Own database tables",
    description: "Create and manage database tables that are prefixed with the plugin's own name.",
    impact: "Can only create/alter its own plugin_* tables — not your store tables.",
    risk: "low",
  },
  "api:external": {
    label: "External network access",
    description: "Make HTTP requests to servers on the public internet.",
    impact: "Can send any data the plugin can see to an external server — including to its author.",
    risk: "high",
  },
  "ai:use": {
    label: "Use AI models",
    description: "Run prompts through the AI providers configured for your store.",
    impact: "Consumes your AI credits and can send the text it is given to the AI provider.",
    risk: "medium",
  },
  "email:send": {
    label: "Send email",
    description: "Send transactional email through the platform's mail infrastructure.",
    impact: "Can email your customers from your store address — and burn your sending reputation.",
    risk: "high",
  },
  "files:read": {
    label: "Read uploaded files",
    description: "Read files that belong to your store.",
    impact: "Can read images, documents and other files stored for your store.",
    risk: "medium",
  },
  "files:write": {
    label: "Write files",
    description: "Upload and overwrite files in your store's file storage.",
    impact: "Can add or replace files (images, documents) used by your storefront.",
    risk: "medium",
  },
  "products:read": {
    label: "Read products",
    description: "Read products in your catalog (store-scoped).",
    impact: "Can read product names, prices, stock and descriptions.",
    risk: "low",
  },
  "products:write": {
    label: "Create & update products",
    description: "Create, update and hide products in your catalog (store-scoped).",
    impact: "Can add new products and change or hide existing ones — including prices.",
    risk: "high",
  },
  "realtime:publish": {
    label: "Send realtime events",
    description: "Publish events on plugin-scoped channels (chat messages, notifications).",
    impact: "Can push messages to clients subscribed to its channels in your store.",
    risk: "medium",
  },
  "webhooks:register": {
    label: "Register webhooks",
    description: "Ask the platform to deliver events (orders, customers, …) to a URL.",
    impact: "Can receive a live feed of store events, including customer-related ones.",
    risk: "medium",
  },
  "sections:register": {
    label: "Storefront sections",
    description: "Provide new section types that can be added to your store pages.",
    impact: "Can render content on your storefront.",
    risk: "low",
  },
  "dashboard:pages": {
    label: "Dashboard pages",
    description: "Add pages to your store dashboard.",
    impact: "Can render its own UI inside your dashboard.",
    risk: "low",
  },
}

export function permissionInfo(permission: string): PermissionInfo {
  return (
    PERMISSION_INFO[permission as PluginPermission] ?? {
      label: permission,
      description: "Unknown permission — it will not be granted by the host.",
      impact: "Unknown impact.",
      risk: "high",
    }
  )
}

const RISK_ORDER: Record<PermissionRisk, number> = { low: 0, medium: 1, high: 2, critical: 3 }

export function highestRisk(permissions: string[] = []): PermissionRisk {
  return permissions.reduce<PermissionRisk>((worst, permission) => {
    const risk = permissionInfo(permission).risk
    return RISK_ORDER[risk] > RISK_ORDER[worst] ? risk : worst
  }, "low")
}

export function sortByRisk(permissions: string[] = []) {
  return [...permissions].sort((a, b) => RISK_ORDER[permissionInfo(b).risk] - RISK_ORDER[permissionInfo(a).risk])
}

/**
 * Filters a permission key list by a free-text query, matching the key, label,
 * description and risk/impact text. Used by the search boxes in the Details
 * page and the New-workspace permission picker.
 */
export function filterPermissions<T extends string>(permissions: T[] = [], query = ""): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return permissions
  return permissions.filter((permission) => {
    const info = permissionInfo(permission)
    return [permission, info.label, info.description, info.impact, info.risk]
      .join(" ")
      .toLowerCase()
      .includes(needle)
  })
}

export const RISK_STYLES: Record<PermissionRisk, { badge: string; dot: string; text: string }> = {
  low: { badge: "bg-gray-100 text-gray-600 border-gray-200", dot: "bg-gray-400", text: "text-gray-600" },
  medium: { badge: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500", text: "text-amber-700" },
  high: { badge: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500", text: "text-orange-700" },
  critical: { badge: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-600", text: "text-red-700" },
}

export const CATEGORIES = [
  "ecommerce",
  "support",
  "marketing",
  "analytics",
  "design",
  "security",
  "productivity",
  "integrations",
  "other",
]
