import { useInitialProduct, useRelatedProducts, Price, AddToCartButton, ProductGallery, ProductCard } from "selldoes/theme"

/**
 * Editorial product page — gallery left, a long-form column right, related
 * reading underneath.
 */
export default function ProductPage() {
  const product = useInitialProduct()
  const related = useRelatedProducts(product?.sku)
  const relatedProducts = related?.data?.products || []

  if (!product) {
    return (
      <div style={{ fontFamily: "Georgia, serif", padding: 48, textAlign: "center", color: "#6b6156" }}>
        Product not found.
      </div>
    )
  }

  const images = product.images?.length ? product.images : [product.image || product.mainImage].filter(Boolean)

  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", background: "#faf7f2", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "48px 24px 0", display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 48 }}>
        <ProductGallery images={images} alt={product.name} />
        <div style={{ paddingTop: 12 }}>
          <p style={{ margin: 0, color: "#8a7f70", fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase" }}>Edition</p>
          <h1 style={{ fontSize: 40, fontWeight: 400, lineHeight: 1.15, margin: "12px 0 16px" }}>{product.name}</h1>
          <div style={{ fontSize: 22, marginBottom: 22 }}>
            <Price amount={product.price} currency={product.currency || "$"} />
          </div>
          <AddToCartButton product={product}>Add to bag</AddToCartButton>
          {product.description ? (
            <p style={{ marginTop: 30, color: "#4d4438", lineHeight: 1.85, fontSize: 15, whiteSpace: "pre-line" }}>
              {String(product.description)}
            </p>
          ) : null}
        </div>
      </div>

      {relatedProducts.length > 0 ? (
        <section style={{ maxWidth: 1040, margin: "0 auto", padding: "64px 24px" }}>
          <h2 style={{ fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", color: "#8a7f70", borderTop: "1px solid #e7e0d6", paddingTop: 20 }}>
            You may also like
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 28, marginTop: 20 }}>
            {relatedProducts.slice(0, 4).map((item) => (
              <ProductCard key={item.sku || item.id} product={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
