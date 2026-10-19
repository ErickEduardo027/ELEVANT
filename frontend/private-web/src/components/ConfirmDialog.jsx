import Modal from './Modal';
import { useTranslation } from '../i18n/LanguageScope';
import { commonMessages } from '../i18n/commonMessages';

export default function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onClose, busy = false }) {
  const { t } = useTranslation(commonMessages);
  return <Modal open={open} onClose={busy ? () => {} : onClose} title={title} tone="danger" footer={<>
    <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold dark:border-white/15">{t('cancel')}</button>
    <button type="button" disabled={busy} onClick={onConfirm} className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? t('processing') : confirmLabel ?? t('confirm')}</button>
  </>}>{description}</Modal>;
}
