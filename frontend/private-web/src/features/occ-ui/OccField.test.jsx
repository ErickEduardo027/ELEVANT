import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findLegacyColourClasses } from '../../styles/occLegacyBridge';
import OccField, {
  OCC_CONTROL_KINDS, OccSelectField, OccTextField, OccTextareaField, occControlClass,
} from './OccField';

afterEach(cleanup);

const classesOf = element => element.className.split(/\s+/).filter(Boolean);
const describedBy = element => (element.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
  .map(id => document.getElementById(id)?.textContent);

describe('OccField', () => {
  it('names the control by its exact label and describes it with its hint', () => {
    render(<>
      <OccField label="Agente" hint="Solo los agentes con turno en la terminal." className="w-64">
        {control => <select {...control} required><option value="">Elige un agente</option></select>}
      </OccField>
      <OccField id="coverage-vehicle" label="Vehículo">
        {control => <input {...control} />}
      </OccField>
    </>);
    // The label is the name, word for word: no asterisk and no «(obligatorio)», even on a required control.
    const agent = screen.getByRole('combobox', { name: 'Agente' });
    expect(agent).toBeRequired();
    expect(screen.getByText('Agente').tagName).toBe('LABEL');
    expect(screen.getByText('Agente').textContent).toBe('Agente');
    expect(describedBy(agent)).toEqual(['Solo los agentes con turno en la terminal.']);
    expect(agent).not.toHaveAttribute('aria-invalid');
    const field = agent.closest('[data-occ-field]');
    expect(classesOf(field).at(-1)).toBe('w-64');
    expect(screen.getByText('Solo los agentes con turno en la terminal.')).toHaveClass('text-occ-muted');

    // The caller's id is kept; without a hint the control is not described.
    const vehicle = screen.getByLabelText('Vehículo');
    expect(vehicle).toHaveAttribute('id', 'coverage-vehicle');
    expect(vehicle).not.toHaveAttribute('aria-describedby');
    // Two fields never share a generated id.
    expect(agent.id).not.toBe('');
    expect(agent.id).not.toBe(vehicle.id);
  });

  it('an error is a form-validation-message alert and marks the control invalid', () => {
    const { rerender } = render(
      <OccField label="Motivo" hint="Queda en la auditoría." error="Escribe al menos 8 caracteres.">
        {control => <textarea {...control} />}
      </OccField>,
    );
    const reason = screen.getByRole('textbox', { name: 'Motivo' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Escribe al menos 8 caracteres.');
    expect(alert).toHaveClass('form-validation-message');
    expect(alert.tagName).toBe('P');
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    // The hint and the error both describe the control, the hint first.
    expect(describedBy(reason)).toEqual(['Queda en la auditoría.', 'Escribe al menos 8 caracteres.']);
    expect(reason).toHaveAccessibleDescription('Queda en la auditoría. Escribe al menos 8 caracteres.');

    // Fixed, the control is valid again and the message is gone.
    rerender(
      <OccField label="Motivo" hint="Queda en la auditoría.">{control => <textarea {...control} />}</OccField>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(reason).not.toHaveAttribute('aria-invalid');
    expect(describedBy(reason)).toEqual(['Queda en la auditoría.']);
  });

  it('the text, select and textarea helpers forward value, onChange and constraints', async () => {
    const onSelect = vi.fn();
    function Form() {
      const [code, setCode] = useState('');
      return (
        <form aria-label="Nueva terminal">
          <OccTextField label="Código" value={code} onChange={event => setCode(event.target.value)} required maxLength={16}
            placeholder="C" controlClassName="w-28 font-mono" className="w-40" aria-describedby="external-note" />
          <OccSelectField label="Tamaño máximo" value="" onChange={event => onSelect(event.target.value)}
            error="Elige un tamaño.">
            <option value="">Sin límite</option>
            <option value="Narrowbody">Fuselaje estrecho</option>
          </OccSelectField>
          <OccTextareaField label="Motivo" defaultValue="" minLength={8} maxLength={2000} disabled />
          <OccTextField label="Fecha" type="date" defaultValue="2026-11-14" />
          <p id="external-note">Nota de la pantalla.</p>
        </form>
      );
    }
    render(<Form />);
    const code = screen.getByRole('textbox', { name: 'Código' });
    await userEvent.type(code, 'C2');
    expect(code).toHaveValue('C2');
    expect(code).toBeRequired();
    expect(code).toHaveAttribute('maxlength', '16');
    expect(code).toHaveAttribute('placeholder', 'C');
    expect(code).toHaveAttribute('type', 'text');
    // The control takes the well and the caller's classes; the field takes className.
    expect(classesOf(code)).toEqual(expect.arrayContaining([...occControlClass().split(' '), 'w-28', 'font-mono']));
    expect(classesOf(code.closest('[data-occ-field]')).at(-1)).toBe('w-40');
    // A description of the caller's own stays next to the field's.
    expect(describedBy(code)).toEqual(['Nota de la pantalla.']);

    const size = screen.getByRole('combobox', { name: 'Tamaño máximo' });
    fireEvent.change(size, { target: { value: 'Narrowbody' } });
    expect(onSelect).toHaveBeenCalledWith('Narrowbody');
    expect(size).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Sin límite', 'Fuselaje estrecho']);

    const reason = screen.getByRole('textbox', { name: 'Motivo' });
    expect(reason.tagName).toBe('TEXTAREA');
    expect(reason).toBeDisabled();
    expect(reason).toHaveAttribute('rows', '3');
    expect(reason).toHaveAttribute('minlength', '8');
    expect(classesOf(reason)).toEqual(expect.arrayContaining(occControlClass({ kind: 'textarea' }).split(' ')));
    expect(screen.getByLabelText('Fecha')).toHaveAttribute('type', 'date');
  });

  it('draws the control well on occ tokens, 32 px high and 44 px on a touch screen, and refuses an unknown kind', () => {
    expect(OCC_CONTROL_KINDS).toEqual(['input', 'select', 'textarea']);
    for (const kind of OCC_CONTROL_KINDS) {
      const classes = occControlClass({ kind }).split(' ');
      expect(classes, kind).toEqual(expect.arrayContaining(['rounded', 'border-occ-line-strong', 'bg-occ-field',
        'text-occ-text', 'placeholder:text-occ-faint', 'aria-[invalid=true]:border-occ-danger']));
      expect(classes.includes('h-8') && classes.includes('[@media(pointer:coarse)]:h-11'), kind).toBe(kind !== 'textarea');
      expect(findLegacyColourClasses(classes.join(' ')), kind).toEqual([]);
    }
    expect(() => occControlClass({ kind: 'checkbox' })).toThrow(RangeError);
  });
});
