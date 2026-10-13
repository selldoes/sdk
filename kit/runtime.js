/*
 * Selldoes kit runtime.
 *
 * Renders a compiled `dashboardPages[].sections` page inside the sandboxed
 * dashboard iframe. The SDK copies this file into every plugin that uses kit
 * components, so the preview and the store run the exact same renderer — one
 * implementation, no per-host copies.
 *
 * Host calls (all same-origin, session-authenticated):
 *   table   → GET  /api/plugin-api/{slug}{route}?storeId&storeSlug
 *   job     → POST /api/plugins/{slug}/jobs, POST .../jobs/{id}/tick,
 *             GET  .../jobs/{id} (node jobs are polled, quickjs jobs tick)
 *   settings→ GET/PUT /api/plugins/{slug}/config?storeId
 *   logs    → GET  /api/plugins/{slug}/jobs?storeId + .../jobs/{id}
 */
(function () {
  "use strict"

  var DATA = window.__SELDOES_KIT__ || {}
  var SLUG = String(DATA.slug || "")
  var SECTIONS = Array.isArray(DATA.sections) ? DATA.sections : []
  var JOBS = Array.isArray(DATA.jobs) ? DATA.jobs : []

  var params = new URLSearchParams(window.location.search)
  var storeId = params.get("storeId") || String((DATA.store && DATA.store.id) || "")
  var storeSlug = params.get("storeSlug") || String((DATA.store && DATA.store.slug) || "")
  var scope = "storeId=" + encodeURIComponent(storeId) + "&storeSlug=" + encodeURIComponent(storeSlug)

  var TERMINAL = ["completed", "failed", "cancelled"]

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

  // ── host API ───────────────────────────────────────────────────────────────

  function request(url, options) {
    return fetch(url, Object.assign({ headers: { "Content-Type": "application/json" } }, options || {}))
      .then(function (response) {
        return response.json().catch(function () { return {} }).then(function (body) {
          if (!response.ok || body.error) throw new Error(body.error || "Request failed (" + response.status + ")")
          return body
        })
      })
  }

  function api(path, options) {
    return request("/api/plugins/" + SLUG + path + (path.indexOf("?") === -1 ? "?" + scope : "&" + scope), options)
  }

  function apiRoute(route) {
    var path = route.charAt(0) === "/" ? route : "/" + route
    return request("/api/plugin-api/" + SLUG + path + "?" + scope)
  }

  // ── section renderers ──────────────────────────────────────────────────────

  function renderText(settings) {
    var title = str(settings.title)
    var body = str(settings.body)
    if (!title && !body) return null
    var view = card(title)
    var markdown = h("div", "kit-markdown")
    markdown.innerHTML = miniMarkdown(body)
    view.body.appendChild(markdown)
    return view.root
  }

  function renderStats(settings) {
    var items = Array.isArray(settings.items) ? settings.items : []
    if (items.length === 0) return null
    var view = card()
    view.body.classList.add("kit-standalone")
    var grid = h("div", "kit-stats")
    items.forEach(function (item) {
      var stat = h("div", "kit-stat")
      stat.appendChild(h("p", "kit-stat-label", str(item.label, "stat")))
      stat.appendChild(h("p", "kit-stat-value", str(item.value, "—")))
      if (item.hint) stat.appendChild(h("p", "kit-stat-hint", str(item.hint)))
      grid.appendChild(stat)
    })
    view.body.appendChild(grid)
    return view.root
  }

  function renderTable(settings) {
    var route = str(settings.route)
    var refresh = h("button", "kit-button kit-outline")
    refresh.appendChild(icon("refresh"))
    refresh.appendChild(h("span", null, "Refresh"))
    var view = card(str(settings.title, "Data"), route ? route : undefined, refresh)

    var container = h("div", null)
    view.body.appendChild(container)

    function load() {
      container.innerHTML = ""
      container.appendChild(h("p", "kit-muted", "Loading…"))
      apiRoute(route)
        .then(function (body) {
          var rows = Array.isArray(body) ? body : Array.isArray(body.rows) ? body.rows : Array.isArray(body.items) ? body.items : null
          if (!rows) {
            var nested = body && typeof body === "object"
              ? Object.keys(body).map(function (key) { return body[key] }).find(function (value) { return Array.isArray(value) })
              : null
            rows = nested || []
          }
          container.innerHTML = ""
          if (rows.length === 0) {
            container.appendChild(h("p", "kit-muted", "No rows."))
            return
          }
          var columns = Array.isArray(settings.columns) && settings.columns.length > 0
            ? settings.columns.map(String)
            : Object.keys(rows.reduce(function (all, row) {
                Object.keys(row || {}).forEach(function (key) { all[key] = true })
                return all
              }, {})).slice(0, 8)
          var wrap = h("div", "kit-table-wrap")
          var table = h("table", "kit-table")
          var thead = h("thead")
          var headTr = h("tr")
          columns.forEach(function (column) { headTr.appendChild(h("th", null, column)) })
          thead.appendChild(headTr)
          table.appendChild(thead)
          var tbody = h("tbody")
          rows.slice(0, Number(settings.maxRows) || 50).forEach(function (row) {
            var tr = h("tr")
            columns.forEach(function (column) {
              var value = row[column]
              tr.appendChild(h("td", null, value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)))
            })
            tbody.appendChild(tr)
          })
          table.appendChild(tbody)
          wrap.appendChild(table)
          container.appendChild(wrap)
        })
        .catch(function (error) {
          container.innerHTML = ""
          container.appendChild(h("p", "kit-error", error.message))
        })
    }

    refresh.addEventListener("click", load)
    if (route) load()
    else container.appendChild(h("p", "kit-muted", "This table needs a route in its settings."))
    return view.root
  }

  function renderJob(settings) {
    var type = str(settings.job)
    var definition = JOBS.find(function (job) { return job.type === type }) || {}
    var title = str(settings.title, type ? "Job: " + type : "Job")
    var view = card(title, settings.description ? str(settings.description) : undefined)
    if (!type) {
      view.body.appendChild(h("p", "kit-muted", "This job runner needs a job type in its settings."))
      return view.root
    }

    var run = h("button", "kit-button")
    run.appendChild(icon("play"))
    var runLabel = h("span", null, "Run " + type)
    run.appendChild(runLabel)
    view.body.appendChild(run)

    var transcript = h("div", "kit-transcript")
    transcript.style.display = "none"
    var statusRow = h("div", "kit-status-row")
    var status = h("span", "kit-badge", "idle")
    var meta = h("span", "kit-meta", "")
    statusRow.appendChild(status)
    statusRow.appendChild(meta)
    var progressWrap = h("div", "kit-progress")
    var fill = h("div", "kit-progress-fill")
    progressWrap.appendChild(fill)
    var itemsBox = h("div", "kit-items")
    var logsDetails = h("details", "kit-details")
    logsDetails.style.display = "none"
    var logsSummary = h("summary", null, "logs")
    var logBox = h("pre", "kit-pre")
    logsDetails.appendChild(logsSummary)
    logsDetails.appendChild(logBox)
    var resultBox = h("pre", "kit-pre kit-result")
    resultBox.style.display = "none"
    transcript.appendChild(statusRow)
    transcript.appendChild(progressWrap)
    transcript.appendChild(itemsBox)
    transcript.appendChild(logsDetails)
    transcript.appendChild(resultBox)
    view.body.appendChild(transcript)

    function paint(job, detail) {
      transcript.style.display = ""
      var statusText = job.status === "paused" ? "paused at tick limit" : job.status || "?"
      status.textContent = statusText
      status.className = "kit-badge kit-" + (job.status || "pending")
      var total = Number(job.total) || 0
      var processed = Number(job.processed) || 0
      fill.style.width = total > 0
        ? Math.min(100, Math.round((processed / total) * 100)) + "%"
        : job.status === "completed" ? "100%" : "0"
      var bits = []
      if (processed || total) bits.push(processed + (total ? "/" + total : "") + " processed")
      if (job.failed) bits.push(job.failed + " failed")
      if (job.skipped) bits.push(job.skipped + " skipped")
      if (job.progress && job.progress.message) bits.push(job.progress.message)
      if (job.error) bits.push(job.error)
      meta.textContent = bits.join(" · ")

      if (detail && Array.isArray(detail.items) && detail.items.length > 0) {
        itemsBox.innerHTML = ""
        var wrap = h("div", "kit-table-wrap")
        var table = h("table", "kit-table")
        var thead = h("thead")
        var headTr = h("tr")
        ;["Item", "Status", "Detail"].forEach(function (label) { headTr.appendChild(h("th", null, label)) })
        thead.appendChild(headTr)
        table.appendChild(thead)
        var tbody = h("tbody")
        detail.items.slice(-20).forEach(function (item) {
          var tr = h("tr")
          var refTd = h("td")
          refTd.appendChild(h("code", null, str(item.ref, "item")))
          tr.appendChild(refTd)
          tr.appendChild(h("td", null, str(item.status, "")))
          var detailText = item.error || (item.data ? JSON.stringify(item.data) : item.productId ? "#" + item.productId : "")
          tr.appendChild(h("td", "kit-muted", detailText))
          tbody.appendChild(tr)
        })
        table.appendChild(tbody)
        wrap.appendChild(table)
        itemsBox.appendChild(wrap)
      }

      if (detail && Array.isArray(detail.logs) && detail.logs.length > 0) {
        logsDetails.style.display = ""
        logsSummary.textContent = "Show " + detail.logs.length + " log line(s)"
        logBox.textContent = detail.logs.map(function (entry) {
          return "[" + (entry.level || "info") + "] " + (entry.message || "")
        }).join("\n")
        logBox.scrollTop = logBox.scrollHeight
      }

      if (TERMINAL.indexOf(job.status) !== -1) {
        resultBox.style.display = ""
        try {
          resultBox.textContent = JSON.stringify(job.result !== undefined && job.result !== null ? job.result : { status: job.status }, null, 2)
        } catch (_) {
          resultBox.textContent = ""
        }
      }
    }

    function fetchDetail(jobId) {
      return api("/jobs/" + jobId)
    }

    function advance(job) {
      if (definition.runtime === "node") {
        return fetchDetail(job.id).then(function (body) { return { job: body.job, detail: body } })
      }
      return api("/jobs/" + job.id + "/tick", { method: "POST", body: "{}" }).then(function (body) {
        return fetchDetail(job.id).then(function (detail) { return { job: body.job, detail: detail } })
      })
    }

    function loop(job) {
      paint(job)
      if (TERMINAL.indexOf(job.status) !== -1) {
        run.disabled = false
        runLabel.textContent = "Run " + type
        return fetchDetail(job.id).then(function (body) { paint(body.job || job, body) }).catch(function () {})
      }
      return advance(job).then(function (result) {
        paint(result.job || job, result.detail)
        return new Promise(function (resolve) { setTimeout(resolve, definition.runtime === "node" ? 3000 : 300) }).then(function () {
          return loop(result.job || job)
        })
      })
    }

    run.addEventListener("click", function () {
      run.disabled = true
      runLabel.textContent = "Running…"
      api("/jobs", { method: "POST", body: JSON.stringify({ storeId: Number(storeId) || undefined, type: type, input: settings.input || {} }) })
        .then(function (body) { return loop(body.job) })
        .catch(function (error) {
          run.disabled = false
          runLabel.textContent = "Run " + type
          transcript.style.display = ""
          status.textContent = "failed"
          status.className = "kit-badge kit-failed"
          meta.textContent = error.message
        })
    })
    return view.root
  }

  function renderSettings() {
    var view = card("Settings", "From configSchema — saved values merge into ctx.config.")
    var form = h("form", "kit-form")
    view.body.appendChild(form)
    api("/config")
      .then(function (body) {
        var schema = (body.plugin && body.plugin.configSchema) || []
        var values = body.config || {}
        if (schema.length === 0) {
          form.appendChild(h("p", "kit-muted", "No configSchema declared — add settings fields in plugin.json to render a form here."))
          return
        }
        var inputs = {}
        schema.forEach(function (field) {
          var wrap = h("div", "kit-field")
          if (field.type !== "boolean") {
            var label = h("label", null, field.label || field.key)
            if (field.required) {
              var required = h("span", "kit-required", " *")
              label.appendChild(required)
            }
            label.setAttribute("for", "kit-" + field.key)
            wrap.appendChild(label)
          }
          var input
          if (field.type === "boolean") {
            var switchWrap = h("label", "kit-switch")
            input = h("input")
            input.type = "checkbox"
            input.checked = Boolean(values[field.key] !== undefined ? values[field.key] : field.default)
            switchWrap.appendChild(input)
            switchWrap.appendChild(h("span", null, field.label || field.key))
            wrap.appendChild(switchWrap)
          } else if (field.type === "select") {
            input = h("select")
            ;(field.options || []).forEach(function (option) {
              var node = h("option", null, option.label || option.value)
              node.value = option.value
              input.appendChild(node)
            })
            input.value = String(values[field.key] !== undefined ? values[field.key] : field.default || "")
            wrap.appendChild(input)
          } else if (field.type === "text") {
            input = h("textarea")
            input.value = String(values[field.key] !== undefined ? values[field.key] : field.default || "")
            input.placeholder = field.placeholder || ""
            wrap.appendChild(input)
          } else {
            input = h("input")
            input.type = field.type === "number" ? "number" : field.type === "secret" ? "password" : "text"
            input.value = String(values[field.key] !== undefined ? values[field.key] : field.default || "")
            input.placeholder = field.placeholder || ""
            wrap.appendChild(input)
          }
          if (field.description) wrap.appendChild(h("p", "kit-help", field.description))
          inputs[field.key] = { input: input, field: field }
          form.appendChild(wrap)
        })

        var save = h("button", "kit-button")
        save.type = "submit"
        save.textContent = "Save settings"
        var saveWrap = h("div", null)
        saveWrap.appendChild(save)
        form.appendChild(saveWrap)
        form.addEventListener("submit", function (event) {
          event.preventDefault()
          var payload = {}
          Object.keys(inputs).forEach(function (key) {
            var entry = inputs[key]
            if (entry.field.type === "boolean") payload[key] = entry.input.checked
            else if (entry.field.type === "number") payload[key] = Number(entry.input.value)
            else payload[key] = entry.input.value
          })
          save.disabled = true
          save.textContent = "Saving…"
          api("/config", { method: "PUT", body: JSON.stringify({ storeId: Number(storeId) || undefined, config: payload }) })
            .then(function () {
              save.disabled = false
              save.textContent = "Saved ✓"
              setTimeout(function () { save.textContent = "Save settings" }, 1500)
            })
            .catch(function (error) {
              save.disabled = false
              save.textContent = "Save settings"
              form.appendChild(h("p", "kit-error", error.message))
            })
        })
      })
      .catch(function (error) {
        form.appendChild(h("p", "kit-error", error.message))
      })
    return view.root
  }

  function renderLogs(settings) {
    var view = card(str(settings.title, "Recent activity"), "Latest job logs for this store.")
    var box = h("pre", "kit-pre")
    box.textContent = "Loading…"
    view.body.appendChild(box)
    var count = Number(settings.lines) || 20
    api("/jobs?limit=5")
      .then(function (body) {
        var jobs = Array.isArray(body.jobs) ? body.jobs : []
        if (jobs.length === 0) {
          box.textContent = "(no jobs yet)"
          return
        }
        return api("/jobs/" + jobs[0].id).then(function (detail) {
          var logs = Array.isArray(detail.logs) ? detail.logs : []
          box.textContent = logs.slice(-count).map(function (entry) {
            return "[" + (entry.level || "info") + "] " + (entry.message || "")
          }).join("\n") || "(no log lines yet)"
        })
      })
      .catch(function (error) { box.textContent = error.message })
    return view.root
  }

  function renderLinks(settings) {
    var items = Array.isArray(settings.items) ? settings.items : []
    if (items.length === 0) return null
    var view = card()
    view.body.classList.add("kit-standalone")
    var actions = h("div", "kit-actions")
    items.forEach(function (item) {
      var link = h("a", "kit-button kit-outline")
      link.href = str(item.href, "#")
      link.target = "_blank"
      link.rel = "noreferrer"
      link.appendChild(h("span", null, str(item.label, "link")))
      link.appendChild(icon("external"))
      actions.appendChild(link)
    })
    view.body.appendChild(actions)
    return view.root
  }

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
    window.addEventListener("message", function (event) {
      if (event.source !== frame.contentWindow) return
      var data = event.data
      if (!data) return
      if (data.type === "selldesk:kit-resize") {
        var height = Math.max(160, Math.min(Number(data.height) || 0, 12000))
        frame.style.height = height + "px"
        return
      }
      // The embedded page opened a dialog (kit/dialog.js) — bring the frame
      // into view so the modal isn't centered inside an off-screen frame.
      if (data.type === "selldesk:kit-scroll") {
        if (typeof frame.scrollIntoView === "function") {
          try {
            frame.scrollIntoView({ behavior: "smooth", block: "center" })
          } catch (_) {
            frame.scrollIntoView()
          }
        }
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

  function renderSection(section) {
    var settings = section.settings || {}
    switch (section.type) {
      case "text": return renderText(settings)
      case "stats": return renderStats(settings)
      case "table": return renderTable(settings)
      case "job": return renderJob(settings)
      case "settings": return renderSettings()
      case "logs": return renderLogs(settings)
      case "links": return renderLinks(settings)
      case "component": return renderComponent(settings)
      case "group": return renderGroup(settings)
      default:
        var view = card()
        view.root.classList.add("kit-dashed")
        view.body.classList.add("kit-standalone")
        var note = h("div", "kit-note")
        note.appendChild(icon("alert"))
        note.appendChild(h("span", null, 'Unknown component type "' + String(section.type) + '" — this runtime doesn\'t know it yet.'))
        view.body.appendChild(note)
        return view.root
    }
  }

  var root = document.getElementById("kit-root")
  if (!root) return
  var stack = h("div", "kit-stack")
  SECTIONS.forEach(function (section) {
    var node = renderSection(section || {})
    if (node) stack.appendChild(node)
  })
  root.appendChild(stack)
})()
