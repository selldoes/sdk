# __THEME_NAME__

A [Selldoes](https://selldoes.com) storefront theme.

## Develop locally

```bash
npm install
npx selldoes login --api-key sk_…      # Dashboard → Settings → API Keys
npx selldoes dev --store <slug>        # live preview against your store
```

Each file in `src/` is a page: `home.tsx`, `product.tsx`, `category.tsx`,
`cart.tsx`, `checkout.tsx`, … See the full page-type list in the docs.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Live preview against a store (hot reload) |
| `npm run build` | Bundle `src/*.tsx` → `dist/` + `manifest.json` |
| `npm run publish` | Build and upload the theme |

## Publish

```bash
npx selldoes build
npx selldoes publish            # --public to list it in the marketplace
npx selldoes apply --store <slug>   # apply the uploaded theme to a store
```

## API

Everything comes from `selldoes/theme` — hooks (`useStore`, `useProducts`,
`useProductDetail`, `useCart`, `useCustomer`, `useSections`, …) and components
(`ProductGrid`, `ProductCard`, `Price`, `AddToCartButton`, `CartDrawer`, …).
See the docs for the full list.
