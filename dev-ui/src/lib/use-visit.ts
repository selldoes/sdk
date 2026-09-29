import * as React from "react"
import { dev } from "@/lib/api"

/** Records a page visit so the Overview checklist can tick itself off. */
export function useVisit(page: string) {
  React.useEffect(() => {
    void dev.visit(page).catch(() => {})
  }, [page])
}
