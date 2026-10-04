import { useCart } from '../context/CartContext.jsx'
import { Check, Close } from './Icons.jsx'

export default function Toast() {
  const { toast, dismissToast } = useCart()
  if (!toast) return null

  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast__check">
        <Check size={16} />
      </span>
      <span className="toast__msg">{toast}</span>
      <button className="toast__close" onClick={dismissToast} aria-label="Fechar">
        <Close size={16} />
      </button>
    </div>
  )
}
