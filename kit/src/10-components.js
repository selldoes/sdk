  /**
   * Embedded plugin UI — another of the plugin's own UI files (a hand-written
   * page under ui/) rendered in a sandboxed iframe inside this kit page. The
   * embed auto-resizes: the embedded page posts
   *   parent.postMessage({ type: "selldesk:kit-resize", height }, "*")
   * whenever its content height changes (see ResizeObserver in plugin UIs).
   */
  function renderComponent(settings) {
    var entry = str(settings.entry)
    var view = card(str(settings.title, null), str(settings.description, null))
    if (!entry) {
      var note = h("div", "kit-note")
      note.appendChild(icon("alert"))
      note.appendChild(h("span", null, "No entry set — point `entry` at a file under ui/, e.g. ui/review.html."))
      view.body.appendChild(note)
      return view.root
    }
    var src = entry.replace(/^\.\//, "")
    // Resolve against the ui/ directory, not the kit page's folder: the kit
    // page lives at ui/kit/<name>.html while entries are ui/-relative
    // ("ui/review.html" → sibling "review.html").
    var kitBase = window.location.pathname.replace(/kit\/[^/]*$/, "")
    src = kitBase + src.replace(/^ui\//, "")
    src += (src.indexOf("?") === -1 ? "?" : "&") + scope
    var frame = document.createElement("iframe")
    frame.className = "kit-frame"
    frame.title = str(settings.title, entry)
    frame.src = src
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-modals")
    frame.setAttribute("loading", "lazy")
    frame.style.height = (Number(settings.height) > 0 ? Number(settings.height) : 640) + "px"
    // The frame's current height — remembered so the overlay can be undone.
    var frameHeight = frame.style.height
    var overlayOpen = false
    // A reload means a fresh page: never leave the frame stuck as an overlay.
    frame.addEventListener("load", function () {
      overlayOpen = false
      frame.classList.remove("kit-frame-overlay")
      frame.style.height = frameHeight
    })
    window.addEventListener("message", function (event) {
      if (event.source !== frame.contentWindow) return
      var data = event.data
      if (!data) return
      if (data.type === "selldesk:kit-resize") {
        // Upper bound only guards against broken resize messages; plugin UIs
        // that paginate stay far below it, and an unpaged long list must not
        // be clipped into an inner scrollbar (200k px ≈ never).
        var height = Math.max(160, Math.min(Number(data.height) || 0, 200000))
        // While the frame is a full-page overlay its size is the viewport's.
        if (!overlayOpen) {
          frameHeight = height + "px"
          frame.style.height = frameHeight
        }
        return
      }
      // The embedded page opened a dialog (kit/dialog.js) — bring the frame
      // into view so the modal isn't centered inside an off-screen frame.
      if (data.type === "selldesk:kit-scroll") {
        if (overlayOpen) return
        if (typeof frame.scrollIntoView === "function") {
          try {
            frame.scrollIntoView({ behavior: "smooth", block: "center" })
          } catch (_) {
            frame.scrollIntoView()
          }
        }
        return
      }
      // The embedded page wants its dialog to cover the WHOLE page, not just
      // this frame: the frame leaves the flow and becomes a full-screen
      // overlay until the page closes the dialog again.
      if (data.type === "selldesk:kit-overlay") {
        var open = !!data.open
        if (open && !overlayOpen) {
          overlayOpen = true
          frame.classList.add("kit-frame-overlay")
          frame.style.height = ""
        } else if (!open && overlayOpen) {
          overlayOpen = false
          frame.classList.remove("kit-frame-overlay")
          frame.style.height = frameHeight
        }
        // Acknowledge — the page only switches to the overlay layout when the
        // host confirms it (an older host simply never answers).
        try {
          frame.contentWindow.postMessage({ type: "selldesk:kit-overlay-state", id: data.id, open: open }, "*")
        } catch (_) {}
        return
      }
    })
    view.body.appendChild(frame)
    return view.root
  }

  /**
   * Group — a container that nests other sections inside one card. Supports
   * collapse: the header (title + chevron) toggles the whole body, and the
   * state is remembered per group title in localStorage (falling back to the
   * `defaultOpen` setting). Children render flat (no card-in-card) and keep
   * working while collapsed — running jobs keep ticking, embedded iframes keep
   * auto-resizing; they're just hidden.
   *
   * Settings: { title?, description?, collapsible? = true, defaultOpen? = true,
   *             sections: [ …same shape as the page's sections… ] }
   */
  function renderGroup(settings) {
    var title = str(settings.title, "Group")
    var collapsible = settings.collapsible !== false
    var children = Array.isArray(settings.sections) ? settings.sections : []
    var view = card(title, str(settings.description, null) || undefined)
    var body = view.body
    var storageKey = "selldoes:kit-group:" + SLUG + ":" + title
    var open = settings.defaultOpen !== false
    var toggle = null
    try {
      var stored = window.localStorage.getItem(storageKey)
      if (stored === "open") open = true
      else if (stored === "closed") open = false
    } catch (_) {}

    function apply() {
      body.hidden = !open
      view.root.classList.toggle("kit-collapsed", !open)
      if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false")
    }

    if (collapsible) {
      view.root.classList.add("kit-card-group")
      var head = view.root.querySelector(".kit-card-head")
      if (head) {
        head.classList.add("kit-card-head-toggle")
        toggle = h("button", "kit-collapse-toggle")
        toggle.type = "button"
        toggle.setAttribute("aria-label", "Collapse / expand " + title)
        toggle.appendChild(icon("chevron"))
        head.appendChild(toggle)
        // Clicking anywhere on the header toggles; the button keeps it
        // keyboard-accessible (Enter/Space click bubbles up).
        head.addEventListener("click", function () {
          open = !open
          apply()
          try {
            window.localStorage.setItem(storageKey, open ? "open" : "closed")
          } catch (_) {}
        })
      }
    }

    apply()
    NESTED++
    try {
      children.forEach(function (section) {
        var node = renderSection(section || {})
        if (node) body.appendChild(node)
      })
    } finally {
      NESTED--
    }
    if (children.length === 0) {
      body.appendChild(
        h("p", "kit-muted", "This group has no sections yet — add nested components in the manifest or the visual builder."),
      )
    }
    return view.root
  }
