import type { ReactNode } from "react"
import {
  BarChart2,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  DollarSign,
  FilePlus2,
  FileText,
  Filter,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  Mail,
  MessageCircle,
  Package,
  Palette,
  Plug,
  Puzzle,
  Radio,
  Settings,
  Shield,
  ShieldAlert,
  ShoppingCart,
  Sliders,
  Sparkles,
  Star,
  Store,
  Ticket,
  Truck,
  Users,
  Wand2,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { cn, mediaUrl } from "@/lib/utils"

/**
 * Resolves the icon names plugins use in their manifests (PascalCase or
 * kebab-case) to the same curated lucide set the dashboard uses.
 */
const ICONS: Record<string, LucideIcon> = {
  "bar-chart-2": BarChart2,
  bell: Bell,
  "book-open": BookOpen,
  bot: Bot,
  boxes: Boxes,
  "dollar-sign": DollarSign,
  "file-plus": FilePlus2,
  "file-text": FileText,
  filter: Filter,
  "key-round": KeyRound,
  key: KeyRound,
  "layout-dashboard": LayoutDashboard,
  "layout-grid": LayoutGrid,
  "life-buoy": LifeBuoy,
  lifebuoy: LifeBuoy,
  mail: Mail,
  "message-circle": MessageCircle,
  package: Package,
  palette: Palette,
  plug: Plug,
  puzzle: Puzzle,
  radio: Radio,
  settings: Settings,
  shield: Shield,
  "shield-alert": ShieldAlert,
  "shopping-cart": ShoppingCart,
  sliders: Sliders,
  sparkles: Sparkles,
  star: Star,
  store: Store,
  ticket: Ticket,
  truck: Truck,
  users: Users,
  "wand-2": Wand2,
  wand: Wand2,
  zap: Zap,
}

export const PLUGIN_ICON_CHOICES = [
  "bar-chart-2",
  "bell",
  "book-open",
  "bot",
  "boxes",
  "dollar-sign",
  "file-text",
  "filter",
  "key-round",
  "layout-dashboard",
  "life-buoy",
  "mail",
  "message-circle",
  "package",
  "palette",
  "plug",
  "radio",
  "settings",
  "shield",
  "shield-alert",
  "shopping-cart",
  "sliders",
  "sparkles",
  "star",
  "store",
  "ticket",
  "truck",
  "users",
  "wand-2",
  "puzzle",
]

export function normalizeIconName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase()
}

export function resolveIcon(name?: string | null): LucideIcon {
  const key = name ? normalizeIconName(name) : ""
  return ICONS[key] ?? Puzzle
}

/**
 * The plugin icon, matching the dashboard: a rounded square holding either a
 * curated lucide glyph or the custom uploaded image.
 */
export function AppIcon({
  name,
  imageUrl,
  className,
  children,
}: {
  name?: string | null
  imageUrl?: string | null
  className?: string
  children?: ReactNode
}) {
  const Icon = resolveIcon(name)
  const source = mediaUrl(imageUrl)
  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/50 text-foreground",
        className,
      )}
    >
      {children ?? (source ? <img src={source} alt="" className="h-full w-full object-cover" /> : <Icon className="h-5 w-5" />)}
    </span>
  )
}
