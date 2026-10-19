import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi, expect, it } from 'vitest';
import PreinvoiceReviewPanel from './PreinvoiceReviewPanel';
import { getPreinvoiceCalculations, cancelDraft } from '../../../services/financePreinvoiceReviewService';
vi.mock('../../../services/financePreinvoiceReviewService', () => ({ getPreinvoiceCalculations: vi.fn(), cancelDraft: vi.fn(), restoreDraftCalculation: vi.fn() }));
it('shows stored calculation and cancels only with version and reason', async () => {
 getPreinvoiceCalculations.mockResolvedValue([{ lineId:'l1',kind:'Excess',description:'GPU',steps:[{label:'Bloques',value:2,unit:'block'}] }]);
 cancelDraft.mockResolvedValue({id:'p1'}); const onChanged=vi.fn();
 render(<PreinvoiceReviewPanel preinvoice={{id:'p1',version:'v1',status:'Draft'}} canManage onChanged={onChanged} />);
 fireEvent.click(screen.getByText('Ver cálculo de origen'));
 expect(await screen.findByText('Bloques')).toBeInTheDocument();
 fireEvent.click(screen.getByText('Anular borrador'));
 fireEvent.change(screen.getByLabelText('Motivo'),{target:{value:'Agrupación incorrecta'}});
 fireEvent.submit(screen.getByRole('button',{name:'Confirmar anulación'}).closest('form'));
 await waitFor(()=>expect(cancelDraft).toHaveBeenCalledWith('p1', expect.objectContaining({expectedVersion:'v1',reason:'Agrupación incorrecta',requestId:expect.any(String)})));
 expect(onChanged).toHaveBeenCalled();
});
