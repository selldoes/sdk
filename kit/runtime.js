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

  // ── tiny DOM helpers ───────────────────────────────────────────────────────

  function h(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function card(title, description) {
    var wrap = h("section", "kit-card")
    var body = h("div", "kit-card-body")
    if (title || description) {
      var head = h("div", "kit-card-head")
      if (title) head.appendChild(h("h2", "kit-card-title", title))
      if (description) head.appendChild(h("p", "kit-card-desc", description))
      wrap.appendChild(head)
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
    var view = card(str(settings.title, "Data"), route ? route : undefined)
    var head = view.root.querySelector(".kit-card-head")
    var refresh = h("button", "kit-button kit-secondary", "Refresh")
    var headRow = h("div", "kit-card-head kit-row")
    headRow.appendChild(head ? head : h("div"))
    headRow.appendChild(refresh)
    view.root.insertBefore(headRow, view.body)
    if (head) head.remove()

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
          var columns = Array.isArray(settings.columns)
            ? settings.columns.map(String)
            : Object.keys(rows[0] || {}).slice(0, 8)
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
    var view = card(title)
    if (!type) {
      view.body.appendChild(h("p", "kit-muted", "This job runner needs a job type in its settings."))
      return view.root
    }

    var actions = h("div", "kit-actions")
    var run = h("button", "kit-button", "Run " + type)
    actions.appendChild(run)
    view.body.appendChild(actions)

    var progress = h("div", "kit-progress")
    var bar = h("div", "kit-progress-bar")
    var fill = h("div", "kit-progress-fill")
    bar.appendChild(fill)
    var meta = h("p", "kit-progress-meta")
    var status = h("span", "kit-badge", "idle")
    progress.appendChild(status)
    progress.appendChild(bar)
    progress.appendChild(meta)
    progress.hidden = true
    view.body.appendChild(progress)

    var itemsBox = h("div", "kit-items")
    itemsBox.hidden = true
    view.body.appendChild(itemsBox)
    var logBox = h("pre", "kit-log")
    logBox.hidden = true
    view.body.appendChild(logBox)

    function paint(job, detail) {
      progress.hidden = false
      status.textContent = job.status || "?"
      status.className = "kit-badge kit-" + (job.status || "pending")
      var total = Number(job.total) || 0
      var processed = Number(job.processed) || 0
      fill.style.width = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) + "%" : "0"
      var bits = [processed + (total ? "/" + total : "") + " processed"]
      if (job.failed) bits.push(job.failed + " failed")
      if (job.skipped) bits.push(job.skipped + " skipped")
      if (job.progress && job.progress.message) bits.push(job.progress.message)
      if (job.error) bits.push(job.error)
      meta.textContent = bits.join(" · ")
      if (detail && Array.isArray(detail.items) && detail.items.length > 0) {
        itemsBox.hidden = false
        itemsBox.innerHTML = ""
        detail.items.slice(-40).forEach(function (item) {
          var line = h("p", "kit-items-line")
          line.appendChild(h("span", item.status === "ok" ? "kit-ok" : "kit-bad", item.status === "ok" ? "✓" : "✕"))
          line.appendChild(h("span", null, str(item.ref, "item") + (item.error ? " — " + item.error : "")))
          itemsBox.appendChild(line)
        })
      }
      if (detail && Array.isArray(detail.logs) && detail.logs.length > 0) {
        logBox.hidden = false
        logBox.textContent = detail.logs.slice(-60).map(function (entry) {
          return "[" + (entry.level || "info") + "] " + (entry.message || "")
        }).join("\n")
        logBox.scrollTop = logBox.scrollHeight
      }
    }

    function fetchDetail(jobId) {
      return api("/jobs/" + jobId).then(function (body) { return body })
    }

    function advance(job) {
      var isNode = definition.runtime === "node"
      if (isNode) {
        return fetchDetail(job.id).then(function (body) { return { job: body.job, detail: body } })
      }
      return api("/jobs/" + job.id + "/tick", { method: "POST", body: "{}" }).then(function (body) {
        return fetchDetail(job.id).then(function (detail) { return { job: body.job, detail: detail } })
      })
    }

    var TERMINAL = ["completed", "failed", "cancelled"]

    function loop(job) {
      paint(job)
      if (TERMINAL.indexOf(job.status) !== -1) {
        run.disabled = false
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
      api("/jobs", { method: "POST", body: JSON.stringify({ storeId: Number(storeId) || undefined, type: type, input: settings.input || {} }) })
        .then(function (body) { return loop(body.job) })
        .catch(function (error) {
          run.disabled = false
          progress.hidden = false
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

        var save = h("button", "kit-button", "Save settings")
        save.type = "submit"
        form.appendChild(save)
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
          api("/config", { method: "PUT", body: JSON.stringify({ storeId: Number(storeId) || undefined, config: payload }) })
            .then(function () { save.disabled = false; save.textContent = "Saved ✓"; setTimeout(function () { save.textContent = "Save settings" }, 1500) })
            .catch(function (error) { save.disabled = false; form.appendChild(h("p", "kit-error", error.message)) })
        })
      })
      .catch(function (error) {
        form.appendChild(h("p", "kit-error", error.message))
      })
    return view.root
  }

  function renderLogs(settings) {
    var view = card(str(settings.title, "Recent activity"), "Latest job logs for this store.")
    var box = h("pre", "kit-log")
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
    var actions = h("div", "kit-actions")
    items.forEach(function (item) {
      var link = h("a", "kit-button kit-secondary", str(item.label, "link"))
      link.href = str(item.href, "#")
      link.target = "_blank"
      link.rel = "noreferrer"
      actions.appendChild(link)
    })
    view.body.appendChild(actions)
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
      default:
        var view = card()
        view.body.appendChild(h("p", "kit-note", "Unknown component type \"" + String(section.type) + "\" — this runtime doesn't know it yet."))
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
