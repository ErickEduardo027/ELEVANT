import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExpenseLocaleProvider } from './ExpenseLocale';
import { DocumentEditor } from './PayablesUi';

vi.mock('../../../i18n/LanguageScope', () => ({ useTranslation: () => ({ language: 'en' }) }));
const options = { stations: [{ id: 'station', code: 'QA', name: 'QA station' }], airlines: [], turnarounds: [], services: [] };

describe('OCC expense localization boundary', () => {
  it('keeps the default shared form copy outside the opt-in provider', () => {
    render(<DocumentEditor expense scope="station" options={options} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Concepto del gasto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Expense description')).not.toBeInTheDocument();
  });

  it('localizes controls while preserving authored values and the save contract', () => {
    const onSave = vi.fn();
    render(<ExpenseLocaleProvider enabled><DocumentEditor expense scope="station" options={options} onSave={onSave} onCancel={vi.fn()} /></ExpenseLocaleProvider>);
    fireEvent.change(screen.getByLabelText('Expense description'), { target: { value: 'Mis gastos' } });
    fireEvent.change(screen.getByLabelText('Expense date'), { target: { value: '2026-10-29' } });
    fireEvent.change(screen.getByLabelText('DOP rate'), { target: { value: '58.1' } });
    fireEvent.change(screen.getByLabelText('Rate source'), { target: { value: 'Fuente revisada QA' } });
    fireEvent.change(screen.getByLabelText('Line description 1'), { target: { value: 'Cantidad' } });
    fireEvent.change(screen.getByLabelText('Unit price for line 1'), { target: { value: '12' } });
    expect(screen.getByLabelText('Expense description')).toHaveValue('Mis gastos');
    fireEvent.submit(screen.getByRole('form', { name: 'Expense draft' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      scopeStationId: 'station', description: 'Mis gastos', expenseDate: '2026-10-29',
      fx: expect.objectContaining({ currency: 'USD', rateToDop: 58.1, source: 'Fuente revisada QA' }),
      dimensions: { stationId: null, airlineId: null, turnaroundId: null, serviceId: null },
      lines: [{ description: 'Cantidad', quantity: 1, unitPrice: 12, taxAmount: 0 }], expectedVersion: null,
    }));
  });
});
