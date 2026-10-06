import { useStore, useProducts, ProductCard } from "selldoes/theme"

/**
 * Editorial home — a magazine-style landing page: serif headline, a featured
 * story card and a tidy two-column catalogue underneath.
 */
export default function HomePage() {
  const store = useStore()
  const { data, loading } = useProducts({ limit: 9 })
  const products = data?.products || []
  const [featured, ...rest] = products

  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", background: "#faf7f2", minHeight: "100vh" }}>
      <header style={{ borderBottom: "1px solid #e7e0d6", padding: "18px 0" }}>
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 13 }}>{store?.name}</strong>
          <span style={{ color: "#8a7f70", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}>The catalogue issue</span>
        </div>
      </header>

      <section style={{ maxWidth: 1040, margin: "0 auto", padding: "64px 24px 24px" }}>
        <p style={{ margin: 0, color: "#8a7f70", fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase" }}>New this week</p>
        <h1 style={{ fontSize: 56, lineHeight: 1.05, margin: "14px 0 0", maxWidth: 720, fontWeight: 400 }}>
          {store?.name} — objects with a story.
        </h1>
      </section>

      {featured ? (
        <section style={{ maxWidth: 1040, margin: "0 auto", padding: "24px", display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 32, alignItems: "center" }}>
          <div style={{ aspectRatio: "4/3", background: "#efe9df", overflow: "hidden" }}>
            <img
              src={featured.image || featured.mainImage}
              alt={featured.name}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
          <div>
            <p style={{ color: "#8a7f70", fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", margin: 0 }}>Featured</p>
            <h2 style={{ fontSize: 34, fontWeight: 400, margin: "10px 0 12px" }}>{featured.name}</h2>
            <p style={{ color: "#6b6156", lineHeight: 1.7, margin: "0 0 18px" }}>
              {String(featured.description || "A considered piece from the current collection.").slice(0, 180)}
            </p>
            <a href="#" style={{ color: "#1c1917", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 4 }}>
              Read the story →
            </a>
          </div>
        </section>
      ) : null}

      <section style={{ maxWidth: 1040, margin: "0 auto", padding: "8px 24px 72px" }}>
        <h3 style={{ fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", color: "#8a7f70", borderTop: "1px solid #e7e0d6", paddingTop: 20, marginBottom: 20 }}>
          From the collection
        </h3>
        {loading ? (
          <p style={{ color: "#a89f92" }}>Loading…</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 28 }}>
            {rest.map((product) => (
              <ProductCard key={product.sku || product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      <footer style={{ borderTop: "1px solid #e7e0d6", padding: "26px 24px", textAlign: "center", color: "#8a7f70", fontSize: 12 }}>
        {store?.name} · Printed digital, daily
      </footer>
    </div>
  )
}
