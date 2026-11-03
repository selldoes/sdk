# AGENTS.md

## Plugin projects

All plugin projects live in:

```
C:\Users\Selldoes\Documents\Selldoes
```

Current projects:

- `C:\Users\Selldoes\Documents\Selldoes\otrcat-scraper` — OTRCat.com product importer (stages drafts for review)
- `C:\Users\Selldoes\Documents\Selldoes\global-searches` — global searches plugin
- `C:\Users\Selldoes\Documents\Selldoes\test` — scratch/test plugin

When the user says "let's talk about the otrcat scraper" (or any plugin by
name), look it up in that folder — the plugin's `plugin.json`, `index.js`,
`selldoes.config.json` and `ui/` live at its root. Do not look for plugins
inside this SDK repo.

## This repo

This repo (`C:\Users\Selldoes\Desktop\SDK`) is the Selldoes SDK itself: CLI,
kit runtime (`kit/`), dev server (`cli/plugin/dev/`) and dev-ui. Changes to
`kit/runtime.js` reach a plugin only after the plugin is rebuilt — the kit
compiler copies the runtime into the plugin's `ui/kit/` on build.

The dev server's HTTP handlers live in `cli/plugin/dev/routes/*.mjs` (one module
per route group, each a `createXRoutes(deps)` factory returning a
`handle(req, res, url)`); `cli/plugin/dev/server.mjs` wires them together and
holds the shared setup. Generic HTTP helpers (and the loopback/DNS-rebinding
guards) are in `cli/http.mjs`.

The kit runtime is **generated**: `kit/runtime.js` is concatenated from the
ordered fragments in `kit/src/*.js` by `npm run build:kit`
(`scripts/build-kit.mjs`). Edit the fragments, never the generated file;
`npm run build` and `npm test` both enforce that it is up to date.

## Documentation Rule

**Every new developer-facing capability MUST be documented in the same
change** — no exceptions:

- `ctx.*` sandbox capabilities (new methods, parameters, permissions) →
  `docs/developing-plugins.md` (permission table + usage examples).
- Kit runtime features (e.g. configSchema `optionsFrom`, section types) →
  `docs/developing-plugins.md` where the feature is authored/used.
- CLI commands, dev-server behavior and the live-store bridge → the relevant
  `docs/*.md` page.
- The platform-side mirror of a capability (the real sandbox broker in the
  selldesk repo) and its docs are updated in the same feature pass — the SDK
  docs must never describe something only the mock can do.
- Update this AGENTS.md when a convention changes.
