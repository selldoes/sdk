
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
