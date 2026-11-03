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
