import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { CartProvider } from './context/CartContext.jsx'
import { captureUtms } from './lib/utm.js'
import { registrarAcesso } from './lib/acesso.js'
import './styles/global.css'

// Guarda as UTMs da URL (origem do tráfego) o quanto antes, para enviá-las à
// UTMify junto com o pedido lá no checkout.
captureUtms()
// Registra a visita (cidade aproximada via geo da Vercel) — 1x por sessão.
registrarAcesso()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <App />
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
