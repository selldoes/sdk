import { useStore, useProducts, ProductCard } from "selldoes/theme"

/**
 * Bold home — dark canvas, oversized type and a promo banner. Designed to
 * make a sale or a drop feel loud.
 */
export default function HomePage() {
  const store = useStore()
  const { data, loading } = useProducts({ limit: 12 })
  const products = data?.products || []

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#0a0a0a", color: "#fafafa", minHeight: "100vh" }}>
      <div style={{ background: "#facc15", color: "#0a0a0a", textAlign: "center", padding: "10px 16px", fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Free shipping over $50 — today only
      </div>

      <header style={{ maxWidth: 1120, margin: "0 auto", padding: "26px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 18, letterSpacing: "-0.02em" }}>{store?.name}</strong>
        <span style={{ color: "#a3a3a3", fontSize: 13 }}>Shop</span>
      </header>

      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "48px 24px 72px" }}>
        <h1 style={{ fontSize: "clamp(48px, 9vw, 104px)", lineHeight: 0.95, fontWeight: 900, letterSpacing: "-0.04em", margin: 0, textTransform: "uppercase" }}>
          New
          <br />
          <span style={{ color: "#facc15" }}>drop.</span>
        </h1>
        <p style={{ color: "#a3a3a3", fontSize: 17, maxWidth: 520, marginTop: 22 }}>
          Limited runs, no restocks. Grab what you came for.
        </p>
      </section>

      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px 96px" }}>
        {loading ? (
          <p style={{ color: "#737373" }}>Loading…</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 20 }}>
            {products.map((product) => (
              <ProductCard key={product.sku || product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
