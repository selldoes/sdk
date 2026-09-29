import React, { createContext, useContext, useEffect, useState } from "react"

const SDKContext = createContext(null)

export function SDKProvider({ bridge, children }) {
  return React.createElement(SDKContext.Provider, { value: bridge }, children)
}

export function useBridge() {
  const bridge = useContext(SDKContext)
  if (!bridge) throw new Error("useBridge must be used inside <SDKProvider>")
  return bridge
}

export function useStore() {
  const { payload } = useBridge()
  return payload.store || null
}

export function usePageType() {
  const { payload } = useBridge()
  return payload.pageType || "home"
}

export function useTheme() {
  const { payload } = useBridge()
  return payload.theme || {}
}

export function useSections(pageType) {
  const { payload } = useBridge()
  const sections = payload.sections || {}
  return sections[pageType] || []
}

export function useInitialProduct() {
  const { payload } = useBridge()
  return payload.product || null
}

function useApi(path, options = {}, deps = []) {
  const bridge = useBridge()
  const [state, setState] = useState({ data: null, loading: true, error: null })

  useEffect(() => {
    if (path == null) {
      setState({ data: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    bridge
      .apiFetch(path, options)
      .then((text) => {
        if (cancelled) return
        let data
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
        setState({ data, loading: false, error: null })
      })
      .catch((err) => {
        if (cancelled) return
        setState({ data: null, loading: false, error: err })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

function storePath(store, rest) {
  return `/api/store/${store?.slug || ""}${rest}`
}

export function useProducts(opts = {}) {
  const store = useStore()
  const params = new URLSearchParams()
  if (opts.limit) params.set("limit", String(opts.limit))
  if (opts.page) params.set("page", String(opts.page))
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize))
  if (opts.category) params.set("category", opts.category)
  if (opts.q) params.set("q", opts.q)
  if (opts.sortBy) params.set("sortBy", opts.sortBy)
  if (opts.skus) params.set("skus", opts.skus)
  const qs = params.toString()
  const key = storePath(store, `/products${qs ? `?${qs}` : ""}`)
  return useApi(key, {}, [key])
}

export function useProductDetail(sku, opts = {}) {
  const store = useStore()
  const params = new URLSearchParams()
  if (opts.variants) params.set("variants", "1")
  const qs = params.toString()
  const key = storePath(store, `/products/${encodeURIComponent(sku)}${qs ? `?${qs}` : ""}`)
  return useApi(key, {}, [key])
}

export function useCategories() {
  const store = useStore()
  const key = storePath(store, "/categories")
  return useApi(key, {}, [key])
}

export function useRelatedProducts(sku, opts = {}) {
  const store = useStore()
  const params = new URLSearchParams()
  if (opts.matchBy) params.set("matchBy", opts.matchBy)
  if (opts.attributeKey) params.set("attributeKey", opts.attributeKey)
  if (opts.limit) params.set("limit", String(opts.limit))
  const qs = params.toString()
  const key = storePath(store, `/products/${encodeURIComponent(sku)}/related${qs ? `?${qs}` : ""}`)
  return useApi(key, {}, [key])
}

export function useReviews(sku) {
  const store = useStore()
  const key = storePath(store, `/products/${encodeURIComponent(sku)}/reviews`)
  return useApi(key, {}, [key])
}

export function useStoreSectionsData() {
  const store = useStore()
  const key = storePath(store, "/sections")
  return useApi(key, {}, [key])
}

export function useCustomer() {
  const store = useStore()
  const bridge = useBridge()
  const key = storePath(store, "/auth/me")
  const result = useApi(key, {}, [key])

  const post = async (path, body) => {
    const text = await bridge.apiFetch(storePath(store, path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  const login = (email, password) => post("/auth/login", { email, password })
  const register = (name, email, password) => post("/auth/register", { name, email, password })
  const logout = async () => {
    await bridge.apiFetch(storePath(store, "/auth/logout"), { method: "POST" })
  }

  // The customer session cookie does not cross the bridge; 401 means "not logged in".
  if (result.error) return { data: null, loading: false, error: null, login, register, logout }
  return { ...result, login, register, logout }
}

/**
 * A single order owned by the logged-in customer, including digital
 * deliveries from the store's active plugins. Mirrors `useOrder` from
 * `@/lib/template-api`. Returns `{ data: { order, deliveries }, loading, error }`.
 */
export function useOrder(orderId, opts = {}) {
  const store = useStore()
  const enabled = opts.enabled !== false && orderId != null && orderId !== ""
  const key = enabled ? storePath(store, `/auth/orders/${encodeURIComponent(orderId)}`) : null
  return useApi(key, {}, [key])
}

const CART_KEY = "selldesk-cart"

export function useCart() {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items))
    } catch {
      /* storage unavailable */
    }
  }, [items])

  const add = (product, quantity = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.sku === product.sku)
      if (existing) {
        return prev.map((i) => (i.sku === product.sku ? { ...i, quantity: i.quantity + quantity } : i))
      }
      return [...prev, { sku: product.sku, name: product.name, price: product.price, image: product.image || null, quantity }]
    })
  }

  const remove = (sku) => setItems((prev) => prev.filter((i) => i.sku !== sku))

  const updateQuantity = (sku, quantity) =>
    setItems((prev) =>
      quantity <= 0 ? prev.filter((i) => i.sku !== sku) : prev.map((i) => (i.sku === sku ? { ...i, quantity } : i))
    )

  const clear = () => setItems([])

  const total = items.reduce((sum, i) => sum + (parseFloat(i.price) || 0) * i.quantity, 0)
  const count = items.reduce((sum, i) => sum + i.quantity, 0)

  return { items, add, remove, updateQuantity, clear, total, count }
}

/**
 * Client-side wishlist (local to the template iframe). Same shape as the
 * code-template `useWishlist` in `@/lib/template-api`.
 */
const WISHLIST_KEY = "selldesk-wishlist"

export function useWishlist() {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(WISHLIST_KEY)) || []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(WISHLIST_KEY, JSON.stringify(items))
    } catch {
      /* storage unavailable */
    }
  }, [items])

  const isWishlisted = (sku) => items.some((i) => i.sku === sku)

  const toggleWishlist = (product) =>
    setItems((prev) =>
      prev.some((i) => i.sku === product.sku)
        ? prev.filter((i) => i.sku !== product.sku)
        : [...prev, { sku: product.sku, name: product.name, price: product.price, category: product.category, image: product.image || null }]
    )

  const removeWishlist = (sku) => setItems((prev) => prev.filter((i) => i.sku !== sku))

  return { items, isWishlisted, toggleWishlist, removeWishlist, count: items.length }
}

/**
 * Storefront link builder — same signature as the code-template
 * `useStoreLink` in `@/lib/template-api`. Returns clean paths when the host
 * uses a custom domain, otherwise `/store/<slug>/<path>`.
 */
export function useStoreLink() {
  const { payload } = useBridge()
  const clean = !!(payload.theme && payload.theme.cleanLinks)
  return React.useCallback(
    (slug, path, region) => {
      if (clean) return region ? `/${region}${path}` : path
      if (region) return `/store/${slug}/${region}${path}`
      return `/store/${slug}${path}`
    },
    [clean]
  )
}
