import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { createTranslator, getLanguage, subscribeLanguage } from '../../i18n/languageStore';
import styles from './LogoutConfirmation.module.css';

const messages = {
  es: {
    title: 'Confirmar cierre de sesión',
    description: '¿Estás seguro de que deseas cerrar sesión?',
    cancel: 'Cancelar', confirm: 'Cerrar sesión', busy: 'Cerrando sesión…',
    error: 'No fue posible cerrar sesión. Inténtalo de nuevo.',
  },
  en: {
    title: 'Confirm sign out', description: 'Are you sure you want to sign out?',
    cancel: 'Cancel', confirm: 'Sign out', busy: 'Signing out…',
    error: 'Sign out could not be completed. Please try again.',
  },
};

export default function LogoutConfirmation({ open, busy, error, dismiss, confirm }) {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => 'es');
  const t = useMemo(() => createTranslator(messages, language), [language]);
  const descriptionId = useId();
  const wrapper = useRef(null);

  useEffect(() => {
    if (!open) return;
    if (busy) wrapper.current?.querySelector('[aria-modal="true"]')?.focus();
    else if (error) wrapper.current?.querySelector('button')?.focus();
  }, [open, busy, error]);

  if (!open) return null;
  return <div ref={wrapper} onKeyDownCapture={event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (!busy) dismiss();
  }}>
    <ConfirmDialog open={open} title={t('title')} description={<>
      <p id={descriptionId}>{t('description')}</p>
      {error && <p role="alert" className={styles.error}>{t('error')}</p>}
    </>} confirmLabel={t('confirm')} cancelLabel={t('cancel')} busyLabel={t('busy')}
    onConfirm={confirm} onClose={dismiss} busy={busy} focusable lang={language}
    descriptionId={descriptionId} panelClassName={styles.panel} />
  </div>;
}
