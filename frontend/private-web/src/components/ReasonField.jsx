import { useId } from 'react';

/** Bounds the server applies to the reason of a discard or a lifecycle action, after trimming. */
export const REASON_MIN_LENGTH = 5;
export const REASON_MAX_LENGTH = 500;

/** The reason is within the bounds the server accepts. */
export const validReason = value => {
  const length = value.trim().length;
  return length >= REASON_MIN_LENGTH && length <= REASON_MAX_LENGTH;
};

/**
 * Reason of a command the server bounds (5 to 500 characters). The field says the bounds and how many
 * characters are still missing, linked with aria-describedby, so a disabled confirmation is never silent.
 */
export default function ReasonField({ value, onChange, label = 'Motivo', hint = 'Queda en el historial del contrato.' }) {
  const id = useId();
  const helpId = `${id}-help`;
  const length = value.trim().length;
  const missing = Math.max(REASON_MIN_LENGTH - length, 0);
  return <div>
    <label htmlFor={id} className="block text-xs font-semibold">{label}</label>
    <textarea id={id} rows={3} maxLength={REASON_MAX_LENGTH} value={value} aria-describedby={helpId}
      onChange={event => onChange(event.target.value)} className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark" />
    <p id={helpId} className="mt-1 text-xs text-text-secondary-light">
      Entre {REASON_MIN_LENGTH} y {REASON_MAX_LENGTH} caracteres. {hint}{' '}
      <span className={missing > 0 ? 'font-semibold text-status-warning' : ''}>
        {missing > 0 ? `Faltan ${missing} ${missing === 1 ? 'carácter' : 'caracteres'}.` : `${length} de ${REASON_MAX_LENGTH}.`}
      </span>
    </p>
  </div>;
}
