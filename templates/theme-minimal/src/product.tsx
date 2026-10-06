import { useInitialProduct, Price, AddToCartButton, ProductGallery, Container } from "selldoes/theme"

/** Minimal product page — a narrow, centred column: image, name, price, buy. */
export default function ProductPage() {
  const product = useInitialProduct()

  if (!product) {
    return (
      <Container>
        <p style={{ color: "#9ca3af", fontSize: 13 }}>Product not found.</p>
      </Container>
    )
  }

  const images = product.images?.length ? product.images : [product.image || product.mainImage].filter(Boolean)

  return (
    <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", background: "#ffffff", color: "#111111" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "56px 32px 40px" }}>
        <ProductGallery images={images} alt={product.name} />
        <h1 style={{ fontSize: 22, fontWeight: 400, letterSpacing: "0.01em", margin: "28px 0 6px" }}>{product.name}</h1>
        <div style={{ fontSize: 15, color: "#6b7280", marginBottom: 26 }}>
          <Price amount={product.price} currency={product.currency || "$"} />
        </div>
        <AddToCartButton product={product}>Add to cart</AddToCartButton>
        {product.description ? (
          <p style={{ marginTop: 36, color: "#4b5563", fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-line" }}>
            {String(product.description)}
          </p>
        ) : null}
      </div>
    </div>
  )
}
