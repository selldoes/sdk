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

