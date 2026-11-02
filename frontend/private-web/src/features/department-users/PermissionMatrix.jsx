import { useTranslation } from '../../i18n/LanguageScope';
import { departmentUsersMessages } from './departmentUsersMessages';

const CRUD = ['read', 'create', 'update', 'delete'];
const LEGACY_KINDS = { read: 'read', create: 'create', update: 'update', edit: 'update', delete: 'delete', retire: 'delete' };

/** Matrix column of an action; catalogs from older APIs have no `kind`. */
export const actionKind = action => action.kind ?? LEGACY_KINDS[action.action] ?? 'other';

const readOf = module => module?.actions.find(item => actionKind(item) === 'read')?.code;

/** Sub-windows of an option, so forbidding a screen also forbids what lives inside it. */
const childrenOf = (catalog, module) => (catalog?.modules ?? []).filter(item => item.parent === module.key);

/** The option that contains a sub-window, when the catalog knows it. */
const parentOf = (catalog, module) => module.parent ? (catalog?.modules ?? []).find(item => item.key === module.parent) : undefined;

function grantParentRead(next, catalog, module) {
  const parentRead = readOf(parentOf(catalog, module));
  if (parentRead) next.add(parentRead);
}

function forbid(next, catalog, module) {
  module.actions.forEach(item => next.delete(item.code));
  childrenOf(catalog, module).forEach(child => forbid(next, catalog, child));
}

/**
 * Grants or revokes one action of a menu option. Choosing any action also grants the
 * option's «Ver» and, for a sub-window, «Ver» of the screen that contains it; clearing «Ver»
 * clears the whole option and its sub-windows, matching how the API normalises grants.
 */
export function togglePermission(codes, module, action, checked, catalog) {
  const next = new Set(codes);
  const read = readOf(module);
  if (checked) {
    next.add(action.code);
    if (read) next.add(read);
    grantParentRead(next, catalog, module);
  } else if (action.code === read) {
    forbid(next, catalog, module);
  } else {
    next.delete(action.code);
  }
  return [...next].sort();
}

const EDIT_KINDS = ['read', 'create', 'update', 'delete'];

/** Quick level of a row: none, read, edit (every CRUD action it offers) or custom. */
export function accessLevel(codes, module) {
  const granted = module.actions.filter(action => codes.includes(action.code));
  if (!granted.length) return 'none';
  const crud = module.actions.filter(action => EDIT_KINDS.includes(actionKind(action)));
  const hasAllCrud = crud.every(action => codes.includes(action.code));
  const onlyRead = granted.every(action => actionKind(action) === 'read');
  if (onlyRead) return 'read';
  if (hasAllCrud && crud.length > 1 && granted.every(action => EDIT_KINDS.includes(actionKind(action)))) return 'edit';
  return 'custom';
}

/**
 * Applies a quick level to a row. «Editar» grants Ver, Crear, Modificar and Eliminar (the ones
 * the option offers) and leaves workflow actions as they were; «Ver» keeps only reading;
 * «Prohibido» removes the option and every sub-window inside it.
 */
export function setAccessLevel(codes, module, level, catalog) {
  const next = new Set(codes);
  if (level === 'none') {
    forbid(next, catalog, module);
    return [...next].sort();
  }
  const read = readOf(module);
  module.actions.forEach(action => {
    const kind = actionKind(action);
    if (kind === 'read') next.add(action.code);
    else if (EDIT_KINDS.includes(kind)) { if (level === 'edit') next.add(action.code); else next.delete(action.code); }
    else if (level === 'read') next.delete(action.code);
  });
  if (read) next.add(read);
  grantParentRead(next, catalog, module);
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

  // A sub-window cannot be reached when the screen that contains it is forbidden.
  const blocked = parent => Boolean(parent) && accessLevel(value, parent) === 'none';

  const checkbox = (module, action, locked) => {
    const id = `${idPrefix}-${action.code}`;
    return (
      <input id={id} type="checkbox" disabled={disabled || locked} checked={value.includes(action.code)}
        aria-label={`${module.label}: ${action.label}`} title={action.label}
        onChange={event => onChange(togglePermission(value, module, action, event.target.checked, catalog))}
        className="h-4 w-4" />
    );
  };

  const levels = (module, locked) => {
    const current = accessLevel(value, module);
    const hasEdit = module.actions.filter(action => EDIT_KINDS.includes(actionKind(action))).length > 1;
    return (
      <div role="radiogroup" aria-label={`${t('matrix.access')}: ${module.label}`} className="inline-flex overflow-hidden rounded-md border border-black/15 dark:border-white/15">
        {['none', 'read', 'edit'].filter(level => level !== 'edit' || hasEdit).map(level => {
          const active = current === level;
          const tone = level === 'none' ? 'bg-status-danger text-white' : level === 'read' ? 'bg-accent-600/80 text-white' : 'bg-accent-600 text-white';
          return (
            <button key={level} type="button" role="radio" aria-checked={active} disabled={disabled || (locked && level !== 'none')}
              title={t(`matrix.levelHint.${level}`)} onClick={() => onChange(setAccessLevel(value, module, level, catalog))}
              className={`min-h-[28px] px-2 text-[11px] font-semibold disabled:opacity-40 ${active ? tone : 'bg-transparent text-text-secondary-light hover:bg-black/5 dark:hover:bg-white/5'}`}>
              {t(`matrix.levels.${level}`)}
            </button>
          );
        })}
        {current === 'custom' && <span className="bg-signal-500/15 px-2 py-1 text-[11px] font-semibold text-signal-500">{t('matrix.levels.custom')}</span>}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('matrix.hint')}</p>
      {matrixSections(catalog).map(section => (
        <section key={section.name || 'options'} aria-label={section.name || t('matrix.option')}
          className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[720px] text-left text-xs">
            <caption className="bg-black/[.03] px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-text-secondary-light dark:bg-white/[.03]">
              {section.name || t('matrix.option')}
            </caption>
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10">
                <th scope="col" className="px-3 py-2 font-semibold">{t('matrix.option')}</th>
                <th scope="col" className="px-2 py-2 font-semibold">{t('matrix.access')}</th>
                {CRUD.map(kind => <th key={kind} scope="col" className="w-20 px-2 py-2 text-center font-semibold">{t(`matrix.${kind}`)}</th>)}
                <th scope="col" className="px-3 py-2 font-semibold">{t('matrix.other')}</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map(({ module, depth, parent }) => {
                const others = module.actions.filter(action => actionKind(action) === 'other');
                const locked = blocked(parent);
                return (
                  <tr key={module.key} className="border-b border-black/5 last:border-0 dark:border-white/5">
                    <th scope="row" className={`px-3 py-2 font-semibold ${depth ? 'pl-7 font-normal' : ''}`}>
                      {depth ? <span aria-hidden="true">↳ </span> : null}{module.label}
                      {parent && <span className="block text-[10px] font-normal text-text-secondary-light">{locked ? t('matrix.blockedByParent', { parent: parent.label }) : t('matrix.inside', { parent: parent.label })}</span>}
                    </th>
                    <td className="px-2 py-2">{levels(module, locked)}</td>
                    {CRUD.map(kind => {
                      const action = module.actions.find(item => actionKind(item) === kind);
                      return (
                        <td key={kind} className="px-2 py-2 text-center">
                          {action ? <label className="inline-flex flex-col items-center gap-0.5">
                            {checkbox(module, action, locked)}
                            {action.label !== t(`matrix.${kind}`) && <span className="max-w-[7rem] text-[10px] leading-tight text-text-secondary-light">{action.label}</span>}
                          </label> : <span className="text-text-secondary-light" title={t('matrix.none')}>—</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2">
                      {others.length ? <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {others.map(action => (
                          <label key={action.code} className="flex min-h-[28px] items-center gap-2">
                            {checkbox(module, action, locked)}<span>{action.label}</span>
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
