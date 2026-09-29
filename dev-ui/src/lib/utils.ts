import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

export function timeAgo(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

/** Resolves a manifest media path (icon/screenshot) for the preview server. */
export function mediaUrl(path?: string | null) {
  const value = String(path ?? "").trim()
  if (!value) return ""
  if (/^(https?:)?\/\//.test(value) || value.startsWith("data:")) return value
  return `/__dev/assets/${value.replace(/^\.\//, "").split("/").map(encodeURIComponent).join("/")}`
}
