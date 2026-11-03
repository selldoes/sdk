import * as React from "react"

// ─── Minimal markdown ────────────────────────────────────────────────────────

export function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={index} className="rounded bg-background/70 px-1 py-0.5 text-[11px]">
              {part.slice(1, -1)}
            </code>
          )
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        return <React.Fragment key={index}>{part}</React.Fragment>
      })}
    </>
  )
}

export function Markdownish({ text }: { text: string }) {
  const blocks = text.split(/```/)
  return (
    <div className="space-y-1.5 whitespace-pre-wrap break-words">
      {blocks.map((block, index) =>
        index % 2 === 1 ? (
          <pre key={index} className="overflow-auto rounded-md bg-background/80 p-2 text-[11px] leading-relaxed">
            <code>{block.replace(/^\w*\n/, "")}</code>
          </pre>
        ) : (
          <p key={index}>
            <InlineText text={block} />
          </p>
        ),
      )}
    </div>
  )
}
