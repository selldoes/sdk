  // ── tiny DOM helpers ───────────────────────────────────────────────────────

  function h(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  /** Inline lucide-style icon (16px, inherits currentColor). */
  function icon(name) {
    var paths = {
      play: '<polygon points="6 3 20 12 6 21 6 3"/>',
      refresh:
        '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
      external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
      alert:
        '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      chevron: '<path d="m6 9 6 6 6-6"/>',
    }
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("fill", "none")
    svg.setAttribute("stroke", "currentColor")
    svg.setAttribute("stroke-width", "2")
    svg.setAttribute("stroke-linecap", "round")
    svg.setAttribute("stroke-linejoin", "round")
    svg.setAttribute("aria-hidden", "true")
    svg.innerHTML = paths[name] || ""
    return svg
  }

  /**
   * Nesting depth while rendering a `group` section's children: inside a group
   * every card renders "flat" (no border/background/shadow) so a job runner or
   * embedded UI sits directly in the group's card instead of card-in-card.
   */
  var NESTED = 0

  function card(title, description, action) {
    var wrap = h("section", "kit-card")
    if (NESTED > 0) wrap.classList.add("kit-card-flat")
    var body = h("div", "kit-card-body")
    if (title || description || action) {
      var head = h("div", "kit-card-head")
      var text = h("div", "kit-card-head-text")
      if (title) text.appendChild(h("h2", "kit-card-title", title))
      if (description) text.appendChild(h("p", "kit-card-desc", description))
      head.appendChild(text)
      if (action) {
        head.classList.add("kit-row")
        head.appendChild(action)
      }
      wrap.appendChild(head)
    } else {
      body.classList.add("kit-standalone")
    }
    wrap.appendChild(body)
    return { root: wrap, body: body }
  }

  function str(value, fallback) {
    return typeof value === "string" && value ? value : fallback === undefined ? "" : fallback
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
    })
  }
