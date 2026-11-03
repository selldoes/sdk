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

