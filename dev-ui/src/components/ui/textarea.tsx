import * as React from "react"
import { cn } from "@/lib/utils"

interface TextareaProps extends React.ComponentProps<"textarea"> {
  disableAutoResize?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, value, onChange, disableAutoResize, ...props }, ref) => {
    const internalRef = React.useRef<HTMLTextAreaElement | null>(null)

    const syncHeight = React.useCallback((el: HTMLTextAreaElement) => {
      el.style.height = "auto"
      const rows = Number(el.getAttribute("rows") || 0)
      const minByRows = rows ? rows * 20 + 16 : 60
      const minHeight = Math.max(minByRows, 60)
      el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
    }, [])

    const setRef = React.useCallback(
      (el: HTMLTextAreaElement | null) => {
        internalRef.current = el
        if (typeof ref === "function") ref(el)
        else if (ref) ref.current = el
      },
      [ref],
    )

    React.useEffect(() => {
      if (disableAutoResize) return
      const el = internalRef.current
      if (el) syncHeight(el)
    }, [value, syncHeight, disableAutoResize])

    if (disableAutoResize) {
      return (
        <textarea
          className={cn(
            "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className,
          )}
          ref={ref}
          {...props}
        />
      )
    }

    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm resize-y overflow-y-auto",
          className,
        )}
        ref={setRef}
        value={value}
        onChange={(event) => {
          syncHeight(event.target)
          onChange?.(event)
        }}
        {...props}
      />
    )
  },
)
Textarea.displayName = "Textarea"

export { Textarea }
