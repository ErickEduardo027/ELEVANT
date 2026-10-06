import { useAuthLanguage } from '../i18n/useAuthLanguage';

const base = '/';

// width = native pixel width of the supplied PNG; the stylesheet scales every
// logo by the same factor so the strip keeps the mockup's proportions.
const AIRLINES = [
  { id: 'american', name: 'American Airlines', src: `${base}brand/airlines/american-airlines.png`, width: 364, height: 136 },
  { id: 'united', name: 'United Airlines', src: `${base}brand/airlines/united.png`, width: 404, height: 88 },
  { id: 'delta', name: 'Delta Air Lines', src: `${base}brand/airlines/delta.png`, width: 360, height: 76 },
  { id: 'jetblue', name: 'JetBlue', src: `${base}brand/airlines/jetblue.png`, width: 216, height: 88 },
  { id: 'avianca', name: 'Avianca', src: `${base}brand/airlines/avianca.png`, width: 320, height: 100 },
  { id: 'iberia', name: 'Iberia', src: `${base}brand/airlines/iberia.png`, width: 388, height: 92 },
];

function AirlineSet({ decorative = false }) {
  return (
    <ul className="elv-airline-set" aria-hidden={decorative || undefined}>
      {AIRLINES.map(airline => (
        <li key={airline.id} className="elv-airline">
          <img
            src={airline.src}
            alt={decorative ? '' : airline.name}
            width={airline.width}
            height={airline.height}
            decoding="async"
            draggable="false"
            style={{ '--elv-logo-w': airline.width }}
          />
        </li>
      ))}
    </ul>
  );
}

export default function AirportShowcase() {
  const { t } = useAuthLanguage();

  return (
    <aside className="elv-showcase" aria-label={t('showcase.airlines')}>
      <div className="elv-photo">
        {['light', 'dark'].map(theme => (
          <div key={theme} className={`elv-photo-stack elv-photo-stack--${theme}`}>
            <img className="elv-photo-sky" src={`${base}images/login-airport-${theme}-sky.webp`} alt="" decoding="async" />
            <img className="elv-photo-img" src={`${base}images/login-airport-${theme}.webp`} alt="" decoding="async" />
          </div>
        ))}
      </div>
      <div className="elv-showcase-shade" />

      <p className="elv-showcase-caption">{t('showcase.caption')}</p>

      <div className="elv-marquee">
        <div className="elv-marquee-track">
          <AirlineSet />
          <AirlineSet decorative />
        </div>
      </div>
    </aside>
  );
}
