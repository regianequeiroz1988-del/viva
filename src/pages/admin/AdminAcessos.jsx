import { supabase } from '../../lib/supabase.js'
import PainelAcessos from '../../components/PainelAcessos.jsx'

const carregar = async (desde) => {
  const { data, error } = await supabase.rpc('acessos_painel', { p_desde: desde })
  if (error) throw new Error(error.message)
  return data
}

export default function AdminAcessos() {
  return (
    <div>
      <header className="adm__pagehead">
        <div>
          <h1 className="adm__title">Acessos</h1>
          <p className="adm__subtitle">Quem entra no site, de onde, quantas vezes volta e se vira venda</p>
        </div>
      </header>
      <PainelAcessos carregar={carregar} />
    </div>
  )
}
