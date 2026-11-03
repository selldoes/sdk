import { ChevronDown, Search, Sparkles } from "lucide-react"
import * as React from "react"
import { resolveIcon } from "@/components/app-icon"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { filterPermissions, PERMISSION_INFO, permissionInfo, RISK_STYLES } from "@/lib/permissions"
import { ACCENTS, type AccentName } from "@/lib/project-colors"
import { cn } from "@/lib/utils"
import type { WsExample } from "@/lib/ws-api"
import { type ExampleKind, styleFor } from "./shared"

// ─── Step 4 · Options & review ───────────────────────────────────────────────

export function StepOptions({
  isAi,
  kind,
  example,
  permissions,
  togglePermission,
  name,
  slug,
  description,
  version,
  author,
  category,
  icon,
  accent,
  customPreview,
}: {
  isAi: boolean
  kind: ExampleKind
  example: WsExample | null
  permissions: string[]
  togglePermission: (permission: string) => void
  name: string
  slug: string
  description: string
  version: string
  author: string
  category: string
  icon: string
  accent: AccentName
  customPreview: string | null
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        {isAi ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5 text-[10.5px] leading-snug text-muted-foreground">
            The AI writes the manifest and grants only the permissions its code actually uses — minimum needed, never more. You
            can tighten them in <code className="text-[10px]">plugin.json</code> afterwards.
          </div>
        ) : kind === "theme" ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5 text-[10.5px] leading-snug text-muted-foreground">
            Themes render the storefront directly — no dashboard UI and no permissions to declare. Preview one with{" "}
            <code className="text-[10px]">selldoes dev --store &lt;slug&gt;</code>.
          </div>
        ) : (
          <>
            {example ? (
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                <p className="text-xs font-semibold">{example.name}</p>
                <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{example.description}</p>
                {example.ui === "react" ? (
                  <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
                    React UI projects need <code className="text-[10px]">npm install</code> — the shell will remind you after
                    creating.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Permissions</p>
                <Badge variant="secondary" className="text-[9px]">
                  db:* recommended
                </Badge>
              </div>
              <PermissionPicker permissions={permissions} onToggle={togglePermission} />
            </div>
          </>
        )}
      </div>

      <ReviewCard
        kind={kind}
        example={example}
        isAi={isAi}
        name={name}
        slug={slug}
        description={description}
        version={version}
        author={author}
        category={category}
        icon={icon}
        accent={accent}
        permissionCount={permissions.length}
        customPreview={customPreview}
      />
    </div>
  )
}

function PermissionPicker({ permissions, onToggle }: { permissions: string[]; onToggle: (permission: string) => void }) {
  const [showAll, setShowAll] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const all = Object.keys(PERMISSION_INFO)
  const matches = filterPermissions(all, query)
  const searching = query.trim().length > 0
  const visible = searching ? matches : showAll ? all : all.slice(0, 8)

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${all.length} permissions…`}
          className="h-8 pl-8 text-xs"
          aria-label="Search permissions"
        />
      </div>
      {visible.map((permission) => {
        const info = permissionInfo(permission)
        const risk = RISK_STYLES[info.risk]
        const checked = permissions.includes(permission)
        return (
          <label
            key={permission}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
              checked ? "border-primary/40 bg-primary/[0.03]" : "border-border hover:bg-muted/40",
            )}
          >
            <Checkbox checked={checked} onCheckedChange={() => onToggle(permission)} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold">{info.label}</span>
                <code className="rounded bg-muted px-1 py-0.5 text-[9.5px] text-muted-foreground">{permission}</code>
                <span
                  className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", risk.badge)}
                >
                  {info.risk}
                </span>
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">{info.description}</span>
            </span>
          </label>
        )
      })}
      {searching ? (
        matches.length === 0 ? (
          <p className="px-1 pt-1 text-[11px] text-muted-foreground">No permissions match “{query}”.</p>
        ) : null
      ) : (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="flex items-center gap-1 px-1 pt-0.5 text-[11px] font-semibold text-primary hover:underline"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", showAll && "rotate-180")} />
          {showAll ? "Show fewer permissions" : `Show all ${all.length} permissions`}
        </button>
      )}
    </div>
  )
}

function ReviewCard({
  kind,
  example,
  isAi,
  name,
  slug,
  description,
  version,
  author,
  category,
  icon,
  accent,
  permissionCount,
  customPreview,
}: {
  kind: ExampleKind
  example: WsExample | null
  isAi: boolean
  name: string
  slug: string
  description: string
  version: string
  author: string
  category: string
  icon: string
  accent: AccentName
  permissionCount: number
  customPreview: string | null
}) {
  const Icon = resolveIcon(icon)
  const rows: Array<[string, string]> = [
    ["Kind", isAi ? "Plugin (AI)" : kind === "theme" ? "Theme" : "Plugin"],
    ["Version", version || "0.1.0"],
    ["Author", author || "—"],
    [
      "Dashboard UI",
      isAi
        ? "AI decides"
        : kind === "theme"
          ? "none (storefront theme)"
          : example?.ui === "react"
            ? "React TSX"
            : example?.ui === "js"
              ? "Plain JS"
              : "kit sections only",
    ],
    ["Category", category],
    [
      "Permissions",
      isAi ? "AI minimal" : kind === "theme" ? "n/a (theme)" : permissionCount > 0 ? `${permissionCount} selected` : "none",
    ],
  ]
  return (
    <div className="self-start rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2.5">
        {isAi ? (
          <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
        ) : example ? (
          <span
            className={cn(
              "flex h-12 w-16 shrink-0 items-center justify-center rounded-lg border border-border",
              ACCENTS[styleFor(example.id).accent].tile,
            )}
          >
            {React.createElement(resolveIcon(styleFor(example.id).icon), { className: "h-5 w-5" })}
          </span>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn("flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md", ACCENTS[accent].tile)}
          >
            {customPreview ? (
              <img src={customPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{name || "untitled-workspace"}</p>
            <p className="truncate text-[10.5px] text-muted-foreground">./{slug || "untitled-workspace"}</p>
          </div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border pt-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
            <dd className="truncate text-[11.5px] font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {example && !isAi && kind === "plugin" ? (
        <p className="mt-3 border-t border-border pt-2.5 text-[10.5px] leading-snug text-muted-foreground">
          Built from the <span className="font-semibold">{example.name}</span> example.
        </p>
      ) : null}
      {description ? (
        <p className="mt-3 border-t border-border pt-2.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}
