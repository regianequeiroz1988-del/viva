import { adBanners } from '../data/content.js'

export default function AdBanners() {
  return (
    <section className="ads">
      <div className="container ads__grid">
        {adBanners.map((b) => (
          <div className="ad" key={b.id}>
            <img className="ad__img" src={b.image} alt={b.label} />
          </div>
        ))}
      </div>
    </section>
  )
}
