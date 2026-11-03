  var DATA = window.__SELDOES_KIT__ || {}
  var SLUG = String(DATA.slug || "")
  var SECTIONS = Array.isArray(DATA.sections) ? DATA.sections : []
  var JOBS = Array.isArray(DATA.jobs) ? DATA.jobs : []

  var params = new URLSearchParams(window.location.search)
  var storeId = params.get("storeId") || String((DATA.store && DATA.store.id) || "")
  var storeSlug = params.get("storeSlug") || String((DATA.store && DATA.store.slug) || "")
  var scope = "storeId=" + encodeURIComponent(storeId) + "&storeSlug=" + encodeURIComponent(storeSlug)

  var TERMINAL = ["completed", "failed", "cancelled"]

