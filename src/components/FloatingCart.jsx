import { useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { formatBRL } from '../utils/format.js'
import { CartIcon } from './Icons.jsx'

// IMPORTANTE: usamos <button> + navigate() (e NÃO <Link to="/checkout">) de propósito.
// O script da UTMify intercepta cliques em <a href> de checkout (stopPropagation na
// fase de captura), e aí o react-router nunca recebe o clique → o link "não fazia nada".
// Botão não tem href, a UTMify não intercepta, e a navegação volta a funcionar.
export default function FloatingCart() {
  const { items, total } = useCart()
  const navigate = useNavigate()
  if (items.length === 0) return null

  return (
    <button
      type="button"
      onClick={() => navigate('/checkout')}
      className="fcart"
      aria-label={`Ver carrinho — ${items.length} itens`}
    >
      <span className="fcart__icon">
        <CartIcon size={22} />
        <span className="fcart__badge">{items.length}</span>
      </span>
      <span className="fcart__total">{formatBRL(total)}</span>
      <span className="fcart__chev" aria-hidden="true">»</span>
    </button>
  )
}
