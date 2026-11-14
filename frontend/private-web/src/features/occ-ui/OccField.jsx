'use client';

import { useId } from 'react';

/** The controls a field can hold: a one-line input, a list to choose from, or a text of several lines. */
export const OCC_CONTROL_KINDS = Object.freeze(['input', 'select', 'textarea']);

// The well of a control (design A.1 and H.2): the field token inside a strong joint, plain text and a faint
// placeholder, on the 4 px control radius. A one-line control is 32 px high, 44 px on a touch screen; a text of several
// lines grows with its rows. An invalid control keeps the red joint of the OCC, also outside the legacy bridge.
const CONTROL = 'min-w-0 rounded border border-occ-line-strong bg-occ-field px-2 text-sm text-occ-text '
  + 'placeholder:text-occ-faint disabled:cursor-not-allowed disabled:border-occ-line disabled:text-occ-faint '
  + 'aria-[invalid=true]:border-occ-danger';
const ONE_LINE = 'h-8 [@media(pointer:coarse)]:h-11';
const MULTI_LINE = 'py-1.5';

/**
 * The classes of an OCC control of a `kind` (`input`, `select` or `textarea`), for a control that is not inside an
 * OccField, such as the inline edit rows of a register. It sets no width: a field stretches it, a row gives it one.
 * An unknown kind throws.
 */
export function occControlClass({ kind = 'input' } = {}) {
  if (!OCC_CONTROL_KINDS.includes(kind)) throw new RangeError(`Unknown OCC control kind: ${String(kind)}`);
  return `${CONTROL} ${kind === 'textarea' ? MULTI_LINE : ONE_LINE}`;
}

const joinIds = (...ids) => ids.filter(Boolean).join(' ') || undefined;

/**
 * A form field of the OCC (design F): its label, its control, an optional hint and an optional error.
 * - The label is a `label` for the control with exactly the text given: no asterisk and no «(obligatorio)», since
 *   tests and the cycle E2E find controls by their exact name. A required control says so with `required`.
 * - `children(control)` draws the control: `control` is `{ id, 'aria-describedby', 'aria-invalid' }`, to spread on
 *   it. `id` is the caller's or a generated one.
 * - `hint` is secondary text under the control, and describes it.
 * - `error` is a `form-validation-message` with `role="alert"`, as the system's own validation messages are
 *   (src/components/formValidation.js): it describes the control and marks it `aria-invalid`.
 * `className` goes on the field.
 */
export default function OccField({ id, label, hint, error, className = '', children }) {
  const generated = useId();
  const controlId = id ?? `occ-field${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const control = { id: controlId, 'aria-describedby': joinIds(hintId, errorId), 'aria-invalid': error ? true : undefined };
  return (
    <div data-occ-field="" className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={controlId} className="text-xs font-medium text-occ-muted">{label}</label>
      {children(control)}
      {hint ? <p id={hintId} className="text-xs text-occ-muted">{hint}</p> : null}
      {error ? <p id={errorId} role="alert" className="form-validation-message">{error}</p> : null}
    </div>
  );
}

// The props a helper keeps for the field; everything else belongs to its control. A caller's own description is
// kept next to the field's.
function controlProps(field, { controlClassName = '', 'aria-describedby': describedBy, ...props }, kind) {
  return {
    ...props,
    ...field,
    'aria-describedby': joinIds(field['aria-describedby'], describedBy),
    'aria-invalid': field['aria-invalid'] ?? props['aria-invalid'],
    className: `${occControlClass({ kind })} ${controlClassName}`,
  };
}

/** A one-line field: every prop but `label`, `hint`, `error`, `id` and `className` reaches its `input`. */
export function OccTextField({ id, label, hint, error, className, type = 'text', ...props }) {
  return (
    <OccField id={id} label={label} hint={hint} error={error} className={className}>
      {field => <input type={type} {...controlProps(field, props, 'input')} />}
    </OccField>
  );
}

/** A field to choose from a list: its `option` children and every other prop reach its `select`. */
export function OccSelectField({ id, label, hint, error, className, children, ...props }) {
  return (
    <OccField id={id} label={label} hint={hint} error={error} className={className}>
      {field => <select {...controlProps(field, props, 'select')}>{children}</select>}
    </OccField>
  );
}

/** A field of several lines (three by default): every other prop reaches its `textarea`. */
export function OccTextareaField({ id, label, hint, error, className, rows = 3, ...props }) {
  return (
    <OccField id={id} label={label} hint={hint} error={error} className={className}>
      {field => <textarea rows={rows} {...controlProps(field, props, 'textarea')} />}
    </OccField>
  );
}
