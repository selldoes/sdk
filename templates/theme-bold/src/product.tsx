import { useInitialProduct, useRelatedProducts, Price, AddToCartButton, ProductGallery, ProductCard } from "selldoes/theme"

/** Bold product page — full-bleed gallery, sticky buy column, related grid. */
export default function ProductPage() {
  const product = useInitialProduct()
  const related = useRelatedProducts(product?.sku)
  const relatedProducts = related?.data?.products || []

  if (!product) {
    return <div style={{ fontFamily: "system-ui, sans-serif", padding: 48, color: "#a3a3a3" }}>Product not found.</div>
  }

  const images = product.images?.length ? product.images : [product.image || product.mainImage].filter(Boolean)

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#0a0a0a", color: "#fafafa", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px", display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 40, alignItems: "start" }}>
        <ProductGallery images={images} alt={product.name} />
        <div style={{ position: "sticky", top: 24 }}>
          <p style={{ margin: 0, color: "#facc15", fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>
            In stock
          </p>
          <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 900, letterSpacing: "-0.03em", margin: "12px 0 14px" }}>
            {product.name}
          </h1>
          <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 24 }}>
            <Price amount={product.price} currency={product.currency || "$"} />
          </div>
          <AddToCartButton product={product}>Add to cart →</AddToCartButton>
          {product.description ? (
            <p style={{ marginTop: 28, color: "#d4d4d4", lineHeight: 1.7, fontSize: 15 }}>{String(product.description)}</p>
          ) : null}
        </div>
      </div>

      {relatedProducts.length > 0 ? (
        <section style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 24px 96px" }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 18 }}>Complete the fit</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 20 }}>
            {relatedProducts.slice(0, 4).map((item) => (
              <ProductCard key={item.sku || item.id} product={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
