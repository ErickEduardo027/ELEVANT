import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetReconciliationsForTests } from '../../../services/reconciliationService';
import ReconciliationPage from './ReconciliationPage';
afterEach(resetReconciliationsForTests);
describe('ReconciliationPage', () => { it('requires a note and reconciles a difference', async () => { render(<ReconciliationPage />); await screen.findByText('CON-2026-026'); fireEvent.change(screen.getByLabelText('Nota CON-2026-026'), { target: { value: 'Ajuste aprobado' } }); fireEvent.click(screen.getAllByRole('button', { name: 'Conciliar' })[0]); expect(await screen.findByText('Diferencia conciliada y registrada.')).toBeInTheDocument(); }); });
