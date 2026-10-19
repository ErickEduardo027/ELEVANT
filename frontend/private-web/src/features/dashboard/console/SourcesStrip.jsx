// Declara qué alimenta la consola y qué no tiene fuente autorizada, para que la ausencia de
// tráfico aéreo, estado de pistas u ocupación física no se lea como "sin novedad". La
// interfaz, la conexión y la validación de la fuente son cosas distintas: aquí solo se
// informa la conexión vigente en este frontend.
const SOURCES = [
  { id: 'operational', state: 'connected' },
  { id: 'weather', state: 'unofficial' },
  { id: 'runwayGeometry', state: 'connected' },
  { id: 'satellite', state: 'optional' },
  { id: 'traffic', state: 'noSource', note: 'trafficNote' },
  { id: 'runwayStatus', state: 'noSource' },
  { id: 'occupancy', state: 'noSource' },
];

const DOT = {
  connected: 'bg-occ-ok',
  unofficial: 'bg-occ-warn',
  optional: 'bg-occ-accent',
  noSource: 'bg-transparent ring-1 ring-occ-line-strong',
};

export default function SourcesStrip({ t }) {
  return (
    <section aria-label={t('sources.title')} className="rounded-xl border border-occ-line bg-occ-panel px-4 py-3">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-occ-muted">{t('sources.title')}</h2>
      <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 xl:grid-cols-4">
        {SOURCES.map(source => (
          <li key={source.id} className="flex min-w-0 items-start gap-2">
            <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[source.state]}`} />
            <span className="min-w-0">
              <span className="text-occ-text">{t(`sources.${source.id}`)}</span>
              <span className="text-occ-muted"> · {t(`sources.${source.state}`)}</span>
              {source.note && <span className="block text-[10.5px] text-occ-muted">{t(`sources.${source.note}`)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
