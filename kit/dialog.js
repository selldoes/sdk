/*
 * Selldoes kit dialog helper.
 *
 * The host renders plugin dashboard UIs (kit pages, embedded `component`
 * iframes, hook slots) in SANDBOXED iframes without `allow-modals` — so
 * window.confirm(), window.alert(), window.prompt() and print() are silently
 * blocked and always resolve false. Never use them in plugin UI.
 *
 * This helper provides the sanctioned replacement: a self-contained
 * confirm dialog + toast built on <dialog>.showModal(), which is NOT gated
 * by the sandbox (only the window.* modal functions are). It works in a kit
 * page, inside an embedded component iframe, and in standalone plugin pages.
 *
 * The kit compiler ships it as ui/kit/dialog.js next to runtime.js. Include
 * it from any UI file:
 *
 *   <script src="kit/dialog.js"></script>   (from ui/kit/*)
 *   <script src="kit/dialog.js"></script>   (from ui/* — the kit folder is a sibling)
 *
 * API (global `window.SelldoesDialog`):
 *
 *   SelldoesDialog.confirm({
 *     title,            // required — shown as the dialog heading
 *     body,             // plain-text explanation (escaped)
 *     confirmLabel,     // default "Confirm"
 *     cancelLabel,      // default "Cancel"
 *     danger,           // red confirm button (destructive actions)
 *     overlay,          // default true — false keeps the dialog inside the
 *                       //   frame instead of dimming the whole page
 *     select: {         // optional extra field — resolves its value back
 *       name,           //   key in the resolved object, e.g. "status"
 *       label,          //   field label, e.g. "Status"
 *       value,          //   initial value (default: first option)
 *       options: [{ value, label }],
 *     },
 *   })
 *   // → Promise<null> when cancelled, otherwise an object with the select
 *   //   values: {} when no select was given, { status: "draft" } when it was.
 *
 *   SelldoesDialog.toast(message, { variant: "default" | "error", duration })
 *
 *   SelldoesDialog.overlay(open)  // → Promise<boolean>
 *     // Asks the host to cover the WHOLE page with this frame, so a dialog
 *     // opened inside an embedded component is not clipped to the frame's
 *     // box. Resolves false when the page is not embedded (or the host is
 *     // too old to know the protocol) — the dialog then stays inline.
 */
;(function () {
  "use strict"
  if (window.SelldoesDialog) return

  var STYLE_ID = "selldoes-dialog-style"
  var STYLE = [
    // Top-aligned (12vh), not vertically centered: embedded component frames
    // auto-resize to their content height, so a centered dialog can land far
    // below the visible area of the page. Combined with the kit's
    // `selldesk:kit-scroll` handling, the dialog is always in view.
    ".sd-dialog{border:1px solid #e5e7eb;border-radius:12px;padding:18px;max-width:420px;width:100%;font:inherit;color:#111827;background:#fff;margin:12vh auto auto;max-height:calc(100vh - 48px);overflow:auto;}",
    ".sd-dialog::backdrop{background:rgba(17,24,39,.35);}",
    // Overlay mode: the host made this frame cover the whole page, so the
    // dialog fills it and centers itself over the dimmed page behind.
    ".sd-dialog.sd-overlay{position:fixed;inset:0;max-width:none;width:100%;max-height:none;height:100%;margin:0;border:0;border-radius:0;background:transparent;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 24px;box-sizing:border-box;}",
    ".sd-dialog.sd-overlay::backdrop{background:transparent;}",
    ".sd-panel{position:relative;}",
    ".sd-dialog.sd-overlay .sd-panel{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;width:100%;max-width:420px;box-shadow:0 18px 50px rgba(17,24,39,.25);}",
    "body.sd-overlay-active{background:transparent;}",
    // While a dialog covers the page, the page behind it is hidden.
    "body.sd-overlay-active > *:not(dialog){visibility:hidden;}",
    ".sd-close{position:absolute;top:10px;right:10px;border:0;background:transparent;color:#6b7280;font-size:18px;line-height:1;padding:4px 8px;border-radius:8px;cursor:pointer;}",
    ".sd-close:hover{background:#f3f4f6;color:#111827;}",
    ".sd-dialog h3{margin:0 0 6px;font-size:15px;}",
    ".sd-dialog p.sd-body{margin:0;font-size:13px;color:#6b7280;white-space:pre-wrap;}",
    ".sd-dialog label.sd-field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#374151;margin-top:12px;}",
    ".sd-dialog select{border:1px solid #d1d5db;border-radius:8px;padding:6px 8px;font:inherit;background:#fff;}",
    ".sd-dialog .sd-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}",
    ".sd-dialog button{border-radius:8px;padding:6px 14px;font:inherit;cursor:pointer;}",
    ".sd-dialog button.sd-ok{border:1px solid #2563eb;background:#2563eb;color:#fff;}",
    ".sd-dialog button.sd-ok.sd-danger{border-color:#dc2626;background:#dc2626;}",
    ".sd-dialog button.sd-cancel{border:1px solid #d1d5db;background:transparent;color:inherit;}",
    ".sd-toast{position:fixed;bottom:18px;right:18px;background:#111827;color:#fff;border-radius:10px;padding:10px 14px;font:13px/1.4 ui-sans-serif,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:2147483000;max-width:340px;}",
    ".sd-toast.sd-error{background:#b91c1c;}",
  ].join("\n")

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return
    var style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = STYLE
    document.head.appendChild(style)
  }

  var openDialog = null
  var openResolve = null

  /**
   * Asks the host (kit runtime) to turn this frame into a full-page overlay,
   * so a dialog covers the whole page instead of the frame's box. The host
   * answers with the same id — an older host never does, which resolves as
   * "not supported" and leaves the dialog inline.
   */
  function requestOverlay(open) {
    if (window.parent === window) return Promise.resolve({ supported: false, open: false })
    var id = "sd-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)
    return new Promise(function (resolve) {
      var settled = false
      var timer = null
      function finish(supported, isOpen) {
        if (settled) return
        settled = true
        window.removeEventListener("message", onMessage)
        if (timer) clearTimeout(timer)
        resolve({ supported: supported, open: isOpen })
      }
      function onMessage(event) {
        if (event.source !== window.parent) return
        var data = event.data
        if (!data || data.type !== "selldesk:kit-overlay-state" || data.id !== id) return
        finish(true, !!data.open)
      }
      window.addEventListener("message", onMessage)
      timer = setTimeout(function () { finish(false, false) }, 400)
      try {
        window.parent.postMessage({ type: "selldesk:kit-overlay", open: !!open, id: id }, "*")
      } catch (_) {
        finish(false, false)
      }
    })
  }

  /**
   * Reference counted overlay: several dialogs can be open at once (a confirm
   * on top of a preview). The frame only leaves the full-page overlay when the
   * LAST dialog closes — otherwise the dialog underneath would be clipped back
   * into the frame's small box.
   */
  var overlayUsers = 0
  var overlaySupported = null

  /** Public: overlay(open) → Promise<boolean> — true when the host applied it. */
  function overlay(open) {
    if (open) {
      overlayUsers++
      if (overlayUsers > 1) return Promise.resolve(overlaySupported === true)
      return requestOverlay(true).then(function (result) {
        overlaySupported = result.supported
        // The host does not know the protocol — do not keep a stale count.
        if (!result.supported) overlayUsers--
        return result.supported
      })
    }
    overlayUsers = Math.max(0, overlayUsers - 1)
    if (overlayUsers > 0) return Promise.resolve(true)
    return requestOverlay(false).then(function (result) {
      overlaySupported = result.supported
      return result.supported
    })
  }

  function closeOpen(reason) {
    if (!openDialog) return
    var dialog = openDialog
    var resolve = openResolve
    openDialog = null
    openResolve = null
    if (reason) dialog.close(reason)
    if (resolve) resolve(null)
  }

  function confirm(options) {
    ensureStyle()
    var opts = options || {}
    // A second confirm while one is open cancels the first — never stack.
    closeOpen("cancel")
    // `overlay: false` keeps the dialog inside the frame instead of turning
    // the whole page into a dimmed overlay — use it for the dialogs a page
    // opens on top of its own content (a row action in a list).
    var wantsOverlay = opts.overlay !== false

    return new Promise(function (resolve) {
      var dialog = document.createElement("dialog")
      dialog.className = "sd-dialog"

      var form = document.createElement("form")
      form.method = "dialog"

      var panel = document.createElement("div")
      panel.className = "sd-panel"

      // Every dialog gets a close button — clicking outside never closes it.
      var closeBtn = document.createElement("button")
      closeBtn.type = "button"
      closeBtn.className = "sd-close"
      closeBtn.setAttribute("aria-label", "Close")
      closeBtn.textContent = "×"
      closeBtn.addEventListener("click", function () {
        dialog.close("cancel")
      })
      panel.appendChild(closeBtn)

      var title = document.createElement("h3")
      title.textContent = String(opts.title || "Are you sure?")
      panel.appendChild(title)

      if (opts.body) {
        var body = document.createElement("p")
        body.className = "sd-body"
        body.textContent = String(opts.body)
        panel.appendChild(body)
      }

      var select = opts.select && Array.isArray(opts.select.options) && opts.select.options.length > 0 ? opts.select : null
      if (select) {
        var label = document.createElement("label")
        label.className = "sd-field"
        label.appendChild(document.createTextNode(String(select.label || "Choose")))
        var selectEl = document.createElement("select")
        var initial = select.value !== undefined && select.value !== null ? String(select.value) : String(select.options[0].value)
        select.options.forEach(function (option) {
          var optionEl = document.createElement("option")
          optionEl.value = String(option.value)
          optionEl.textContent = String(option.label !== undefined ? option.label : option.value)
          if (String(option.value) === initial) optionEl.selected = true
          selectEl.appendChild(optionEl)
        })
        label.appendChild(selectEl)
        panel.appendChild(label)
      }

      var actions = document.createElement("div")
      actions.className = "sd-actions"

      var cancel = document.createElement("button")
      cancel.type = "submit"
      cancel.value = "cancel"
      cancel.className = "sd-cancel"
      cancel.textContent = String(opts.cancelLabel || "Cancel")

      var ok = document.createElement("button")
      ok.type = "submit"
      ok.value = "ok"
      ok.className = "sd-ok" + (opts.danger ? " sd-danger" : "")
      ok.textContent = String(opts.confirmLabel || "Confirm")

      actions.appendChild(cancel)
      actions.appendChild(ok)
      panel.appendChild(actions)
      form.appendChild(panel)
      dialog.appendChild(form)

      var overlayActive = false
      dialog.addEventListener("close", function () {
        if (openDialog !== dialog) return
        openDialog = null
        openResolve = null
        dialog.remove()
        document.body.classList.remove("sd-overlay-active")
        // The frame goes back into the page flow.
        if (overlayActive) {
          overlayActive = false
          overlay(false)
        }
        if (dialog.returnValue === "ok") {
          var values = {}
          if (select) values[String(select.name || "value")] = selectEl.value
          resolve(values)
        } else {
          resolve(null)
        }
      })
      // Esc closes the dialog; clicking the backdrop never does.
      dialog.addEventListener("cancel", function () {
        dialog.close("cancel")
      })

      document.body.appendChild(dialog)
      openDialog = dialog
      openResolve = resolve
      // Cover the whole page when the host supports it (an embedded component
      // frame): the frame becomes a full-screen overlay and the dialog sits on
      // top of it. The dialog is only shown once the host has answered, so it
      // never jumps from one place to another.
      var show = function (asOverlay) {
        if (asOverlay) {
          overlayActive = true
          dialog.classList.add("sd-overlay")
          document.body.classList.add("sd-overlay-active")
        }
        dialog.showModal()
        // Embedded in a component iframe, the dialog sits inside a frame that
        // may be taller than the visible page — ask the host (kit runtime) to
        // scroll this frame into view. No-op when standalone.
        if (window.parent !== window) {
          try {
            window.parent.postMessage({ type: "selldesk:kit-scroll" }, "*")
          } catch (_) {}
        }
      }
      if (!wantsOverlay) {
        show(false)
        return
      }
      overlay(true).then(function (result) {
        show(result.supported)
      })
    })
  }

  var toastNode = null
  var toastTimer = null

  function toast(message, options) {
    ensureStyle()
    var opts = options || {}
    if (!toastNode) {
      toastNode = document.createElement("div")
      toastNode.className = "sd-toast"
      toastNode.setAttribute("role", "status")
      toastNode.hidden = true
      document.body.appendChild(toastNode)
    }
    toastNode.textContent = String(message == null ? "" : message)
    toastNode.classList.toggle("sd-error", opts.variant === "error")
    toastNode.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () {
      toastNode.hidden = true
    }, Number(opts.duration) > 0 ? Number(opts.duration) : 4000)
  }

  window.SelldoesDialog = { confirm: confirm, toast: toast, overlay: overlay }
})()
