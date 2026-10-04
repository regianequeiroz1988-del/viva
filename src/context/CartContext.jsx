import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

const CartContext = createContext(null)
const CART_KEY = 'vs_cart'

/**
 * Carrinho persistente (localStorage) + toast de feedback.
 * Item: { id, title, price, qty, image?, date?, edition? }
 */
export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(CART_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  // Persiste o carrinho a cada mudança
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items))
    } catch {
      /* ignore */
    }
  }, [items])

  const notify = (message) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }

  const dismissToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
  }

  const addToCart = (item, qty = 1) => {
    setItems((prev) => {
      const existing = prev.find((p) => p.id === item.id)
      if (existing) {
        return prev.map((p) =>
          p.id === item.id ? { ...p, ...item, qty: p.qty + qty } : p
        )
      }
      return [...prev, { ...item, qty }]
    })
    notify('Adicionado ao carrinho!')
  }

  // Define a quantidade absoluta de um item (mínimo 1)
  const updateQty = (id, qty) =>
    setItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, qty: Math.max(1, qty) } : p))
    )

  const removeFromCart = (id) =>
    setItems((prev) => prev.filter((p) => p.id !== id))

  const clearCart = () => setItems([])

  const { count, total } = useMemo(() => {
    const count = items.reduce((sum, i) => sum + i.qty, 0)
    const total = items.reduce((sum, i) => sum + i.qty * i.price, 0)
    return { count, total }
  }, [items])

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        updateQty,
        removeFromCart,
        clearCart,
        count,
        total,
        toast,
        dismissToast,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export const useCart = () => {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart precisa estar dentro de <CartProvider>')
  return ctx
}
