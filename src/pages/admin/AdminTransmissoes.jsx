import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import PainelTransmissoes from '../../components/PainelTransmissoes.jsx'

const credenciais = async () => ({ role: 'admin', jwt: (await supabase.auth.getSession()).data.session?.access_token || '' })
const carregarLigadores = async () => (await supabase.rpc('listar_ligadores')).data

export default function AdminTransmissoes() {
  const [conectado, setConectado] = useState(false)

  return (
    <section>
      <header className="adm__pagehead"><div>
        <h1 className="adm__title">Transmissões</h1>
        <p className="usr-muted">
          {conectado ? 'Clique num ligador transmitindo pra assistir a tela dele (com áudio).' : 'Conectando ao servidor de transmissão…'}
        </p>
      </div></header>
      <PainelTransmissoes credenciais={credenciais} carregarLigadores={carregarLigadores} onConexao={setConectado} />
    </section>
  )
}
