import { useState } from 'react';
import PasswordField from '../../components/PasswordField';
import { useTranslation } from '../../i18n/LanguageScope';
import { departmentUsersMessages } from './departmentUsersMessages';
import { generateTemporaryPassword } from './temporaryPassword';
import { PASSWORD_PATTERN } from './useDepartmentGovernance';

/** Temporary password input with "generate" and "copy"; the value only lives in the form state. */
export default function GeneratePasswordField({ id, value, onChange, label, fieldClassName, inputClassName }) {
  const { t } = useTranslation(departmentUsersMessages);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="space-y-2">
      <PasswordField fieldClassName={fieldClassName} inputClassName={inputClassName} label={label ?? t('password.label')} id={id} required minLength={14}
        pattern={PASSWORD_PATTERN} title={t('password.hint')} autoComplete="new-password" value={value}
        onChange={event => { setCopied(false); onChange(event.target.value); }} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setCopied(false); onChange(generateTemporaryPassword()); }}
          className="min-h-[36px] rounded-lg border border-accent-600 px-3 text-xs font-semibold text-accent-600">{t('password.generate')}</button>
        <button type="button" disabled={!value} onClick={() => void copy()}
          className="min-h-[36px] rounded-lg border border-black/10 px-3 text-xs font-semibold disabled:opacity-50 dark:border-white/10">{copied ? t('password.copied') : t('password.copy')}</button>
        <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('password.delivery')}</span>
      </div>
    </div>
  );
}
