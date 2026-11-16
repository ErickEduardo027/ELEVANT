import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { XIcon } from '../features/shell/components/icons';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useTranslation } from '../i18n/LanguageScope';
import { commonMessages } from '../i18n/commonMessages';

// Drawer lateral genérico, generalizado a partir del patrón repetido en
// `feat/adminocc` (overlay + <aside role="dialog"> deslizante). Permanece
// montado incluso cerrado para animar la salida; el contenido debe manejar
// sus propios datos ausentes cuando `open` es falso.
export default function Drawer({ open, onClose, title, description, widthClassName = 'lg:w-[480px]', children, footer }) {
  useEscapeToClose(open, onClose);
  const dialogRef = useDialogFocus(open);
  const { t } = useTranslation(commonMessages);

  return (
    <div className={`fixed inset-0 z-drawer ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <aside
        ref={dialogRef}
        inert={!open}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute inset-y-0 right-0 flex w-full flex-col border-l sm:w-[min(90vw,30rem)] border-black/5 bg-white shadow-2xl transition-transform duration-200 ease-in-out dark:border-white/5 dark:bg-surface-dark-card ${widthClassName} ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-4 py-4 dark:border-white/5 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-900 dark:text-text-primary-dark">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="shrink-0 rounded-lg p-1.5 text-text-secondary-light hover:bg-black/5 hover:text-ink-900 dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        {footer && <div className="border-t border-black/5 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-white/5 sm:px-6">{footer}</div>}
      </aside>
    </div>
  );
}
