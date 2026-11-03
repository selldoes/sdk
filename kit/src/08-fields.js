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

    if (field.type === "boolean") {
      var switchWrap = h("label", "kit-switch")
      var checkbox = h("input")
      checkbox.type = "checkbox"
      checkbox.checked = Boolean(initialValue !== undefined ? initialValue : field.default)
      switchWrap.appendChild(checkbox)
      switchWrap.appendChild(h("span", null, field.label || field.key))
      wrap.appendChild(switchWrap)
      read = function () { return checkbox.checked }
      isDisabled = function () { return false }
    } else if (isRich) {
      var rich = renderRichSelect(field, initialValue, onChange)
      wrap.appendChild(rich.root)
      read = rich.read
      isDisabled = rich.isDisabled
    } else if (field.type === "select") {
      var select = h("select")
      var initial = String(initialValue !== undefined ? initialValue : field.default || "")
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
            if (String(options[i].value) === initial) { known = true; break }
          }
          select.value = known ? initial : String(options[0].value)
        })
      } else {
        ;(field.options || []).forEach(function (option) {
          var node = h("option", null, option.label || option.value)
          node.value = option.value
          select.appendChild(node)
        })
        select.value = initial
      }
      wrap.appendChild(select)
      read = function () { return select.value }
      isDisabled = function () { return select.disabled }
    } else if (field.type === "text") {
      var textarea = h("textarea")
      textarea.value = String(initialValue !== undefined ? initialValue : field.default || "")
      textarea.placeholder = field.placeholder || ""
      wrap.appendChild(textarea)
      read = function () { return textarea.value }
    } else {
      var input = h("input")
      input.type = field.type === "number" ? "number" : field.type === "secret" ? "password" : "text"
      input.value = String(initialValue !== undefined ? initialValue : field.default || "")
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

