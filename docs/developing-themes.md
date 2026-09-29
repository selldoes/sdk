# Developing Selldoes themes

Themes are React projects that replace the storefront pages. One package —
[`selldoes`](https://www.npmjs.com/package/selldoes) — provides the CLI and the
runtime (`selldoes/theme`: hooks + components, backed by a postMessage bridge
implemented by the platform host).

## Quick start

```bash
npx selldoes create my-theme        # choose Theme
cd my-theme
npm install
npx selldoes login --api-key sk_…   # Dashboard → Settings → API Keys
npx selldoes dev --store <slug>     # live preview against your store
```

## Anatomy

```
my-theme/
  manifest.json        name, version, pages, shell options
  src/home.tsx         one file per page type
  src/product.tsx
  dist/                build output (uploaded by publish)
```

Every file in `src/` named after a page type becomes a page: `home`,
`product`, `category`, `search`, `cart`, `checkout`, `thankyou`, `login`,
`profile`, `pages`, `wishlist`, `error`. Custom page types declared in
`manifest.json` (under `pages`) become real storefront routes
(`/store/<slug>/<pageType>`) and customizer tabs.

## The dev server

`npx selldoes dev --store <slug>` bundles every page with esbuild and serves a
preview at `http://localhost:4173` with hot reload. The preview iframe uses the
same host bridge as production, and `/proxy` forwards `/api/store/*` calls to
your configured SellDesk instance (`--base`, default
`http://selldoes.localhost:9582`).

## Runtime API

Hooks (all from `selldoes/theme`): `useStore`, `usePageType`, `useTheme`,
`useSections(pageType)`, `useInitialProduct`, `useProducts(opts)`,
`useProductDetail(sku)`, `useCategories`, `useRelatedProducts(sku)`,
`useReviews(sku)`, `useCustomer`, `useCart`, `useWishlist`, `useStoreLink`,
`useStoreSectionsData`, `useOrder(orderId)`.

Components: `ProductGrid`, `ProductCard`, `ProductGallery`, `Price`,
`AddToCartButton`, `CartDrawer`, `CategoryList`, `Breadcrumbs`, `Container`,
`Section`.

Data hooks return `{ data, loading, error }`; product lists are available as
`data.products` (`{ products, total, page, pageSize }`).

## Build & publish

```bash
npx selldoes build                   # src/*.tsx → dist/ (+ manifest.json)
npx selldoes validate                # manifest + page files
npx selldoes publish                 # upload (--public to list it)
npx selldoes apply --store <slug>    # apply the uploaded theme to a store
```

Publishing uploads the zip to `/api/templates/upload`; `apply` snapshots it
into a store (sections, theme settings and template pages).
`npx selldoes init <template-id>` downloads an existing theme as a local
project.

## Auth

`npx selldoes login --api-key sk_…` stores credentials in `~/.selldoes.json`.
Override per command with `--base <url>` / `--api-key <key>` or the
`SELLDOES_BASE` / `SELLDOES_API_KEY` environment variables. `whoami` shows the
connected account and stores; `logout` clears the saved credentials.
