import { useStore, useProducts, ProductGrid } from "selldoes/theme"

/**
 * Minimal home — quiet type, generous whitespace, the catalogue front and
 * centre. A good base when the products should do the talking.
 */
export default function HomePage() {
  const store = useStore()
  const { data, loading } = useProducts({ limit: 12, pageSize: 12 })
  const products = data?.products || []

  return (
    <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", background: "#ffffff", color: "#111111", minHeight: "100vh" }}>
      <header style={{ maxWidth: 1200, margin: "0 auto", padding: "36px 32px 72px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 14, letterSpacing: "0.22em", textTransform: "uppercase" }}>{store?.name}</span>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>Catalogue</span>
      </header>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px 96px" }}>
        {loading ? <p style={{ color: "#9ca3af", fontSize: 13 }}>Loading…</p> : <ProductGrid products={products} columns={5} />}
      </div>

      <footer style={{ borderTop: "1px solid #f3f4f6", padding: "28px 32px", textAlign: "center", color: "#9ca3af", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {store?.name}
      </footer>
    </div>
  )
}
