import {
  useInitialProduct,
  Price,
  AddToCartButton,
  Breadcrumbs,
  Container,
  ProductGallery,
} from "selldoes/theme"

export default function ProductPage() {
  const product = useInitialProduct()

  if (!product) {
    return (
      <Container>
        <p style={{ color: "#64748b" }}>Product not found.</p>
      </Container>
    )
  }

  const images = product.images?.length ? product.images : [product.image || product.mainImage].filter(Boolean)

  return (
    <Container>
      <div style={{ paddingTop: 8, paddingBottom: 20 }}>
        <Breadcrumbs items={["Home", product.name || "Product"]} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 32 }}>
        <ProductGallery images={images} alt={product.name} />
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 10px" }}>{product.name}</h1>
          <Price amount={product.price} currency={product.currency || "$"} />
          <div style={{ marginTop: 20 }}>
            <AddToCartButton product={product} />
          </div>
          {product.description ? (
            <p style={{ marginTop: 24, color: "#475569", lineHeight: 1.6 }}>{product.description}</p>
          ) : null}
        </div>
      </div>
    </Container>
  )
}
