import { useTranslation } from '../../i18n/LanguageScope';
import { departmentUsersMessages } from './departmentUsersMessages';
import { accessLevel, actionLevel, LEVELS, moduleLevels, setAccessLevel, togglePermission } from './permissionLevels';

export { accessLevel, actionKind, setAccessLevel, togglePermission } from './permissionLevels';

const LEVEL_TONES = {
  none: 'bg-status-danger text-white', read: 'bg-accent-600/80 text-white', create: 'bg-accent-600/80 text-white',
  edit: 'bg-accent-600 text-white', full: 'bg-accent-600 text-white',
};

export function permissionLabels(catalog, codes) {
  const labels = [];
  catalog?.modules.forEach(module => {
    const granted = module.actions.filter(action => codes.includes(action.code));
    if (granted.length) labels.push(`${module.label}: ${granted.map(action => action.label.toLowerCase()).join(', ')}`);
  });
  return labels;
}

/** Menu options grouped by sidebar section, each followed by the functions that live inside it. */
export function matrixSections(catalog) {
  const modules = catalog?.modules ?? [];
  const sections = [];
  const bySection = new Map();
  for (const option of modules.filter(item => !item.parent)) {
    const name = option.section || '';
    if (!bySection.has(name)) { bySection.set(name, []); sections.push({ name, rows: bySection.get(name) }); }
    bySection.get(name).push({ module: option, depth: 0 });
    modules.filter(child => child.parent === option.key)
      .forEach(child => bySection.get(name).push({ module: child, depth: 1, parent: option }));
  }
  // A child whose parent is unknown still has to be grantable.
  const placed = new Set(sections.flatMap(section => section.rows.map(row => row.module.key)));
  const orphans = modules.filter(option => !placed.has(option.key));
  if (orphans.length) sections.push({ name: '', rows: orphans.map(option => ({ module: option, depth: 0 })) });
  return sections;
}

/**
 * One row per menu option of the department, grouped like the sidebar (ADR-0019), with a single level selector:
 * Sin acceso · Ver · Crear · Editar · Completo (only the levels that grant something new for that option). Grants
 * that match no level read «Personalizado»; «Ver detalle» keeps every action as a checkbox, so nothing is lost.
 */
export default function PermissionMatrix({ catalog, value, onChange, disabled = false, idPrefix = 'perm' }) {
  const { t } = useTranslation(departmentUsersMessages);
  if (!catalog) return <p className="text-sm text-text-secondary-light">{t('matrix.loading')}</p>;

  // A sub-window cannot be reached when the screen that contains it is forbidden.
  const blocked = parent => Boolean(parent) && accessLevel(value, parent) === 'none';

  const levels = (module, current, locked) => (
    <div role="radiogroup" aria-label={`${t('matrix.access')}: ${module.label}`} className="inline-flex flex-wrap items-stretch overflow-hidden rounded-md border border-black/15 dark:border-white/15">
      {moduleLevels(module).map(level => {
        const active = current === level;
        return (
          <button key={level} type="button" role="radio" aria-checked={active} disabled={disabled || (locked && level !== 'none')}
            title={t(`matrix.levelHint.${level}`)} onClick={() => onChange(setAccessLevel(value, module, level, catalog))}
            className={`min-h-[30px] px-2.5 text-[11px] font-semibold disabled:opacity-40 ${active ? LEVEL_TONES[level] : 'bg-transparent text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5'}`}>
            {t(`matrix.levels.${level}`)}
          </button>
        );
      })}
    </div>
  );

  // The actions of an option grouped by the level that grants them, each one still a checkbox.
  const detail = (module, current, locked) => (
    <details>
      <summary className="cursor-pointer select-none text-[11px] font-semibold text-accent-600 hover:underline">{t('matrix.detail')}</summary>
      <div className="mt-2 space-y-1.5">
        {LEVELS.slice(1).map(level => {
          const actions = module.actions.filter(action => actionLevel(action) === level);
          if (!actions.length) return null;
          return (
            <div key={level} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">{t(`matrix.levels.${level}`)}</span>
              {actions.map(action => (
                <label key={action.code} className="flex min-h-[26px] items-center gap-2">
                  <input id={`${idPrefix}-${action.code}`} type="checkbox" disabled={disabled || locked} checked={value.includes(action.code)}
                    aria-label={`${module.label}: ${action.label}`}
                    onChange={event => onChange(togglePermission(value, module, action, event.target.checked, catalog))}
                    className="h-4 w-4" />
                  <span>{action.label}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </details>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('matrix.hint')}</p>
      {matrixSections(catalog).map(section => (
        <section key={section.name || 'options'} aria-label={section.name || t('matrix.option')}
          className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[460px] text-left text-xs">
            <caption className="bg-black/[.03] px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-text-secondary-light dark:bg-white/[.03]">
              {section.name || t('matrix.option')}
            </caption>
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10">
                <th scope="col" className="w-[34%] px-3 py-2 font-semibold">{t('matrix.option')}</th>
                <th scope="col" className="px-3 py-2 font-semibold">{t('matrix.access')}</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map(({ module, depth, parent }) => {
                const locked = blocked(parent);
                const current = accessLevel(value, module);
                return (
                  <tr key={module.key} className="border-b border-black/5 align-top last:border-0 dark:border-white/5">
                    <th scope="row" className={`px-3 py-2.5 font-semibold ${depth ? 'pl-7 font-normal' : ''}`}>
                      {depth ? <span aria-hidden="true">↳ </span> : null}{module.label}
                      {parent && <span className="block text-[10px] font-normal text-text-secondary-light">{locked ? t('matrix.blockedByParent', { parent: parent.label }) : t('matrix.inside', { parent: parent.label })}</span>}
                    </th>
                    <td className="space-y-1.5 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {levels(module, current, locked)}
                        {current === 'custom' && <span title={t('matrix.customHint')} className="rounded bg-signal-500/15 px-2 py-1 text-[11px] font-semibold text-signal-500">{t('matrix.levels.custom')}</span>}
                      </div>
                      {/* An option with only «Ver» has nothing more to show. */}
                      {module.actions.length > 1 && detail(module, current, locked)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
