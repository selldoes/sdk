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
 *
 * Generated from kit/src/*.js by `npm run build:kit` (scripts/build-kit.mjs).
 * Edit the fragments in kit/src/, not this file.
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
    return request("/api/plugin-api/" + SLUG + path + (path.indexOf("?") === -1 ? "?" : "&") + scope)
  }

  /**
   * Dynamic options for a field/section: GETs a plugin API route and accepts
   * `{ options: [...] }`, a raw array, or `{ prompts: [...] }` (the ctx.ai
   * prompt library). Options may be plain `{ value, label }` or rich rows
   * `{ value, title, subtitle, meta, price, pinned }` — the rich select renders
   * title (bold), subtitle (e.g. green pricing), meta (muted) and sorts by
   * `price`. Any failure resolves to null so the caller can show "None found".
   */
  function fetchOptions(source) {
    var path = String(source)
    var url = path.indexOf("/api/") === 0 ? path : null
    var request$ = url ? request(path) : apiRoute(path)
    return request$
      .then(function (body) {
        var list = Array.isArray(body)
          ? body
          : body && Array.isArray(body.options)
            ? body.options
            : body && Array.isArray(body.prompts)
              ? body.prompts.map(function (prompt) {
                  return { value: prompt.id, label: (prompt.name || prompt.id) + " (id " + prompt.id + ")" }
                })
              : null
        if (!list) return null
        return list.map(function (item) {
          if (item === null || item === undefined || typeof item !== "object") {
            return { value: item, label: String(item) }
          }
          var value = item.value !== undefined ? item.value : item
          var label = item.label !== undefined ? item.label : item.title !== undefined ? item.title : String(value)
          var option = { value: value, label: label }
          if (item.title !== undefined) option.title = item.title
          if (item.subtitle !== undefined) option.subtitle = item.subtitle
          if (item.meta !== undefined) option.meta = item.meta
          if (item.price !== undefined) option.price = item.price
          if (item.pinned !== undefined) option.pinned = item.pinned
          return option
        })
      })
      .catch(function () {
        return null
      })
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

  /**
   * The transcript of one job run: its per-item results, its log lines and
   * its final result. Shared by the job card (the live run) and the job
   * history.
   */
  function jobTranscript(job, box, lines) {
    return api("/jobs/" + job.id).then(function (detail) {
      var items = Array.isArray(detail.items) ? detail.items : []
      var logs = Array.isArray(detail.logs) ? detail.logs : []
      var count = Math.max(1, Number(lines) || 20)
      box.innerHTML = ""
      if (items.length > 0) {
        var wrap = h("div", "kit-table-wrap")
        var table = h("table", "kit-table")
        var thead = h("thead")
        var headTr = h("tr")
        ;["Item", "Status", "Detail"].forEach(function (label) { headTr.appendChild(h("th", null, label)) })
        thead.appendChild(headTr)
        table.appendChild(thead)
        var tbody = h("tbody")
        items.slice(-count).forEach(function (item) {
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
        box.appendChild(wrap)
      }
      if (logs.length > 0) {
        var pre = h("pre", "kit-pre")
        pre.textContent = logs.slice(-count).map(function (entry) {
          return "[" + (entry.level || "info") + "] " + (entry.message || "")
        }).join("\n")
        pre.scrollTop = pre.scrollHeight
        box.appendChild(pre)
      }
      var result = detail.job && detail.job.result
      if (result !== undefined && result !== null) {
        var resultBox = h("pre", "kit-pre kit-result")
        try {
          resultBox.textContent = JSON.stringify(result, null, 2)
        } catch (_) {
          resultBox.textContent = ""
        }
        box.appendChild(resultBox)
      }
      if (!items.length && !logs.length && (result === undefined || result === null)) {
        box.appendChild(h("p", "kit-muted", "No transcript for this job."))
      }
    }).catch(function (error) {
      box.innerHTML = ""
      box.appendChild(h("p", "kit-error", error.message))
    })
  }

  /** "3m ago" for an ISO timestamp. */
  function jobAgo(iso) {
    if (!iso) return ""
    var then = new Date(iso).getTime()
    if (!isFinite(then)) return ""
    var seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
    if (seconds < 60) return seconds + "s ago"
    if (seconds < 3600) return Math.round(seconds / 60) + "m ago"
    if (seconds < 86400) return Math.round(seconds / 3600) + "h ago"
    return Math.round(seconds / 86400) + "d ago"
  }

  /** "1m 12s" between two timestamps. */
  function jobDuration(job) {
    if (!job.startedAt || !job.completedAt) return ""
    var ms = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
    if (!isFinite(ms) || ms < 0) return ""
    if (ms < 1000) return ms + "ms"
    if (ms < 60000) return Math.round(ms / 1000) + "s"
    return Math.round(ms / 60000) + "m " + Math.round((ms % 60000) / 1000) + "s"
  }

  /** One row of the job history: status, name, counters, duration, "x ago". */
  function jobRunRow(job, names, lines) {
    var wrap = h("details", "kit-joblog-row")
    wrap.dataset.job = String(job.id)
    var summary = h("summary")
    summary.appendChild(h("span", "kit-badge kit-" + (job.status || "pending"), job.status || "pending"))
    summary.appendChild(h("span", "kit-joblog-name", (names && names[job.type]) || job.type))
    var bits = []
    var total = Number(job.total) || 0
    var processed = Number(job.processed) || 0
    if (processed || total) bits.push(processed + (total ? "/" + total : "") + " processed")
    if (job.failed) bits.push(job.failed + " failed")
    if (job.skipped) bits.push(job.skipped + " skipped")
    if (job.runtime) bits.push(job.runtime)
    var took = jobDuration(job)
    if (took) bits.push(took)
    if (job.error) bits.push(job.error)
    summary.appendChild(h("span", "kit-meta", bits.join(" · ")))
    summary.appendChild(h("span", "kit-meta kit-joblog-when", jobAgo(job.completedAt || job.startedAt || job.createdAt)))
    wrap.appendChild(summary)
    var body = h("div", "kit-joblog-detail")
    wrap.appendChild(body)
    wrap.addEventListener("toggle", function () {
      if (!wrap.open || wrap.dataset.loaded) return
      wrap.dataset.loaded = "1"
      body.appendChild(h("p", "kit-muted", "Loading…"))
      jobTranscript(job, body, lines)
    })
    return wrap
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

    // The previous runs of THIS job — the history right where the job lives.
    var runsDetails = h("details", "kit-details kit-jobruns")
    var runsSummary = h("summary", null, "previous runs")
    var runsList = h("div", "kit-joblog")
    runsDetails.appendChild(runsSummary)
    runsDetails.appendChild(runsList)
    view.body.appendChild(runsDetails)
    var loadRuns = function () {
      return api("/jobs?limit=25").then(function (body) {
        var jobs = (Array.isArray(body.jobs) ? body.jobs : []).filter(function (job) { return job.type === type })
        runsList.innerHTML = ""
        runsSummary.textContent = "previous runs (" + jobs.length + ")"
        if (!jobs.length) {
          runsList.appendChild(h("p", "kit-muted", "This job has not run yet."))
          return
        }
        var names = {}
        JOBS.forEach(function (job) { names[job.type] = job.name || job.type })
        jobs.slice(0, 8).forEach(function (job) { runsList.appendChild(jobRunRow(job, names, 20)) })
      }).catch(function () {
        runsList.innerHTML = ""
        runsList.appendChild(h("p", "kit-muted", "The run history is not available."))
      })
    }
    void loadRuns()
    runsDetails.addEventListener("toggle", function () {
      if (runsDetails.open) void loadRuns()
    })

    var lastPaintKey = ""
    function paint(job, detail) {
      // Repainting rebuilds transcript rows and kills any text selection —
      // only touch the DOM when something actually changed.
      var itemsCount = detail && Array.isArray(detail.items) ? detail.items.length : 0
      var logsCount = detail && Array.isArray(detail.logs) ? detail.logs.length : 0
      var paintKey = [job.status, job.total, job.processed, job.failed, job.skipped, job.error,
        job.progress && job.progress.message, itemsCount, logsCount].join("|")
      if (paintKey === lastPaintKey) return
      lastPaintKey = paintKey
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
      lastPaintKey = ""
      var body = { storeId: Number(storeId) || undefined, type: type, input: settings.input || {} }
      if (Number(settings.maxTicks)) body.maxTicks = Number(settings.maxTicks)
      api("/jobs", { method: "POST", body: JSON.stringify(body) })
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

  // ── rich model select ───────────────────────────────────────────────────────
  //
  // A custom dropdown for model-style options: each row shows the name (bold),
  // a subtitle (pricing, rendered green) and a muted meta column (vendor), with
  // search and a price/name sort. The native <select> can't style option rows,
  // so this is built from a trigger + an in-flow listbox (it grows the page
  // instead of floating, so it can't be clipped by the dashboard iframe).
  //
  // Options come from `optionsFrom` (or a static `options` array):
  //   { value, title, subtitle, meta, price, pinned }
  // `price` (number) drives the default "lowest price first" sort; `pinned`
  // rows (e.g. "Store default") stay on top. Falls back to `label` for plain
  // options.
  function renderRichSelect(field, initialValue, onChange) {
    var root = h("div", "kit-mselect")
    var value = initialValue === undefined || initialValue === null ? "" : String(initialValue)
    var options = []
    var disabled = true
    var open = false
    var sort = field.sort || "price-asc"
    var query = ""

    function title(option) { return String(option.title !== undefined ? option.title : option.label !== undefined ? option.label : option.value) }
    function subtitle(option) { return option.subtitle ? String(option.subtitle) : "" }
    function meta(option) { return option.meta ? String(option.meta) : "" }
    function price(option) {
      var n = Number(option.price)
      return Number.isFinite(n) ? n : null
    }

    var trigger = h("button", "kit-mselect-trigger")
    trigger.type = "button"
    trigger.id = "kit-" + field.key
    trigger.setAttribute("aria-haspopup", "listbox")
    trigger.setAttribute("aria-expanded", "false")
    var triggerLabel = h("span", "kit-mselect-value")
    trigger.appendChild(triggerLabel)
    var caret = h("span", "kit-mselect-caret")
    caret.appendChild(icon("chevron"))
    trigger.appendChild(caret)
    root.appendChild(trigger)

    var panel = h("div", "kit-mselect-panel")
    panel.hidden = true
    var controls = h("div", "kit-mselect-controls")
    var search = h("input", "kit-mselect-search")
    search.type = "text"
    search.placeholder = field.searchPlaceholder || "Search…"
    search.setAttribute("aria-label", "Search options")
    controls.appendChild(search)
    var sortSelect = h("select", "kit-mselect-sort")
    sortSelect.setAttribute("aria-label", "Sort options")
    ;[
      ["price-asc", "Price: low → high"],
      ["price-desc", "Price: high → low"],
      ["name", "Name (A–Z)"],
    ].forEach(function (pair) {
      var option = h("option", null, pair[1])
      option.value = pair[0]
      sortSelect.appendChild(option)
    })
    sortSelect.value = sort
    controls.appendChild(sortSelect)
    panel.appendChild(controls)
    var list = h("div", "kit-mselect-list")
    list.setAttribute("role", "listbox")
    panel.appendChild(list)
    var empty = h("p", "kit-mselect-empty", "No options match your search.")
    empty.hidden = true
    panel.appendChild(empty)
    root.appendChild(panel)

    function visibleOptions() {
      var filtered = options.filter(function (option) {
        if (!query) return true
        var hay = (title(option) + " " + subtitle(option) + " " + meta(option)).toLowerCase()
        return hay.indexOf(query) !== -1
      })
      return filtered.slice().sort(function (a, b) {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
        if (sort === "name") return title(a).localeCompare(title(b))
        var pa = price(a)
        var pb = price(b)
        var va = pa === null ? Infinity : pa
        var vb = pb === null ? Infinity : pb
        if (va !== vb) return sort === "price-desc" ? vb - va : va - vb
        return title(a).localeCompare(title(b))
      })
    }

    function renderList() {
      list.innerHTML = ""
      var rows = visibleOptions()
      empty.hidden = rows.length > 0
      rows.forEach(function (option) {
        var row = h("button", "kit-mselect-option")
        row.type = "button"
        row.setAttribute("role", "option")
        if (String(option.value) === value) {
          row.classList.add("is-selected")
          row.setAttribute("aria-selected", "true")
        }
        var main = h("span", "kit-mselect-option-main")
        main.appendChild(h("span", "kit-mselect-option-title", title(option)))
        if (subtitle(option)) main.appendChild(h("span", "kit-mselect-option-sub", subtitle(option)))
        row.appendChild(main)
        if (meta(option)) row.appendChild(h("span", "kit-mselect-option-meta", meta(option)))
        row.addEventListener("click", function () {
          value = String(option.value)
          updateTrigger()
          close()
          if (onChange) onChange(value)
        })
        list.appendChild(row)
      })
    }

    function current() {
      for (var i = 0; i < options.length; i++) {
        if (String(options[i].value) === value) return options[i]
      }
      return null
    }

    function updateTrigger() {
      triggerLabel.innerHTML = ""
      var option = current()
      if (!option) {
        triggerLabel.appendChild(h("span", "kit-mselect-placeholder", value || field.placeholder || "Select…"))
        return
      }
      triggerLabel.appendChild(h("span", "kit-mselect-option-title", title(option)))
      if (subtitle(option)) triggerLabel.appendChild(h("span", "kit-mselect-option-sub", subtitle(option)))
    }

    function openPanel() {
      if (disabled) return
      open = true
      panel.hidden = false
      trigger.setAttribute("aria-expanded", "true")
      root.classList.add("is-open")
      renderList()
      if (typeof search.focus === "function") search.focus()
    }
    function close() {
      open = false
      panel.hidden = true
      trigger.setAttribute("aria-expanded", "false")
      root.classList.remove("is-open")
      query = ""
      search.value = ""
    }
    trigger.addEventListener("click", function () {
      if (open) close()
      else openPanel()
    })
    search.addEventListener("input", function () {
      query = search.value.trim().toLowerCase()
      renderList()
    })
    sortSelect.addEventListener("change", function () {
      sort = sortSelect.value
      renderList()
    })
    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && open) {
        close()
        trigger.focus()
      }
    })
    document.addEventListener("click", function (event) {
      if (open && !root.contains(event.target)) close()
    })

    function setOptions(next) {
      options = Array.isArray(next) ? next : []
      if (options.length === 0) {
        disabled = true
        trigger.disabled = true
        triggerLabel.innerHTML = ""
        triggerLabel.appendChild(h("span", "kit-mselect-placeholder", "None found"))
        return
      }
      disabled = false
      trigger.disabled = false
      var known = options.some(function (option) {
        return String(option.value) === value
      })
      // Keep the saved value when it still exists; otherwise fall back to the
      // top of the sorted list — a blank control would look unconfigured.
      if (!known) value = String(visibleOptions()[0].value)
      updateTrigger()
      if (open) renderList()
    }

    trigger.disabled = true
    triggerLabel.appendChild(h("span", "kit-mselect-placeholder", "Loading…"))
    var loader = field.optionsFrom ? fetchOptions(field.optionsFrom) : Promise.resolve(field.options || [])
    loader.then(function (next) {
      setOptions(next === null ? [] : next)
    })

    return {
      root: root,
      read: function () { return value },
      isDisabled: function () { return disabled },
    }
  }

  /**
   * Renders one configSchema field. Returns `{ root, field, read, isDisabled }`.
   * `onChange` fires after a rich control changes (the standalone `field`
   * section saves immediately; the settings form ignores it).
   */
  function renderField(field, initialValue, onChange) {
    var wrap = h("div", "kit-field")
    if (field.type !== "boolean") {
      var label = h("label", null, field.label || field.key)
      if (field.required) label.appendChild(h("span", "kit-required", " *"))
      label.setAttribute("for", "kit-" + field.key)
      wrap.appendChild(label)
    }
    var read
    var isDisabled = function () { return false }
    var isRich = field.type === "model-select" || (field.type === "select" && field.display === "rich")

    // A saved empty value means "not set" — fall back to the declared default,
    // the same way the runtime merges configSchema defaults into ctx.config.
    // Without this, a field the merchant cleared (or that was stored as "")
    // rendered blank even though the runtime used its default.
    var initial = initialValue
    if (initial === undefined || initial === null || initial === "") initial = field.default
    var asText = function (value) { return value === undefined || value === null ? "" : String(value) }

    if (field.type === "boolean") {
      var switchWrap = h("label", "kit-switch")
      var checkbox = h("input")
      checkbox.type = "checkbox"
      checkbox.checked = Boolean(initial)
      switchWrap.appendChild(checkbox)
      switchWrap.appendChild(h("span", null, field.label || field.key))
      wrap.appendChild(switchWrap)
      read = function () { return checkbox.checked }
      isDisabled = function () { return false }
    } else if (isRich) {
      var rich = renderRichSelect(field, initial, onChange)
      wrap.appendChild(rich.root)
      read = rich.read
      isDisabled = rich.isDisabled
    } else if (field.type === "select") {
      var select = h("select")
      var initialChoice = asText(initial)
      if (field.optionsFrom) {
        // Skeleton while loading, the fetched list on success, or a disabled
        // "None found" when the host/route has nothing.
        var placeholder = h("option", null, "Loading…")
        placeholder.disabled = true
        select.appendChild(placeholder)
        select.disabled = true
        fetchOptions(field.optionsFrom).then(function (options) {
          select.innerHTML = ""
          if (!options || options.length === 0) {
            var none = h("option", null, "None found")
            none.disabled = true
            select.appendChild(none)
            select.disabled = true
            return
          }
          select.disabled = false
          options.forEach(function (option) {
            var node = h("option", null, option.label)
            node.value = String(option.value)
            select.appendChild(node)
          })
          var known = false
          for (var i = 0; i < options.length; i++) {
            if (String(options[i].value) === initialChoice) { known = true; break }
          }
          select.value = known ? initialChoice : String(options[0].value)
        })
      } else {
        ;(field.options || []).forEach(function (option) {
          var node = h("option", null, option.label || option.value)
          node.value = option.value
          select.appendChild(node)
        })
        select.value = initialChoice
      }
      wrap.appendChild(select)
      read = function () { return select.value }
      isDisabled = function () { return select.disabled }
    } else if (field.type === "text") {
      var textarea = h("textarea")
      textarea.value = asText(initial)
      textarea.placeholder = field.placeholder || ""
      wrap.appendChild(textarea)
      read = function () { return textarea.value }
    } else {
      var input = h("input")
      input.type = field.type === "number" ? "number" : field.type === "secret" ? "password" : "text"
      input.value = asText(initial)
      input.placeholder = field.placeholder || ""
      wrap.appendChild(input)
      read = function () { return input.value }
    }

    // The label's `for` points at "kit-<key>" — give native controls that id
    // (the rich select sets its own on the trigger).
    var control = isRich ? null : wrap.querySelector("input, select, textarea")
    if (field.type !== "boolean" && control) control.id = "kit-" + field.key
    // A standalone `field` section saves on change; the settings form saves on
    // submit (no onChange), so this is a no-op there.
    if (onChange && control) control.addEventListener("change", function () { onChange(read()) })
    if (field.description) wrap.appendChild(h("p", "kit-help", field.description))
    return { root: wrap, field: field, read: read, isDisabled: isDisabled }
  }

  /**
   * Field — a single configSchema field rendered on its own, so a form can be
   * composed inside a `group` container (container + fields) instead of one
   * monolithic `settings` form. Saves immediately on change.
   *
   * Settings: { key, title?, description?, field?: {…}, type?, label?,
   *             optionsFrom?, options? } — the configSchema definition for
   *             `key` is used as the base and any inline props override it.
   */
  function renderFieldSection(settings) {
    var key = str(settings.key)
    var view = card(str(settings.title, null) || undefined, str(settings.description, null) || undefined)
    if (!key) {
      var note = h("div", "kit-note")
      note.appendChild(icon("alert"))
      note.appendChild(h("span", null, "Set `key` to the configSchema field this section edits."))
      view.body.appendChild(note)
      return view.root
    }
    var status = h("p", "kit-muted", "Loading…")
    view.body.appendChild(status)

    api("/config")
      .then(function (body) {
        var schema = (body.plugin && body.plugin.configSchema) || []
        var values = body.config || {}
        var schemaField = null
        for (var i = 0; i < schema.length; i++) {
          if (schema[i].key === key) { schemaField = schema[i]; break }
        }
        var field = Object.assign(
          {},
          schemaField || { key: key, type: settings.type || "text", label: settings.label || key },
          settings.field || {},
        )
        if (settings.type) field.type = settings.type
        if (settings.label) field.label = settings.label
        if (settings.optionsFrom) field.optionsFrom = settings.optionsFrom
        if (settings.options) field.options = settings.options
        field.key = key

        var saved = h("span", "kit-field-status", "")
        var rendered = renderField(field, values[key], save)
        view.body.removeChild(status)
        view.body.appendChild(rendered.root)
        view.body.appendChild(saved)

        function save() {
          if (rendered.isDisabled()) return
          saved.textContent = "Saving…"
          saved.classList.remove("kit-error-text")
          var payload = {}
          payload[key] = field.type === "number" ? Number(rendered.read()) : rendered.read()
          api("/config", { method: "PUT", body: JSON.stringify({ storeId: Number(storeId) || undefined, config: payload }) })
            .then(function () { saved.textContent = "Saved ✓" })
            .catch(function (error) {
              saved.textContent = error.message
              saved.classList.add("kit-error-text")
            })
        }
      })
      .catch(function (error) {
        view.body.removeChild(status)
        view.body.appendChild(h("p", "kit-error", error.message))
      })
    return view.root
  }

  /**
   * Fields — several configSchema fields in one card with a single "Save
   * settings" button. Unlike `field` (which saves on every change), nothing is
   * written until the button is pressed — the grouped, explicit counterpart to
   * `settings`. Nest it in a `group` for a collapsible panel.
   *
   * Settings: { keys: [...], title?, description?, saveLabel? } — `keys` are
   * configSchema field keys, rendered in the order given.
   */
  function renderFieldsSection(settings) {
    var keys = Array.isArray(settings.keys) ? settings.keys.map(String) : []
    var view = card(str(settings.title, null) || undefined, str(settings.description, null) || undefined)
    if (keys.length === 0) {
      var note = h("div", "kit-note")
      note.appendChild(icon("alert"))
      note.appendChild(h("span", null, "Set `keys` to the configSchema fields this section edits."))
      view.body.appendChild(note)
      return view.root
    }
    var status = h("p", "kit-muted", "Loading…")
    view.body.appendChild(status)

    api("/config")
      .then(function (body) {
        var schema = (body.plugin && body.plugin.configSchema) || []
        var values = body.config || {}
        var inputs = []
        keys.forEach(function (key) {
          var schemaField = null
          for (var i = 0; i < schema.length; i++) {
            if (schema[i].key === key) { schemaField = schema[i]; break }
          }
          var field = schemaField || { key: key, type: "text", label: key }
          var rendered = renderField(field, values[key])
          inputs.push(rendered)
          view.body.appendChild(rendered.root)
        })

        var label = str(settings.saveLabel, "Save settings")
        var save = h("button", "kit-button")
        save.type = "button"
        save.textContent = label
        var saved = h("span", "kit-field-status", "")
        var actions = h("div", "kit-form-actions")
        actions.appendChild(save)
        actions.appendChild(saved)
        view.body.removeChild(status)
        view.body.appendChild(actions)

        save.addEventListener("click", function () {
          var payload = {}
          inputs.forEach(function (entry) {
            // Disabled (a dynamic control still loading or showing "None found")
            // carries no choice — never let it overwrite the stored value.
            if (entry.isDisabled()) return
            var key = entry.field.key
            if (entry.field.type === "number") payload[key] = Number(entry.read())
            else payload[key] = entry.read()
          })
          save.disabled = true
          save.textContent = "Saving…"
          saved.textContent = ""
          saved.classList.remove("kit-error-text")
          api("/config", { method: "PUT", body: JSON.stringify({ storeId: Number(storeId) || undefined, config: payload }) })
            .then(function () {
              save.disabled = false
              save.textContent = label
              saved.textContent = "Saved ✓"
            })
            .catch(function (error) {
              save.disabled = false
              save.textContent = label
              saved.textContent = error.message
              saved.classList.add("kit-error-text")
            })
        })
      })
      .catch(function (error) {
        view.body.removeChild(status)
        view.body.appendChild(h("p", "kit-error", error.message))
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
          var rendered = renderField(field, values[field.key])
          inputs[field.key] = rendered
          form.appendChild(rendered.root)
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
            // Disabled (a dynamic control still loading or showing "None found")
            // carries no choice — never let it overwrite the stored value.
            if (entry.isDisabled()) return
            if (entry.field.type === "boolean") payload[key] = entry.read()
            else if (entry.field.type === "number") payload[key] = Number(entry.read())
            else payload[key] = entry.read()
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

  /**
   * Job history — every background job of this plugin for this store: what
   * ran, how it ended, how long it took and (on click) its transcript and
   * per-item results. The list refreshes itself while a job is running.
   */
  function renderLogs(settings) {
    var lines = Math.max(1, Number(settings.lines) || 20)
    var limit = Math.max(1, Math.min(Number(settings.limit) || 10, 50))

    var refresh = h("button", "kit-button kit-outline")
    refresh.appendChild(icon("refresh"))
    refresh.appendChild(h("span", null, "Refresh"))
    var view = card(
      str(settings.title, "Job logs"),
      str(settings.description, "Background jobs for this store — status, timings and the transcript of each run."),
      refresh,
    )
    var list = h("div", "kit-joblog")
    view.body.appendChild(list)

    var names = {}
    JOBS.forEach(function (job) { names[job.type] = job.name || job.type })

    var lastSignature = ""
    function load() {
      return api("/jobs?limit=" + limit).then(function (body) {
        var jobs = Array.isArray(body.jobs) ? body.jobs : []
        var signature = jobs.map(function (job) {
          return [job.id, job.status, job.processed, job.total, job.failed, job.skipped, job.error].join(":")
        }).join("|")
        if (signature === lastSignature) return
        lastSignature = signature
        // Keep the rows the user opened open across a refresh.
        var wasOpen = {}
        list.querySelectorAll("details[open]").forEach(function (node) { wasOpen[node.dataset.job] = "1" })
        list.innerHTML = ""
        if (jobs.length === 0) {
          list.appendChild(h("p", "kit-muted", "No background jobs yet."))
          return
        }
        jobs.forEach(function (job) {
          var node = jobRunRow(job, names, lines)
          list.appendChild(node)
          if (wasOpen[String(job.id)]) {
            node.open = true
            node.dispatchEvent(new Event("toggle"))
          }
        })
      }).catch(function (error) {
        list.innerHTML = ""
        list.appendChild(h("p", "kit-error", error.message))
      })
    }

    refresh.addEventListener("click", function () { load() })
    load()
    // While a job is running the list follows along; when everything is
    // finished it settles down to a slow refresh.
    var timer = setInterval(function () {
      var active = list.querySelector(".kit-badge.kit-running, .kit-badge.kit-pending, .kit-badge.kit-paused")
      if (active || document.hidden) load()
    }, 5000)
    view.root.addEventListener("kit-teardown", function () { clearInterval(timer) })
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

  function renderSection(section) {
    var settings = section.settings || {}
    switch (section.type) {
      case "text": return renderText(settings)
      case "stats": return renderStats(settings)
      case "table": return renderTable(settings)
      case "job": return renderJob(settings)
      case "settings": return renderSettings()
      case "field": return renderFieldSection(settings)
      case "fields": return renderFieldsSection(settings)
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
