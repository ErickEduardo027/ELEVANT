import { useTranslation } from '../../i18n/LanguageScope';
import { departmentUsersMessages } from './departmentUsersMessages';

/**
 * Module × action grid built from the server catalog. Choosing any action also
 * grants the module's `read`; clearing `read` clears the whole module, matching
 * how the API normalises grants.
 */
export function togglePermission(codes, module, action, checked) {
  const next = new Set(codes);
  const read = module.actions.find(item => item.action === 'read')?.code;
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

export default function PermissionMatrix({ catalog, value, onChange, disabled = false, idPrefix = 'perm' }) {
  const { t } = useTranslation(departmentUsersMessages);
  if (!catalog) return <p className="text-sm text-text-secondary-light">{t('matrix.loading')}</p>;
  return (
    <div className="space-y-2">
      {catalog.modules.map(module => (
        <fieldset key={module.key} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
          <legend className="px-1 text-xs font-semibold text-ink-900 dark:text-text-primary-dark">{module.label}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {module.actions.map(action => {
              const id = `${idPrefix}-${action.code}`;
              return (
                <label key={action.code} htmlFor={id} className="flex min-h-[32px] items-center gap-2 text-xs">
                  <input
                    id={id}
                    type="checkbox"
                    disabled={disabled}
                    checked={value.includes(action.code)}
                    onChange={event => onChange(togglePermission(value, module, action, event.target.checked))}
                    className="h-4 w-4"
                  />
                  {action.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
