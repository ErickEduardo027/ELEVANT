import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { commercialApi } from '../../../services/commercialGovernanceApi';
import FiscalXmlValidationPanel from './FiscalXmlValidationPanel';

vi.mock('../../../services/commercialGovernanceApi', () => ({ commercialApi: vi.fn() }));
const result = {
  schemaId: 'DGII.ECF.E31', schemaVersion: '1.0', schemaSha256: 'a'.repeat(64), schemaValidation: 'Passed',
  isStructurallyValid: false, signatureElementPresent: false,
  structuralErrors: [{ code: 'SignatureMissing', message: 'Required XMLDSig is absent.', lineNumber: 0, linePosition: 0 }],
  cryptographicValidation: 'NotPerformed', fiscalAcceptance: 'NotPerformed',
};
function mount(permissions = ['finance.fiscal.read']) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Member', department: 'finance', permissions }}>
    <FiscalXmlValidationPanel />
  </DepartmentAccessProvider>);
}
beforeEach(() => { commercialApi.mockReset(); commercialApi.mockResolvedValue(result); });
afterEach(cleanup);

describe('separate offline XML preflight panel', () => {
  it('denies access without read permission and never requests data on mount', () => {
    mount([]);
    expect(screen.getByRole('alert')).toHaveTextContent('permiso');
    expect(screen.queryByRole('textbox', { name: 'XML UTF-8' })).not.toBeInTheDocument();
    expect(commercialApi).not.toHaveBeenCalled();
  });

  it('submits pasted XML explicitly and distinguishes XSD from missing signature and acceptance', async () => {
    mount();
    expect(commercialApi).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox', { name: 'XML UTF-8' }), '<ECF/>');
    await userEvent.click(screen.getByRole('button', { name: 'Validar estructura' }));
    await screen.findByText('DGII.ECF.E31');
    const call = commercialApi.mock.calls[0];
    expect(call[0]).toBe('/finance/fiscal-xml/validate');
    expect(JSON.parse(call[1].body)).toEqual({ documentType: 'E31', xmlUtf8: '<ECF/>' });
    expect(screen.getByText('Cumple XSD')).toBeInTheDocument();
    expect(screen.getByText('Preflight con errores')).toBeInTheDocument();
    expect(screen.getByText('Firma: ausente')).toBeInTheDocument();
    expect(screen.getByText('Criptografía: no realizada')).toBeInTheDocument();
    expect(screen.getByText('Aceptación fiscal: no realizada')).toBeInTheDocument();
    expect(screen.getByText(/SignatureMissing/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Emitir|Firmar|Enviar a DGII/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Tipo de e-CF'), 'E34');
    expect(screen.queryByText('DGII.ECF.E31')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Validar estructura' }));
    await waitFor(() => expect(JSON.parse(commercialApi.mock.calls[1][1].body).documentType).toBe('E34'));
  });

  it('reads a local UTF-8 file without sending it until validation is requested', async () => {
    mount();
    const bytes = new TextEncoder().encode(' <ECF>á</ECF>\r\n');
    const file = new File([bytes], 'synthetic.xml', { type: 'application/xml' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    await userEvent.upload(screen.getByLabelText('Archivo XML UTF-8'), file);
    await screen.findByText('synthetic.xml');
    expect(commercialApi).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Validar estructura' }));
    await waitFor(() => expect(commercialApi).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(commercialApi.mock.calls[0][1].body);
    expect(sent.xmlUtf8).toBeUndefined();
    expect(Array.from(atob(sent.xmlBase64), c => c.charCodeAt(0))).toEqual(Array.from(bytes));
  });

  it('rejects oversized and non-UTF-8 files locally', async () => {
    mount();
    const oversized = new File(['x'], 'oversized.xml', { type: 'application/xml' });
    Object.defineProperty(oversized, 'size', { value: 2 * 1024 * 1024 + 1 });
    await userEvent.upload(screen.getByLabelText('Archivo XML UTF-8'), oversized);
    expect(await screen.findByRole('alert')).toHaveTextContent('2 MiB');
    const invalid = new File([new Uint8Array([255])], 'invalid.xml', { type: 'application/xml' });
    Object.defineProperty(invalid, 'arrayBuffer', { value: async () => new Uint8Array([255]).buffer });
    await userEvent.upload(screen.getByLabelText('Archivo XML UTF-8'), invalid);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('UTF-8'));
    expect(commercialApi).not.toHaveBeenCalled();
  });

  it('bounds multibyte pasted XML and keeps transport errors safe and retryable', async () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'XML UTF-8' }), { target: { value: 'é'.repeat(1024 * 1024 + 1) } });
    await userEvent.click(screen.getByRole('button', { name: 'Validar estructura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('2 MiB');
    expect(commercialApi).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'XML UTF-8' }), { target: { value: '<ECF/>' } });
    commercialApi.mockRejectedValueOnce(Object.assign(new Error('PRIVATE XML'), { status: 403 }));
    await userEvent.click(screen.getByRole('button', { name: 'Validar estructura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('permiso');
    expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE XML');
    await userEvent.click(screen.getByRole('button', { name: 'Validar estructura' }));
    await screen.findByText('DGII.ECF.E31');
  });

  it('clears input, file data and prior results explicitly', async () => {
    mount();
    await userEvent.type(screen.getByRole('textbox', { name: 'XML UTF-8' }), '<ECF/>');
    await userEvent.click(screen.getByRole('button', { name: 'Validar estructura' }));
    await screen.findByText('DGII.ECF.E31');
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(screen.getByRole('textbox', { name: 'XML UTF-8' })).toHaveValue('');
    expect(screen.queryByText('DGII.ECF.E31')).not.toBeInTheDocument();
  });

  it('does not describe a present signature element as a verified signature', async () => {
    commercialApi.mockResolvedValue({ ...result, isStructurallyValid: true, signatureElementPresent: true, structuralErrors: [] });
    mount();
    await userEvent.type(screen.getByRole('textbox', { name: 'XML UTF-8' }), '<ECF/>');
    await userEvent.click(screen.getByRole('button', { name: 'Validar estructura' }));
    await screen.findByText('Estructura conforme');
    expect(screen.getByText('Firma: presente, sin verificar')).toBeInTheDocument();
    expect(screen.getByText('Criptografía: no realizada')).toBeInTheDocument();
    expect(screen.getByText('Aceptación fiscal: no realizada')).toBeInTheDocument();
  });
});
