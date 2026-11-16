// Replaces the browser's native validation bubbles with the system's own inline messages.
// Constraint validation still blocks submission; only its presentation changes. A form may
// opt out with data-native-validation, and a field may give its own text with data-error.

const MESSAGE_CLASS = 'form-validation-message';

function formatDate(value: string) {
  const [year, month, day] = String(value).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/** Spanish message for a field that failed constraint validation. */
export function validationMessageFor(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const { validity } = field;
  const type = (field.type || '').toLowerCase();
  const input = field as HTMLInputElement;
  const custom = field.dataset?.error;
  if (validity.customError) return field.validationMessage;
  if (validity.valueMissing) {
    if (type === 'checkbox') return custom || 'Marque esta casilla para continuar.';
    if (type === 'radio') return custom || 'Elija una de las opciones.';
    if (field.tagName === 'SELECT') return custom || 'Seleccione una opción de la lista.';
    if (type === 'file') return custom || 'Adjunte el archivo solicitado.';
    return custom || 'Complete este campo.';
  }
  if (validity.typeMismatch) {
    if (type === 'email') return custom || 'Ingrese un correo válido, p. ej. nombre@empresa.com.';
    if (type === 'url') return custom || 'Ingrese una dirección web válida que empiece por https://.';
    return custom || 'El valor no tiene el formato esperado.';
  }
  if (validity.patternMismatch) return custom || input.title || 'El valor no tiene el formato esperado.';
  if (validity.tooShort) return `Use al menos ${input.minLength} caracteres (ahora tiene ${field.value.length}).`;
  if (validity.tooLong) return `Use como máximo ${input.maxLength} caracteres.`;
  if (validity.rangeUnderflow)
    return type === 'date' ? `La fecha debe ser el ${formatDate(input.min)} o posterior.` : `El valor mínimo es ${input.min}.`;
  if (validity.rangeOverflow)
    return type === 'date' ? `La fecha debe ser el ${formatDate(input.max)} o anterior.` : `El valor máximo es ${input.max}.`;
  if (validity.stepMismatch) return `Use un valor en incrementos de ${input.step}.`;
  if (validity.badInput)
    return type === 'number' ? 'Ingrese un número válido.' : type === 'date' ? 'Ingrese una fecha válida.' : 'El valor no es válido.';
  return field.validationMessage || 'Revise este campo.';
}

let sequence = 0;

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function messageId(field: Field) {
  if (!field.dataset.validationId) {
    sequence += 1;
    field.dataset.validationId = `field-validation-${sequence}`;
  }
  return field.dataset.validationId;
}

function show(field: Field) {
  const id = messageId(field);
  let message = field.ownerDocument.getElementById(id);
  if (!message) {
    message = field.ownerDocument.createElement('p');
    message.id = id;
    message.className = MESSAGE_CLASS;
    message.setAttribute('role', 'alert');
    message.dataset.validationFor = id;
    field.insertAdjacentElement('afterend', message);
  }
  message.textContent = validationMessageFor(field);
  field.setAttribute('aria-invalid', 'true');
  const describedBy = new Set((field.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
  describedBy.add(id);
  field.setAttribute('aria-describedby', [...describedBy].join(' '));
}

function clear(field: Field) {
  const id = field.dataset?.validationId;
  if (!id) return;
  field.ownerDocument.getElementById(id)?.remove();
  if (field.getAttribute('aria-invalid') === 'true') field.removeAttribute('aria-invalid');
  const describedBy = (field.getAttribute('aria-describedby') || '').split(' ').filter(item => item && item !== id);
  if (describedBy.length) field.setAttribute('aria-describedby', describedBy.join(' '));
  else field.removeAttribute('aria-describedby');
}

const optedOut = (field: Element) => Boolean(field.closest('[data-native-validation]'));

/** Installs the handlers on a document; returns a function that removes them. */
export function installFormValidation(doc: Document = document): () => void {
  let focusedThisRound = false;

  const view = doc.defaultView!;

  function onInvalid(event: Event) {
    const field = event.target as Field;
    if (!(field instanceof view.HTMLElement) || optedOut(field)) return;
    event.preventDefault();
    show(field);
    if (!focusedThisRound) {
      focusedThisRound = true;
      field.focus({ preventScroll: false });
      view.setTimeout(() => { focusedThisRound = false; }, 0);
    }
  }

  function onEdit(event: Event) {
    const field = event.target as Field | null;
    if (!field?.dataset?.validationId) return;
    if (field.validity?.valid) clear(field);
    else if (doc.getElementById(field.dataset.validationId)) show(field);
  }

  function onReset(event: Event) {
    (event.target as HTMLFormElement).querySelectorAll<Field>('[data-validation-id]').forEach(clear);
  }

  // A message whose field left the page (closed drawer, re-render) must not linger.
  const observer = new view.MutationObserver(() => {
    doc.querySelectorAll(`.${MESSAGE_CLASS}`).forEach(message => {
      const field = doc.querySelector(`[data-validation-id="${message.id}"]`);
      if (!field || !field.isConnected) message.remove();
    });
  });

  doc.addEventListener('invalid', onInvalid, true);
  doc.addEventListener('input', onEdit, true);
  doc.addEventListener('change', onEdit, true);
  doc.addEventListener('reset', onReset, true);
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => {
    doc.removeEventListener('invalid', onInvalid, true);
    doc.removeEventListener('input', onEdit, true);
    doc.removeEventListener('change', onEdit, true);
    doc.removeEventListener('reset', onReset, true);
    observer.disconnect();
  };
}
