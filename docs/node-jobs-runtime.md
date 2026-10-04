# Node jobs runtime contract

For platform implementers. Plugins declare jobs with `"runtime": "node"`; the
SDK builds the artifact and `selldoes publish` ships it, but the host owns the
execution environment. This page is the contract the host must implement.

The QuickJS path is unchanged: `dist/bundle.js` still runs in the sandbox.
Node jobs never execute there.

## Artifact layout

Inside the published zip:

```
dist/bundle.js            QuickJS bundle (hooks, routes, quickjs jobs)
dist/node/artifact.json   machine-readable job list
dist/node/<type>.cjs      one bundled entry per Node job
dist/node/package.json    the plugin's package.json
dist/node/<lockfile>      package-lock.json / pnpm-lock.yaml / yarn.lock / bun.lock
```

`artifact.json` (`schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "runtime": "node",
  "node": ">=20",
  "jobs": [
    { "type": "scrape", "file": "scrape.cjs", "timeoutMs": 600000, "memoryMb": 1024 }
  ],
  "dependencies": { "playwright": "^1.61.1" }
}
```

`<type>.cjs` is a CommonJS bundle of the job's `entry` file. npm dependencies
are **external** (`packages: "external"`) — they are not inlined and must come
from the image. The handler is `module.exports` (a function) or its `.default`
export.

## Image build (at publish time)

1. Base image: Linux with Node `>= 20` (24 recommended). If plugins use native
   addons, include a build toolchain or prebuilt binaries.
2. Run the plugin's package manager against the shipped lockfile, production
   dependencies only (`npm ci --omit=dev`, `pnpm install --prod --frozen-lockfile`,
   `yarn install --production --frozen-lockfile`, `bun install --production`).
3. Copy `dist/node/*` next to `node_modules`.
4. Tag the image per plugin **version** and cache it by lockfile hash. One
   image is shared by every store that installs that release; it is immutable.

If `artifact.json.dependencies` and the installed tree disagree, prefer the
lockfile — the build already warns when a Node entry imports an undeclared
package.

## Execution

1. Start a sandbox from the image (gVisor container, Firecracker microVM, AWS
   Lambda MicroVM, …). One execution per job run, one store's data per run.
2. `require("<file>")`, resolve the handler, call `handler(input, ctx)` once.
3. Await the result and JSON-serialize it onto the job row.
4. Enforce `timeoutMs` and `memoryMb`; kill the sandbox on breach or
   cancellation.
5. Destroy the sandbox when the run ends. The filesystem is disposable —
   persistence goes through `ctx.storage`.

Queue runs per store and cap concurrency; jobs from one store must not starve
another. The shared image means installing a plugin in 100 stores does **not**
create 100 runtimes — only active runs consume resources.

## `ctx` brokering

Node jobs receive the same capability surface as QuickJS jobs:
`ctx.db`, `ctx.http`, `ctx.ai`, `ctx.files`, `ctx.products`, `ctx.realtime`,
`ctx.email`, `ctx.secrets`, `ctx.storage` and the `ctx.jobs` reporter.

- Enforce manifest `permissions` host-side on every call, exactly as the
  QuickJS broker does.
- Resolve secrets server-side and inject them per run; never bake them into
  the image, the environment, or the artifact.
- Store scoping (`store_id`) is host-enforced, as with the sandbox.
- Stream `ctx.jobs.progress/item/log` to the job row so the dashboard renders
  the same transcript it does for QuickJS jobs.

## Schedules (host side)

Manifest `schedules` (`{ job, cron, timezone?, input?, enabled? }`, max 10,
five-field cron) are validated by the SDK; the host owns firing:

- Compute the next fire time in the declared IANA timezone.
- Enqueue the declared job with `input`; apply retry, overlap and misfire
  policies.
- Respect `enabled: false` and per-store enable/disable from the dashboard.
- Surface last run / next run in the plugin's dashboard page.

The dev preview only computes `nextRunAt` and offers a manual run.

## Limits

| Limit | Value |
|---|---|
| `timeoutMs` | 1000 – 1 800 000 (default 300 000) |
| `memoryMb` | 128 – 4096 (default 512) |
| Schedules per plugin | 10 |
| Declared dependencies | 25 |
| QuickJS bundle | 4 MB |

## Related

- [Developing plugins](developing-plugins.md) — author-facing docs.
- `cli/plugin/build.mjs` — artifact builder.
- `cli/plugin/sandbox.mjs` — QuickJS profile, Node build profile, probes.
- `cli/plugin/schedule.mjs` — cron validation and next-run.
