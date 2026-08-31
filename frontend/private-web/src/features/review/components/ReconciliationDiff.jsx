import ReviewSection from './ReviewSection';
import { buildReconciliationRows, TONE_BADGE_CLASS } from '../reviewMappers';

export default function ReconciliationDiff({ operation }) {
  const rows = buildReconciliationRows(operation);

  return (
    <ReviewSection title="Conciliación con contrato">
      {rows.length === 0 ? (
        <p className="text-text-secondary-light dark:text-text-secondary-dark">Sin conceptos facturables por conciliar.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
                <th className="py-1.5 text-left">Concepto facturable</th>
                <th className="py-1.5 text-left">Contratado</th>
                <th className="py-1.5 text-left">Ejecutado</th>
                <th className="py-1.5 text-left">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.concept} className="border-t border-black/5 dark:border-white/5">
                  <td className="py-1.5 font-medium text-ink-900 dark:text-text-primary-dark">{row.concept}</td>
                  <td className="py-1.5 text-text-secondary-light dark:text-text-secondary-dark">
                    {row.contracted} {row.unit}
                  </td>
                  <td className="py-1.5 font-mono text-ink-900 dark:text-text-primary-dark">
                    {row.executed} {row.unit}
                  </td>
                  <td className="py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_BADGE_CLASS[row.tone]}`}>
                      {row.resultLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReviewSection>
  );
}
