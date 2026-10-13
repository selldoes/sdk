import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { PluginPricing } from "@/lib/types"

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

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥" }

const BILLING_SUFFIX: Record<string, string> = { one_time: "", monthly: "/mo", yearly: "/yr" }

/** Human label for a billing period: one_time → "one-time". */
export function billingLabel(period?: string | null) {
  if (period === "monthly") return "per month"
  if (period === "yearly") return "per year"
  return "one-time"
}

/**
 * Marketplace card badge for a pricing block: "FREE", "$9.99/mo", "$99/yr" or
 * "$9.99" (one-time). Unknown currencies fall back to the code prefix.
 */
export function priceBadge(pricing?: PluginPricing | null) {
  const amount = Number(pricing?.amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return "FREE"
  const currency = String(pricing?.currency ?? "USD").toUpperCase()
  const symbol = CURRENCY_SYMBOLS[currency]
  const value = symbol
    ? `${symbol}${amount.toFixed(2).replace(/\.00$/, "")}`
    : `${currency} ${amount.toFixed(2).replace(/\.00$/, "")}`
  return `${value}${BILLING_SUFFIX[pricing?.billingPeriod ?? "one_time"] ?? ""}`
}
