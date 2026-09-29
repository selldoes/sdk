import { useStore, useProducts, ProductGrid } from "selldoes/theme"

export default function HomePage() {
  const store = useStore()
  const { data, loading } = useProducts({ limit: 8 })
  const products = data?.products || []

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 32, maxWidth: 1080, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px" }}>{store?.name}</h1>
      <p style={{ color: "#64748b", margin: "0 0 24px" }}>A new Selldoes theme.</p>
      {loading ? <p style={{ color: "#94a3b8" }}>Loading…</p> : <ProductGrid products={products} />}
    </div>
  )
}
