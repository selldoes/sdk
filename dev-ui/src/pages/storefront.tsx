import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { Globe2, ShoppingBag, Sparkles } from "lucide-react"
import { PageHead, Callout } from "@/components/shared"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useVisit } from "@/lib/use-visit"
import { cn } from "@/lib/utils"
import { useApp } from "@/state/app"

const DEMO_PRODUCTS = [
  { name: "Classic Tee", price: "$12.00 – $24.90" },
  { name: "Canvas Tote", price: "$18.00" },
  { name: "Mug — Logo", price: "$14.50" },
  { name: "Sticker Pack", price: "$6.00" },
]

export function StorefrontPage() {
  const { bootstrap, setAssistantOpen, setAssistantPage } = useApp()
  useVisit("storefront")
  const manifest = bootstrap!.manifest
  const store = bootstrap!.store
  const [params, setParams] = useSearchParams()
  const widget = manifest.storefrontWidget
  const pages = manifest.storefrontPages ?? []
  const pagePath = params.get("page")
  const activePage = pagePath ? pages.find((page) => page.path === pagePath) ?? null : null
  const pageFrame = React.useRef<HTMLIFrameElement>(null)
  const widgetFrame = React.useRef<HTMLIFrameElement>(null)

  React.useEffect(() => {
    setAssistantPage({
      context: "The developer is previewing their storefront widget/pages on a demo store.",
      quick: ["Explain storefront widgets and pages", "What else could I add to the storefront?"],
    })
  }, [setAssistantPage])

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; slug?: string; width?: number; height?: number }
      if (!data || data.type !== "selldesk:resize") return
      const frame = data.slug === manifest.slug ? widgetFrame.current ?? pageFrame.current : pageFrame.current
      if (!frame) return
      if (typeof data.width === "number") frame.style.width = `${Math.max(40, Math.min(data.width, 900))}px`
      if (typeof data.height === "number") frame.style.height = `${Math.max(120, Math.min(data.height, 4000))}px`
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [manifest.slug])

  const hasSurface = Boolean(widget?.entry) || pages.length > 0

  return (
    <div className="space-y-4">
      <PageHead
        title="Storefront"
        description="Your widget and public pages, rendered inside a demo store exactly like the host mounts them (same sandbox, same resize bridge)."
      />

      {!hasSurface ? (
        <Callout kind="info">
          This plugin declares no <code>storefrontWidget</code> or <code>storefrontPages</code>. Add one in plugin.json to put content on
          every storefront — a chat bubble, a help center at <code>/kb</code>, anything visitor-facing.{" "}
          <button type="button" className="font-semibold underline" onClick={() => setAssistantOpen(true)}>
            Ask the AI assistant to add one
          </button>
          .
        </Callout>
      ) : null}

      {activePage ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="h-4 w-4" />
              Storefront page: {activePage.title} ({activePage.path})
            </CardTitle>
            <CardDescription>
              Served by the host's storefrontPages lane inside your real store layout, self-resizing via <code>selldesk:resize</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <iframe
              key={activePage.entry}
              ref={pageFrame}
              src={`/api/plugin-public/${manifest.slug}/ui/${activePage.entry}?storeSlug=${encodeURIComponent(store.slug)}`}
              title={activePage.title}
              className="h-[480px] w-full rounded-xl border border-border bg-white"
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Storefront pages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {pages.length > 0 ? (
              pages.map((page) => (
                <button
                  key={page.path}
                  type="button"
                  onClick={() => setParams(page.path ? { page: page.path } : {})}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors",
                    pagePath === page.path ? "border-primary bg-primary/5 font-semibold" : "border-border hover:bg-muted",
                  )}
                >
                  <span>{page.title}</span>
                  <code className="text-[10.5px] text-muted-foreground">{page.path}</code>
                </button>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No storefront pages declared.</p>
            )}
            {pages.length > 0 ? (
              <button
                type="button"
                onClick={() => setParams({})}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px]",
                  !pagePath ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                Demo store only
              </button>
            ) : null}
          </CardContent>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="rounded-xl bg-muted/40">
            <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 text-[13px] font-bold">
              <span className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-primary" />
                Demo Store
              </span>
              <span className="text-xs font-normal text-muted-foreground">cart (0)</span>
            </div>
            <div className="relative min-h-[420px] p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {DEMO_PRODUCTS.map((product) => (
                  <div key={product.name} className="rounded-xl border border-border bg-card p-3">
                    <div className="mb-2 h-20 rounded-lg bg-muted" />
                    <p className="text-[12.5px] font-semibold">{product.name}</p>
                    <p className="mb-2 text-[11.5px] text-muted-foreground">{product.price}</p>
                    <button className="rounded-lg bg-primary px-2.5 py-1.5 text-[11.5px] font-semibold text-primary-foreground">
                      Add to cart
                    </button>
                  </div>
                ))}
              </div>

              {widget?.entry ? (
                <div className="absolute bottom-4 right-4 z-10">
                  <iframe
                    ref={widgetFrame}
                    src={`/api/plugin-public/${manifest.slug}/ui/${widget.entry}?storeSlug=${encodeURIComponent(store.slug)}`}
                    title="Storefront widget"
                    className="h-16 w-16 border-0 bg-transparent"
                  />
                </div>
              ) : (
                <p className="absolute bottom-5 right-5 rounded-lg border border-dashed border-border bg-card/80 px-3 py-2 text-[11px] text-muted-foreground">
                  No widget declared
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Callout kind="info">
        <strong>Widget vs page:</strong> the widget is the floating bubble shown on every storefront page; pages are real routes like{" "}
        <code>/kb</code> that your plugin owns. Both are sandboxed iframes and can resize themselves with{" "}
        <code>selldesk:resize</code>. <Sparkles className="inline h-3.5 w-3.5" />
      </Callout>
    </div>
  )
}
