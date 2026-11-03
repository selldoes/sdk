/*
 * Selldoes kit runtime.
 *
 * Renders a compiled `dashboardPages[].sections` page inside the sandboxed
 * dashboard iframe. The SDK copies this file into every plugin that uses kit
 * components, so the preview and the store run the exact same renderer — one
 * implementation, no per-host copies.
 *
 * Host calls (all same-origin, session-authenticated):
 *   table   → GET  /api/plugin-api/{slug}{route}?storeId&storeSlug
 *   job     → POST /api/plugins/{slug}/jobs, POST .../jobs/{id}/tick,
 *             GET  .../jobs/{id} (node jobs are polled, quickjs jobs tick)
 *   settings→ GET/PUT /api/plugins/{slug}/config?storeId
 *   logs    → GET  /api/plugins/{slug}/jobs?storeId + .../jobs/{id}
 *
 * Generated from kit/src/*.js by `npm run build:kit` (scripts/build-kit.mjs).
 * Edit the fragments in kit/src/, not this file.
 */
(function () {
  "use strict"

