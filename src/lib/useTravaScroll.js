import { useEffect } from 'react'

// Enquanto `ativo`, a página de trás não rola (inclusive no iOS).
export function useTravaScroll(ativo) {
  useEffect(() => {
    if (!ativo) return
    const y = window.scrollY
    const s = document.body.style
    Object.assign(s, { position: 'fixed', top: `-${y}px`, left: '0', right: '0', width: '100%' })
    return () => {
      Object.assign(s, { position: '', top: '', left: '', right: '', width: '' })
      window.scrollTo(0, y)
    }
  }, [ativo])
}

// Botão/gesto "voltar" do celular fecha o overlay em vez de sair da página.
export function useVoltarFecha(aberto, fechar) {
  useEffect(() => {
    if (!aberto) return
    let fechouPeloVoltar = false
    history.pushState({ ...history.state, overlay: true }, '')
    const onPop = () => { fechouPeloVoltar = true; fechar() }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!fechouPeloVoltar && history.state?.overlay) history.back()
    }
  }, [aberto]) // eslint-disable-line react-hooks/exhaustive-deps
}
