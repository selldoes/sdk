# __PLUGIN_NAME__

A worked example of the **digital delivery** contract: a section on the
storefront's order-detail page that tells the buyer how to get what they
bought.

## The contract

```json
{ "delivery": true }
```

```js
async function deliveryProvider(storeId, order, ctx) {
  // return { id, title, items: [{ label, value }] } or null to render nothing
}
```

- Runs in the sandbox with a store-scoped `ctx`, on every order-detail view.
- Return `null` when the order has nothing digital — the section disappears.
- Return `items` as label/value pairs: download links, license keys, account
  instructions, activation steps.

This example reads each order line and shows its `downloadUrl`, `licenseKey`
or `deliveryInstructions` when present; edit `lineFor()` to match how your
checkout stores fulfillment data.

## Try it

```bash
npm install
npx selldoes dev      # Storefront → open an order to see the section
```

The `/preview` API route shows a sample payload in the API console.
