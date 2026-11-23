import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  applyRule, installFormValidation, trimmedLengthProblem, validationMessageFor, withRule,
} from './formValidation';

let uninstall;
beforeEach(() => { uninstall = installFormValidation(document); });
afterEach(() => { uninstall(); document.body.innerHTML = ''; });

function render(html) {
  document.body.innerHTML = html;
  return document.querySelector('form');
}

it('replaces the native bubble with an inline Spanish message and focuses the first error', () => {
  const form = render(`<form>
    <input id="name" required>
    <input id="mail" type="email" value="no-es-correo">
    <button>Guardar</button></form>`);
  const event = new Event('invalid', { cancelable: true });
  const name = document.getElementById('name');
  name.dispatchEvent(event);
  document.getElementById('mail').dispatchEvent(new Event('invalid', { cancelable: true }));

  expect(event.defaultPrevented).toBe(true);
  expect(form.checkValidity()).toBe(false);
  const message = document.getElementById(name.getAttribute('aria-describedby'));
  expect(message).toHaveTextContent('Complete este campo.');
  expect(message).toHaveAttribute('role', 'alert');
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(document.activeElement).toBe(name);
  expect(document.body).toHaveTextContent('Ingrese un correo válido, p. ej. nombre@empresa.com.');
});

it('clears the message once the field becomes valid', () => {
  render('<form><input id="name" required></form>');
  const name = document.getElementById('name');
  name.dispatchEvent(new Event('invalid', { cancelable: true }));
  name.value = 'Ana';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  expect(name).not.toHaveAttribute('aria-invalid');
  expect(document.querySelector('.form-validation-message')).toBeNull();
});

it('uses the field text for patterns and explains lengths and ranges', () => {
  render(`<form>
    <input id="code" pattern="[A-Z]{3}" value="ab" data-error="Use tres letras mayúsculas.">
    <input id="date" type="date" min="2026-10-01" value="2026-09-01">
    <select id="pick" required><option value="">--</option></select></form>`);
  expect(validationMessageFor(document.getElementById('code'))).toBe('Use tres letras mayúsculas.');
  expect(validationMessageFor(document.getElementById('date'))).toBe('La fecha debe ser el 01/10/2026 o posterior.');
  expect(validationMessageFor(document.getElementById('pick'))).toBe('Seleccione una opción de la lista.');
});

it('keeps a message already on screen in step with a rule the form computes itself', () => {
  render('<form><input id="end" type="date"></form>');
  const end = document.getElementById('end');
  applyRule(end, 'El vencimiento debe ser igual o posterior a la obtención (03/01/2026).');
  end.dispatchEvent(new Event('invalid', { cancelable: true }));
  expect(document.getElementById(end.getAttribute('aria-describedby')))
    .toHaveTextContent('El vencimiento debe ser igual o posterior a la obtención (03/01/2026).');
  // The re-render that brings the new rule clears the message the edit left behind.
  withRule('')(end);
  expect(end.validity.valid).toBe(true);
  expect(end).not.toHaveAttribute('aria-invalid');
  expect(document.querySelector('.form-validation-message')).toBeNull();
});

it('counts a bounded text after trimming and leaves an empty one to required', () => {
  expect(trimmedLengthProblem('', 3, 500)).toBe('');
  expect(trimmedLengthProblem('  ab  ', 3, 500)).toBe('Escribe al menos 3 caracteres sin contar los espacios de los extremos (ahora tiene 2).');
  expect(trimmedLengthProblem(' abc ', 3, 500)).toBe('');
  expect(trimmedLengthProblem('x'.repeat(501), 3, 500)).toBe('Usa como máximo 500 caracteres (ahora tiene 501).');
});

it('leaves forms that opt out untouched', () => {
  render('<form data-native-validation><input id="name" required></form>');
  const event = new Event('invalid', { cancelable: true });
  document.getElementById('name').dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
