
  function inline(text) {
    return text
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
  }

  /** Minimal markdown: paragraphs, **bold**, `code`, - lists (input escaped). */
  function miniMarkdown(body) {
    return escapeHtml(body)
      .split(/\n{2,}/)
      .map(function (block) {
        var lines = block.split("\n")
        if (lines.every(function (line) { return /^\s*[-*]\s+/.test(line) })) {
          return "<ul>" + lines.map(function (line) {
            return "<li>" + inline(line.replace(/^\s*[-*]\s+/, "")) + "</li>"
          }).join("") + "</ul>"
        }
        return "<p>" + lines.map(inline).join("<br/>") + "</p>"
      })
      .join("")
  }

