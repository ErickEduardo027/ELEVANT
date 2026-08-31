import ReviewSection from './ReviewSection';
import { buildPlanningVsExecutionRows, TONE_BADGE_CLASS } from '../reviewMappers';

export default function PlanningVsExecution({ operation }) {
  const rows = buildPlanningVsExecutionRows(operation);

  return (
    <ReviewSection title="Planificación vs. ejecución">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
              <th className="py-1.5 text-left">Campo</th>
              <th className="py-1.5 text-left">Planificado</th>
              <th className="py-1.5 text-left">Ejecutado</th>
              <th className="py-1.5 text-left">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className="border-t border-black/5 dark:border-white/5">
                <td className="py-1.5 font-medium text-ink-900 dark:text-text-primary-dark">{row.label}</td>
                <td className="py-1.5 text-text-secondary-light dark:text-text-secondary-dark">{row.plannedLabel}</td>
                <td className="py-1.5 font-mono text-ink-900 dark:text-text-primary-dark">{row.executedLabel}</td>
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
    </ReviewSection>
  );
}
