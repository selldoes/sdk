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

