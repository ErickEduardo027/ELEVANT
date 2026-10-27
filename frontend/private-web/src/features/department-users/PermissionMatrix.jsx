import { useTranslation } from '../../i18n/LanguageScope';
import { departmentUsersMessages } from './departmentUsersMessages';

const CRUD = ['read', 'create', 'update', 'delete'];
const LEGACY_KINDS = { read: 'read', create: 'create', update: 'update', edit: 'update', delete: 'delete', retire: 'delete' };

/** Matrix column of an action; catalogs from older APIs have no `kind`. */
export const actionKind = action => action.kind ?? LEGACY_KINDS[action.action] ?? 'other';

/**
 * Grants or revokes one action of a menu option. Choosing any action also grants the
 * option's «Ver»; clearing «Ver» clears the whole option, matching how the API
 * normalises grants.
 */
export function togglePermission(codes, module, action, checked) {
  const next = new Set(codes);
  const read = module.actions.find(item => actionKind(item) === 'read')?.code;
  if (checked) {
    next.add(action.code);
    if (read) next.add(read);
  } else if (action.code === read) {
    module.actions.forEach(item => next.delete(item.code));
  } else {
    next.delete(action.code);
  }
  return [...next].sort();
}

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
 * Menu option × action grid built from the server catalog (ADR-0019): one row per option of
 * the department's menu, grouped like the sidebar, with the columns Ver, Crear, Modificar and
 * Eliminar plus the option's own workflow actions.
 */
export default function PermissionMatrix({ catalog, value, onChange, disabled = false, idPrefix = 'perm' }) {
  const { t } = useTranslation(departmentUsersMessages);
  if (!catalog) return <p className="text-sm text-text-secondary-light">{t('matrix.loading')}</p>;

  const checkbox = (module, action) => {
    const id = `${idPrefix}-${action.code}`;
    return (
      <input id={id} type="checkbox" disabled={disabled} checked={value.includes(action.code)}
        aria-label={`${module.label}: ${action.label}`} title={action.label}
        onChange={event => onChange(togglePermission(value, module, action, event.target.checked))}
        className="h-4 w-4" />
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('matrix.hint')}</p>
      {matrixSections(catalog).map(section => (
        <section key={section.name || 'options'} aria-label={section.name || t('matrix.option')}
          className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[560px] text-left text-xs">
            <caption className="bg-black/[.03] px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-text-secondary-light dark:bg-white/[.03]">
              {section.name || t('matrix.option')}
            </caption>
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10">
                <th scope="col" className="px-3 py-2 font-semibold">{t('matrix.option')}</th>
                {CRUD.map(kind => <th key={kind} scope="col" className="w-20 px-2 py-2 text-center font-semibold">{t(`matrix.${kind}`)}</th>)}
                <th scope="col" className="px-3 py-2 font-semibold">{t('matrix.other')}</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map(({ module, depth, parent }) => {
                const others = module.actions.filter(action => actionKind(action) === 'other');
                return (
                  <tr key={module.key} className="border-b border-black/5 last:border-0 dark:border-white/5">
                    <th scope="row" className={`px-3 py-2 font-semibold ${depth ? 'pl-7 font-normal' : ''}`}>
                      {depth ? <span aria-hidden="true">↳ </span> : null}{module.label}
                      {parent && <span className="block text-[10px] font-normal text-text-secondary-light">{t('matrix.inside', { parent: parent.label })}</span>}
                    </th>
                    {CRUD.map(kind => {
                      const action = module.actions.find(item => actionKind(item) === kind);
                      return (
                        <td key={kind} className="px-2 py-2 text-center">
                          {action ? <label className="inline-flex flex-col items-center gap-0.5">
                            {checkbox(module, action)}
                            {action.label !== t(`matrix.${kind}`) && <span className="max-w-[7rem] text-[10px] leading-tight text-text-secondary-light">{action.label}</span>}
                          </label> : <span className="text-text-secondary-light" title={t('matrix.none')}>—</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2">
                      {others.length ? <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {others.map(action => (
                          <label key={action.code} className="flex min-h-[28px] items-center gap-2">
                            {checkbox(module, action)}<span>{action.label}</span>
                          </label>
                        ))}
                      </div> : <span className="text-text-secondary-light">—</span>}
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
