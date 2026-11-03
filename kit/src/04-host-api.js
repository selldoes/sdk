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

