// Player flexível: aceita link do YouTube, Vimeo ou um arquivo de vídeo direto (.mp4/.webm).
function parseVideo(url) {
  const u = String(url || '').trim()
  if (!u) return null

  // YouTube (watch, youtu.be, shorts, embed)
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/)
  if (yt) return { tipo: 'embed', src: `https://www.youtube.com/embed/${yt[1]}?rel=0&modestbranding=1` }

  // Vimeo
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vm) return { tipo: 'embed', src: `https://player.vimeo.com/video/${vm[1]}` }

  // Arquivo direto
  if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(u)) return { tipo: 'file', src: u }

  // Desconhecido → tenta como iframe genérico
  return { tipo: 'embed', src: u }
}

export default function VideoMensagem({ url, titulo = 'Mensagem especial pra você 🎥' }) {
  const v = parseVideo(url)
  if (!v) return null

  return (
    <div className="vmsg">
      <span className="vmsg__titulo">{titulo}</span>
      <div className="vmsg__frame">
        {v.tipo === 'file' ? (
          <video src={v.src} controls playsInline preload="metadata" className="vmsg__media" />
        ) : (
          <iframe
            src={v.src}
            title={titulo}
            className="vmsg__media"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )}
      </div>
    </div>
  )
}
