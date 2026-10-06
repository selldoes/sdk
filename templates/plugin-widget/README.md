# __PLUGIN_NAME__

A worked example of the **storefront widget + public routes**: a chat bubble
that appears on every storefront page and drops visitor messages into your
dashboard — no login required for the visitor.

## How it works

```
storefront widget (iframe)          dashboard
  ui/widget.html / widget.js  ──►  Messages table (kit section)
        │ POST                              ▲ GET
        ▼                                  │
  /api/plugin-public/<slug>/message   /api/plugin-api/<slug>/messages
        (publicRoutes)                    (apiRoutes)
```

- `storefrontWidget` mounts `ui/widget.html` in a sandboxed iframe; the widget
  asks for a resize with `selldesk:resize` when it opens.
- `publicRoutes` are callable by visitors — here a `POST /message` that writes
  to the plugin's own `contact_messages` table (`ctx.db`).
- The dashboard page is kit-only: a table over `GET /messages`, the settings
  form and the log. No iframe needed.

## Try it

```bash
npm install
npx selldoes dev      # Storefront tab → click the bubble; messages appear in the dashboard table
```

## Make it yours

- Add fields (subject, phone) to `ensureMessages()` and the widget form.
- Route replies through `ctx.email.send` when `email:send` is granted.
- Fan the message out with `ctx.realtime.publish` for a live dashboard feed.
