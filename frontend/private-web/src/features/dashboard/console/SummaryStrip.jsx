// Resumen en línea: cada cifra muestra su definición. Sin tarjetas ni
// animaciones de conteo; los colores solo refuerzan lo que dice el texto.
const TONE = {
  neutral: 'text-occ-text',
  active: 'text-occ-accent',
  warn: 'text-occ-warn',
  ok: 'text-occ-ok',
};

export default function SummaryStrip({ t, summary, pendingReviewsIsLowerBound }) {
  const items = [
    { id: 'turnarounds', value: summary.turnarounds, tone: 'neutral' },
    { id: 'inProgress', value: summary.inProgress, tone: summary.inProgress ? 'active' : 'neutral' },
    { id: 'needsResources', value: summary.needsResources, tone: summary.needsResources ? 'warn' : 'neutral' },
    { id: 'pendingReviews', value: pendingReviewsIsLowerBound ? `≥${summary.pendingReviews}` : summary.pendingReviews,
      tone: summary.pendingReviews ? 'warn' : 'neutral' },
    { id: 'completed', value: summary.completed, tone: summary.completed ? 'ok' : 'neutral' },
  ];

  return (
    <section aria-label={t('summary.label')} className="occ-summary-strip">
      <dl className="grid grid-cols-2 divide-occ-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
        {items.map(item => (
          <div key={item.id} className="min-w-0 px-4 py-3" title={t(`summary.${item.id}Hint`)}>
            <dt className="text-xs font-medium text-occ-muted">{t(`summary.${item.id}`)}</dt>
            <dd className={`mt-0.5 font-mono text-2xl font-semibold leading-tight ${TONE[item.tone]}`}>{item.value}</dd>
            <dd className="sr-only">{t(`summary.${item.id}Hint`)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
