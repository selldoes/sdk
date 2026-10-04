import * as React from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { ArrowLeft, Compass, Home, Puzzle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PAGE_TITLES } from "@/lib/pages"

/**
 * In-app 404 — reached when the URL's page segment isn't one of the preview
 * pages (stale bookmark, hand-typed URL, renamed page). The server-side
 * catch-alls in cli/workspace-server.mjs and cli/plugin/dev/server.mjs answer
 * API clients with JSON and browsers they can't map to the SPA with a styled
 * static page; this covers routes that reach the SPA but match no page.
 */
export function NotFoundPage() {
  const location = useLocation()
  const navigate = useNavigate()
  // window.location includes the project-id segment; location.pathname is
  // basename-stripped. Show the address bar — that's what the user typed.
  const fullPath = window.location.pathname
  const links = React.useMemo(
    () => Object.entries(PAGE_TITLES).filter(([to]) => to !== location.pathname),
    [location.pathname],
  )

  return (
    <div className="mx-auto mt-10 max-w-2xl">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Compass className="h-7 w-7" />
          </span>
          <p className="text-5xl font-extrabold tracking-tight text-muted-foreground/50">404</p>
          <h1 className="text-xl font-bold tracking-tight">Page not found</h1>
          <code className="max-w-full truncate rounded-md border border-border bg-muted px-2 py-1 text-xs">{fullPath}</code>
          <p className="max-w-md text-sm text-muted-foreground">
            This address doesn&rsquo;t match a page in the preview. The link may be stale, the page may have been renamed,
            or the URL was typed by hand — jump back in from below.
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft />
              Go back
            </Button>
            <Button size="sm" onClick={() => navigate("/")}>
              <Home />
              Overview
            </Button>
          </div>
          <div className="mt-4 flex w-full flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Jump to</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {links.map(([to, label]) => (
                <Link
                  key={to}
                  to={to}
                  className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Puzzle className="h-3 w-3" />
            Press <kbd className="rounded border border-border bg-muted px-1 py-px text-[10px] font-sans">Ctrl</kbd>+
            <kbd className="rounded border border-border bg-muted px-1 py-px text-[10px] font-sans">K</kbd> for the command
            palette.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
