import React from "react"
import { useCart } from "./sdk.js"

export function Price({ amount, currency = "$", className = "" }) {
  const value = parseFloat(amount || "0")
  if (isNaN(value)) return null
  return React.createElement(
    "span",
    { className },
    `${currency}${value.toFixed(2)}`
  )
}

export function ProductCard({ product, onClick }) {
  const image = product?.image || product?.mainImage
  const el = React.createElement(
    "a",
    {
      href: onClick ? undefined : `#`,
      onClick: onClick
        ? (e) => {
            e.preventDefault()
            onClick(product)
          }
        : undefined,
      style: {
        display: "block",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
        textDecoration: "none",
        color: "inherit",
        height: "100%",
      },
    },
    React.createElement("div", {
      style: {
        aspectRatio: "1/1",
        background: "#f1f5f9",
        backgroundImage: image ? `url(${image})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      },
    }),
    React.createElement(
      "div",
      { style: { padding: "12px 14px" } },
      React.createElement(
        "p",
        { style: { margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.4, minHeight: 40 } },
        product?.name || ""
      ),
      React.createElement(
        "p",
        { style: { margin: "6px 0 0", fontSize: 15, fontWeight: 700 } },
        React.createElement(Price, { amount: product?.price })
      )
    )
  )
  return React.createElement(
    "div",
    { style: { height: "100%" } },
    el
  )
}

export function ProductGrid({ products = [], renderItem, columns = 4 }) {
  return React.createElement(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(140, 220 / (columns / 2))}px, 1fr))`,
        gap: 16,
      },
    },
    (products || []).map((p, i) => {
      const child = renderItem ? renderItem(p, i) : React.createElement(ProductCard, { product: p, key: p.sku || i })
      return React.createElement(React.Fragment, { key: p.sku || i }, child)
    })
  )
}

export function ProductGallery({ images = [], alt = "" }) {
  const [active, setActive] = React.useState(0)
  const list = (images || []).filter(Boolean)
  if (list.length === 0) {
    return React.createElement("div", {
      style: { aspectRatio: "1/1", background: "#f1f5f9", borderRadius: 12 },
    })
  }
  const src = list[Math.min(active, list.length - 1)]
  return React.createElement(
    "div",
    { style: { display: "flex", gap: 12, flexDirection: "column" } },
    React.createElement("img", {
      src,
      alt,
      style: { width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: 12, border: "1px solid #e2e8f0" },
    }),
    list.length > 1 &&
      React.createElement(
        "div",
        { style: { display: "flex", gap: 8, overflowX: "auto" } },
        list.map((img, i) =>
          React.createElement("img", {
            key: i,
            src: img,
            alt: "",
            onClick: () => setActive(i),
            style: {
              width: 64,
              height: 64,
              objectFit: "cover",
              borderRadius: 8,
              cursor: "pointer",
              border: i === active ? "2px solid #2563eb" : "1px solid #e2e8f0",
            },
          })
        )
      )
  )
}

export function CategoryList({ categories = [] }) {
  return React.createElement(
    "div",
    { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
    (categories || []).map((c) =>
      React.createElement(
        "span",
        {
          key: c.slug,
          style: {
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid #e2e8f0",
            fontSize: 13,
            background: "#fff",
          },
        },
        `${c.name} (${c.productCount || 0})`
      )
    )
  )
}

export function AddToCartButton({ product, quantity = 1, children }) {
  const cart = useCart()
  return React.createElement(
    "button",
    {
      onClick: () => cart.add(product, quantity),
      style: {
        background: "#0f172a",
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "12px 22px",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      },
    },
    children || "Add to cart"
  )
}

export function CartDrawer({ open, onClose }) {
  const cart = useCart()
  if (!open) return null
  return React.createElement(
    "div",
    {
      style: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.4)",
        zIndex: 100,
        display: "flex",
        justifyContent: "flex-end",
      },
      onClick: onClose,
    },
    React.createElement(
      "div",
      {
        onClick: (e) => e.stopPropagation(),
        style: { width: 380, maxWidth: "100%", height: "100%", background: "#fff", padding: 24, overflowY: "auto" },
      },
      React.createElement(
        "div",
        { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } },
        React.createElement("strong", null, "Cart"),
        React.createElement("button", { onClick: onClose, style: { background: "none", border: "none", cursor: "pointer", fontSize: 16 } }, "✕")
      ),
      cart.items.length === 0 &&
        React.createElement("p", { style: { color: "#64748b" } }, "Your cart is empty."),
      cart.items.map((i) =>
        React.createElement(
          "div",
          {
            key: i.sku,
            style: { display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid #f1f5f9" },
          },
          React.createElement("img", {
            src: i.image || "",
            alt: i.name,
            style: { width: 56, height: 56, objectFit: "cover", borderRadius: 8, background: "#f1f5f9" },
          }),
          React.createElement(
            "div",
            { style: { flex: 1 } },
            React.createElement("p", { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, i.name),
            React.createElement("p", { style: { margin: "4px 0 0", fontSize: 13, color: "#64748b" } }, `Qty ${i.quantity}`),
            React.createElement("p", { style: { margin: "4px 0 0", fontSize: 13, fontWeight: 700 } },
              React.createElement(Price, { amount: String((parseFloat(i.price) || 0) * i.quantity) })
            )
          ),
          React.createElement(
            "button",
            {
              onClick: () => cart.remove(i.sku),
              style: { background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 13 },
            },
            "Remove"
          )
        )
      ),
      cart.items.length > 0 &&
        React.createElement(
          "div",
          { style: { marginTop: 16, display: "flex", justifyContent: "space-between", fontWeight: 700 } },
          React.createElement("span", null, "Total"),
          React.createElement(Price, { amount: String(cart.total) })
        )
    )
  )
}

export function Breadcrumbs({ items = [] }) {
  return React.createElement(
    "nav",
    { style: { display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "#64748b" } },
    (items || []).map((item, i) =>
      React.createElement(
        React.Fragment,
        { key: i },
        i > 0 && React.createElement("span", null, "/"),
        React.createElement("span", { style: i === items.length - 1 ? { color: "#0f172a", fontWeight: 600 } : undefined }, item)
      )
    )
  )
}

export function Container({ children, maxWidth = 960, padding = 24, style = {} }) {
  return React.createElement(
    "div",
    { style: { maxWidth, margin: "0 auto", padding, ...style } },
    children
  )
}

export function Section({ children, background = "#fff", padding = "48px 0", style = {} }) {
  return React.createElement(
    "section",
    { style: { background, padding, ...style } },
    React.createElement(Container, null, children)
  )
}
