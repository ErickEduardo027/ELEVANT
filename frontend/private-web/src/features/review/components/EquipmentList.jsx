import ReviewSection from './ReviewSection';

export default function EquipmentList({ equipment = [] }) {
  return (
    <ReviewSection title="Equipos">
      {equipment.length === 0 ? (
        <p className="text-text-secondary-light dark:text-text-secondary-dark">Sin equipos registrados.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
                <th className="py-1.5 text-left">Equipo</th>
                <th className="py-1.5 text-left">Planificado</th>
                <th className="py-1.5 text-left">Reportado</th>
                <th className="py-1.5 text-left">Utilizado</th>
              </tr>
            </thead>
            <tbody>
              {equipment.map(item => {
                const mismatch = item.planned !== item.used || item.planned !== item.reported;
                return (
                  <tr
                    key={item.name}
                    data-testid="equipment-row"
                    className={`border-t border-black/5 dark:border-white/5 ${mismatch ? 'bg-status-warning/5' : ''}`}
                  >
                    <td className="py-1.5 font-medium text-ink-900 dark:text-text-primary-dark">{item.name}</td>
                    <td className="py-1.5 text-text-secondary-light dark:text-text-secondary-dark">{item.planned}</td>
                    <td className={`py-1.5 font-mono ${mismatch ? 'text-status-warning' : 'text-ink-900 dark:text-text-primary-dark'}`}>
                      {item.reported}
                    </td>
                    <td className={`py-1.5 font-mono ${mismatch ? 'text-status-warning' : 'text-ink-900 dark:text-text-primary-dark'}`}>
                      {item.used}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ReviewSection>
  );
}
