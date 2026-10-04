# Node jobs runtime contract

For platform implementers. Plugins declare jobs with `"runtime": "node"`; the
SDK builds the artifact and `selldoes publish` ships it, but the host owns the
execution environment. This page is the contract, plus how the reference AWS
host implements it.

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
from the installed dependency tree. The handler is `module.exports` (a
function) or its `.default` export:

```js
module.exports = async (input, ctx) => {
  // full Node: fs, net, native addons, playwright, sharp, mysql2, …
  return { imported: 42 }
}
```

The host may accept the SDK-built files or rebuild from the plugin source (the
reference host rebuilds, so the artifact always matches the installed tree).
Either way the external packages must be installed **on Linux x64** with the
plugin's lockfile and production dependencies only.

Lifecycle scripts stay disabled (`--ignore-scripts`) for supply-chain safety, so
packages that download binaries in a postinstall step (plain `playwright`, some
database drivers) do not work out of the box. Native addons with prebuilt
optional dependencies (`sharp`, `mysql2`) do. For headless browsers, declare
`playwright-core` plus a browser artifact that is a normal dependency
(`@sparticuz/chromium` on the Lambda tier); the container/VM tier can instead
bake `npx playwright install --with-deps` into the image.

## Dependency packaging

Reference AWS tier (Lambda runner):

1. At install/publish, run `npm install --omit=dev --ignore-scripts` from the
   plugin's `package.json`/lockfile on Linux x64.
2. Rebuild each Node entry with esbuild (`platform: node`, `format: cjs`,
   `target: node20`, `packages: "external"`).
3. Pack the installed `node_modules` into `deps.tgz` (symlinks/`.bin` skipped)
   and upload `artifact.json`, `<type>.cjs`, `package.json`, the lockfile and
   `deps.tgz` under the plugin's `node/` prefix in the plugins bucket.

The reference app installs synchronously at upload/publish time, so very large
dependency trees (hundreds of MB) may exceed the request budget — use a
dedicated build worker or the container/VM tier for those.

Container/VM tier (Fargate, Firecracker, Lambda MicroVMs, gVisor, …): build one
image per plugin **version** instead — base Linux + Node `>= 20`, `npm ci
--omit=dev` from the shipped lockfile, copy `dist/node/*` next to
`node_modules`. Tag by lockfile hash; one image is shared by every store that
installs that release. Installing a plugin in 100 stores must not create 100
runtimes — only active runs consume resources.

If `artifact.json.dependencies` and the installed tree disagree, prefer the
lockfile. The build rejects Node entries that import undeclared packages.

## Execution

Reference AWS tier: the app enqueues one SQS message per job; an event source
mapping invokes a Node runner Lambda (real Node, Firecracker isolation, no DB
credentials):

1. Download `artifact.json` + the entry files + `deps.tgz` from S3 into a
   content-addressed `/tmp` cache (keyed by S3 ETags) and extract the tree.
2. Fork a child Node process with `--max-old-space-size` from the job's
   `memoryMb`; the parent holds the capability secret and bridges every `ctx.*`
   call over signed HTTPS.
3. Call `handler(input, ctx)` once, JSON-serialize the result onto the job row,
   and heartbeat `lastTickAt` while the run is in flight.
4. Enforce `timeoutMs`; on breach, cancellation (`jobs.cancelled` is polled) or
   crash, kill the child and report the outcome via `jobs.finish`.
5. The sandbox is destroyed after the run. The filesystem is disposable —
   persistence goes through `ctx.storage`.

Plugin-level failures are acknowledged (no retry). Only infrastructure
failures are redelivered, bounded by the queue's `maxReceiveCount` and DLQ.
Queue runs per store and cap concurrency so one store cannot starve another.

## `ctx` brokering

Node jobs receive the same capability surface as QuickJS jobs:
`ctx.db`, `ctx.http`, `ctx.ai`, `ctx.files`, `ctx.products`, `ctx.realtime`,
`ctx.email`, `ctx.secrets`, `ctx.storage` and the `ctx.jobs` reporter.

- Enforce manifest `permissions` host-side on every call, exactly as the
  QuickJS broker does.
- Secrets are the installation's `configSchema` fields of type `secret`
  (encrypted at rest, decrypted per run). `ctx.secrets.get(name)` returns them
  over the bridge; never bake them into the artifact, the queue message, the
  image or the environment.
- `ctx.storage` is a host table scoped to `(store_id, plugin_slug, key)` with a
  64 KB value cap and a key limit; `ctx.storage.list(prefix)` returns keys and
  `updatedAt`.
- Sign capability calls with a **per-job secret** derived from the shared
  runtime secret (`HMAC(shared, plugin:store:job)`) so leaked plugin code
  cannot impersonate another job, store or plugin.
- Store scoping (`store_id`) is host-enforced, as with the sandbox.
- Stream `ctx.jobs.progress/item/log` to the job row so the dashboard renders
  the same transcript it does for QuickJS jobs.

## Schedules (host side)

Manifest `schedules` (`{ job, cron, timezone?, input?, enabled? }`, max 10,
five-field cron) are validated by the SDK; the host owns firing:

- Mirror manifest schedules into host state (`plugin_schedules`), keyed by
  `(store, plugin, schedule_index)`.
- Compute the next fire time in the declared IANA timezone; fire by creating
  the declared job with `input`.
- Respect `enabled: false`, per-store activation and uninstall; disable rows
  whose plugin/job disappeared.
- Missed windows while the scheduler was down are skipped; the next run is
  computed from "now".
- Surface last run / next run in the plugin's dashboard page.

The dev preview only computes `nextRunAt` and offers a manual run.

## Limits

| Limit | SDK manifest | Reference AWS tier |
|---|---|---|
| `timeoutMs` | 1 000 – 1 800 000 (default 300 000) | capped at 840 000 (Lambda 15 min) |
| `memoryMb` | 128 – 4096 (default 512) | capped at 896 (function 1024, heap flag) |
| Schedules per plugin | 10 | 10 |
| Declared dependencies | 25 | 25 (256 MB packed tree) |
| QuickJS bundle | 4 MB | 4 MB |
| Job input in the queue message | — | 250 KB (use `ctx.storage` for more) |

Hosts may enforce lower caps; log the clamp so authors can see it.

## Related

- [Developing plugins](developing-plugins.md) — author-facing docs.
- `cli/plugin/build.mjs` — artifact builder.
- `cli/plugin/sandbox.mjs` — QuickJS profile, Node build profile, probes.
- `cli/plugin/schedule.mjs` — cron validation and next-run.
- Reference host: `next/src/lib/plugins/sandbox/{node-jobs,node-bundle,scheduler,schedule}.ts`
  and `infra/lambda/plugin-node-runtime/` in the platform repo.
