import { BookOpen } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const GLOSSARY: [string, string][] = [
  ["Plugin", "An add-on for a Selldoes store. It ships a plugin.json manifest, runtime code and (optionally) dashboard UI, storefront pages or a widget."],
  ["Manifest (plugin.json)", "The plugin's identity card: name, description, version, icon, permissions and every capability it declares (jobs, routes, hooks, UI…)."],
  ["Sandbox", "The restricted runtime your code executes in. It can only use permissions your manifest declares and store data it is allowed to see."],
  ["Permission", "A capability you ask the store owner to grant (read data, send email, use AI…). Store owners see them before installing — ask for the minimum."],
  ["allowedTables", "The platform tables your plugin may read or write (e.g. products). Anything else can only touch tables you created yourself."],
  ["API route", "A backend endpoint your UI or storefront calls, e.g. /api/plugin-api/my-plugin/notes. Declared in apiRoutes (dashboard) or publicRoutes (visitors)."],
  ["Job", "A long-running task (an import, a sync) that the host runs in small chunks so it can pause, resume and report progress."],
  ["Tick", "One chunk of a job. The host calls your step() again and again until it returns done: true."],
  ["Hook", "An event your plugin subscribes to (order placed, product updated…). The host calls your handler with a payload."],
  ["Dashboard UI", "An optional page your plugin renders inside the store dashboard, in a sandboxed iframe (ui.entry in the manifest)."],
  ["Storefront widget / page", "A floating bubble on every storefront page, or full public pages your plugin owns such as /kb."],
  ["Marketplace listing", "What other store owners see: your description, icon, screenshots, permissions and price. Created when you publish."],
  ["Publish", "Uploads a release and submits it for admin review. Once approved, stores can install or update it."],
]

export function GlossaryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dismissible className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Plain-language glossary
          </DialogTitle>
        </DialogHeader>
        <dl className="max-h-[65vh] divide-y divide-border overflow-y-auto">
          {GLOSSARY.map(([term, definition]) => (
            <div key={term} className="py-3">
              <dt className="text-[13px] font-bold">{term}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">{definition}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
