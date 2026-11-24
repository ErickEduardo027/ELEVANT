import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractDetailDrawer, { validityLines } from './ContractDetailDrawer';
import {
  createContractAmendment, getContractDocument, getContractTimeline, loadContractPdf, setContractValidity, signContractVersion,
  withdrawContractVersion,
} from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getContractDocument: vi.fn(), loadContractPdf: vi.fn(), signContractVersion: vi.fn(), setContractValidity: vi.fn(),
  getContractTimeline: vi.fn().mockResolvedValue({ contractId: 'c-1', contractCode: 'CT-001', status: 'Active', entries: [] }),
  applyContractLifecycle: vi.fn(), createContractAmendment: vi.fn(), withdrawContractVersion: vi.fn(),
}));

const sha = 'b'.repeat(64);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const validity = { renewalMode: 'Automatic', renewalTermMonths: 12, renewalNoticeDays: 30, terminationNoticeDays: 60,
  terminationTerms: 'Incumplimiento grave.', confirmedAt: '2026-11-03T12:00:00Z' };
const airlineSignature = { party: 'Airline', signerName: 'Luis Marte', signerTitle: 'Director', signedAt: '2026-11-03T13:00:00Z',
  documentSha256: sha, hasDrawnSignature: true };
const document = { contractId: 'c-1', versionId: 'v-1', contractCode: 'CTR-2026-0001', contractStatus: 'Draft', airlineName: 'Demo Air',
  airlineCode: 'DM', airlineLegalName: 'Demo Air S.A.', versionNumber: 2, versionStatus: 'Approved', validFrom: '2026-11-03',
  validTo: '2027-11-02', currencyCode: 'USD', stations: ['PUJ · Punta Cana'], terms: 'Pago a 30 días.', signedOn: null,
  rates: [{ serviceCode: 'RAMP', serviceName: 'Rampa', billingUnit: 'operación', unitPrice: 150, minimumQuantity: 1 }],
  signatures: [airlineSignature], contentSha256: sha, signableBy: 'Aviam', validity };

beforeEach(() => {
  getContractDocument.mockResolvedValue(document);
  loadContractPdf.mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' }));
  URL.createObjectURL = vi.fn(() => 'blob:contract');
  URL.revokeObjectURL = vi.fn();
  // jsdom has no canvas: a minimal 2D context lets the signature pad record strokes.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn() }));
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => png);
  signContractVersion.mockResolvedValue({ ...document, signableBy: null, signedOn: '2026-11-03', signatures: [airlineSignature,
    { party: 'Aviam', signerName: 'Ana Pérez', signerTitle: 'Gerente comercial', signedAt: '2026-11-03T14:00:00Z',
      documentSha256: sha, hasDrawnSignature: true }] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function draw(name = 'Firma') {
  const pad = screen.getByRole('img', { name });
  fireEvent.pointerDown(pad, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 60, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(pad, { pointerId: 1 });
}

it('shows the formal content and validity, and countersigns for AVIAM with a drawn signature', async () => {
  const onSigned = vi.fn();
  render(<ContractDetailDrawer versionId="v-1" canSign onClose={vi.fn()} onSigned={onSigned} />);
  const drawer = await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' });
  expect(drawer).toHaveTextContent('Demo Air S.A. (DM)');
  expect(drawer).toHaveTextContent('Renovación automática por 12 meses');
  expect(drawer).toHaveTextContent('Terminación con 60 días de preaviso. Incumplimiento grave.');
  expect(drawer).toHaveTextContent(`Huella SHA-256: ${sha}`);
  const signatures = within(screen.getByRole('region', { name: 'Firmas' }));
  expect(signatures.getByText(/firma dibujada/)).toBeInTheDocument();
  expect(signatures.getByText('Contrafirma después de la aerolínea')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(loadContractPdf).toHaveBeenCalledWith('v-1', { draft: false });

  await userEvent.type(screen.getByLabelText('Nombre completo'), 'Ana Pérez');
  await userEvent.type(screen.getByLabelText('Cargo'), 'Gerente comercial');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Acepto y firmo' }));
  expect(screen.getByRole('alert')).toHaveTextContent('dibuja tu firma');
  expect(signContractVersion).not.toHaveBeenCalled();
  draw();
  await userEvent.click(screen.getByRole('button', { name: 'Acepto y firmo' }));
  expect(signContractVersion).toHaveBeenCalledWith('v-1', { signerName: 'Ana Pérez', signerTitle: 'Gerente comercial',
    accepted: true, signatureImagePng: png, documentSha256: sha }, expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(await screen.findByText('Ana Pérez · Gerente comercial')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Acepto y firmo' })).not.toBeInTheDocument();
  expect(onSigned).toHaveBeenCalled();
});

it('lets Contratos confirm validity and renewal before any signature', async () => {
  const unconfirmed = { ...document, contractCode: 'DRAFT-1', validity: null, signatures: [], signableBy: null };
  getContractDocument.mockResolvedValueOnce(unconfirmed);
  setContractValidity.mockResolvedValue({ ...unconfirmed, contractCode: 'CTR-2026-0001', validity, signableBy: null });
  render(<ContractDetailDrawer versionId="v-1" canSign canSetValidity onClose={vi.fn()} />);
  const form = await screen.findByRole('form', { name: 'Vigencia y renovación' });
  expect(screen.getByText(/Pendiente: Contratos debe fijar la vigencia/)).toBeInTheDocument();
  await userEvent.selectOptions(within(form).getByLabelText('Renovación'), 'Automatic');
  await userEvent.clear(within(form).getByLabelText('Aviso de renovación (días antes)'));
  await userEvent.type(within(form).getByLabelText('Aviso de renovación (días antes)'), '45');
  // CN-14: the notice sentence is added by the contract; a copy typed at the start is dropped on save.
  expect(within(form).getByLabelText('Condiciones de terminación'))
    .toHaveAccessibleDescription(/El contrato antepone «Terminación con 60 días de preaviso\.»/);
  await userEvent.type(within(form).getByLabelText('Condiciones de terminación'), 'Terminación con 60 días de preaviso. Incumplimiento grave.');
  await userEvent.click(within(form).getByRole('button', { name: 'Confirmar vigencia' }));
  // The validity step carries the intent's Idempotency-Key.
  expect(setContractValidity).toHaveBeenCalledWith('v-1', { validFrom: '2026-11-03', validTo: '2027-11-02',
    renewalMode: 'Automatic', renewalTermMonths: 12, renewalNoticeDays: 45, terminationNoticeDays: 60,
    terminationTerms: 'Incumplimiento grave.', expectedDocumentSha256: sha }, expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Acepto y firmo' })).not.toBeInTheDocument();
});

it('reads no timeline once the drawer closes (CN-17)', async () => {
  const { rerender } = render(<ContractDetailDrawer versionId="v-1" onClose={vi.fn()} />);
  await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' });
  await waitFor(() => expect(getContractTimeline).toHaveBeenCalledWith('v-1'));
  rerender(<ContractDetailDrawer versionId={null} onClose={vi.fn()} />);
  await Promise.resolve();
  expect(getContractTimeline).not.toHaveBeenCalledWith(null);
});

it('offers no signature without «Firmar por AVIAM» and explains a missing document', async () => {
  render(<ContractDetailDrawer versionId="v-1" onClose={vi.fn()} />);
  await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' });
  expect(screen.queryByRole('button', { name: 'Acepto y firmo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('form', { name: 'Vigencia y renovación' })).not.toBeInTheDocument();
  cleanup();
  getContractDocument.mockRejectedValueOnce({ status: 404, code: 'not_found' });
  render(<ContractDetailDrawer versionId="v-9" canSign onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('ya no tiene documento');
});

it('creates an amendment from the approved version and keeps the notice and the link to Borradores (1-C)', async () => {
  createContractAmendment.mockResolvedValue({ id: 'v-3' });
  const onClose = vi.fn();
  const onOpenDrafts = vi.fn();
  render(<ContractDetailDrawer versionId="v-1" canAmend onOpenDrafts={onOpenDrafts} onClose={onClose} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Crear enmienda' }));
  const dialog = screen.getByRole('dialog', { name: 'Crear enmienda del contrato CT-001' });
  // «Vigente desde» falls after the start of the approved version on screen and not after its end.
  const start = within(dialog).getByLabelText('Vigente desde');
  expect([start.getAttribute('min'), start.getAttribute('max')]).toEqual(['2026-11-04', '2027-11-02']);
  await userEvent.type(start, '2027-03-01');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Crear enmienda' }));
  expect(await screen.findByText(/Se creó la enmienda como borrador/)).toBeInTheDocument();
  expect(createContractAmendment).toHaveBeenCalledWith('v-1', { expectedStatus: 'Active', validFrom: '2027-03-01' },
    expect.stringMatching(/^[0-9a-f-]{36}$/));
  // The approved version did not change: the drawer keeps its document and the notice stays on screen.
  expect(getContractDocument).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Abrir Borradores' }));
  expect(onClose).toHaveBeenCalled();
  expect(onOpenDrafts).toHaveBeenCalled();
});

it('explains a refused validity by its code, keeps the key of an uncertain retry and re-reads a conflict', async () => {
  const unconfirmed = { ...document, contractCode: 'DRAFT-1', validity: null, signatures: [], signableBy: null };
  getContractDocument.mockResolvedValue(unconfirmed);
  setContractValidity.mockRejectedValueOnce(new Error('Network down'))
    .mockRejectedValueOnce(Object.assign(new Error('Invalid'), { status: 400, code: 'valid_from_not_after_current' }));
  render(<ContractDetailDrawer versionId="v-1" canSetValidity onClose={vi.fn()} />);
  const form = await screen.findByRole('form', { name: 'Vigencia y renovación' });
  await userEvent.click(within(form).getByRole('button', { name: 'Confirmar vigencia' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('No fue posible guardar la vigencia');
  await userEvent.click(within(form).getByRole('button', { name: 'Confirmar vigencia' }));
  expect(await within(form).findByText(/debe empezar después del inicio de la versión vigente/)).toBeInTheDocument();
  const [first, second] = setContractValidity.mock.calls;
  expect(second[2]).toBe(first[2]);
});

it('withdraws an approved version only one party signed, with a reason and the hash on screen (2-N10)', async () => {
  getContractDocument.mockResolvedValue({ ...document, contractStatus: 'Draft', signableBy: null });
  withdrawContractVersion.mockRejectedValueOnce(new Error('Network down'))
    .mockResolvedValueOnce({ versionId: 'v-1', versionStatus: 'Rejected', contractStatus: 'Draft', draftVersionId: 'v-3' });
  const onSigned = vi.fn();
  const onOpenDrafts = vi.fn();
  render(<ContractDetailDrawer versionId="v-1" canManageLifecycle onOpenDrafts={onOpenDrafts} onClose={vi.fn()} onSigned={onSigned} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Retirar versión' }));
  const dialog = screen.getByRole('dialog', { name: 'Retirar la versión 2 del contrato CTR-2026-0001' });
  const confirm = within(dialog).getByRole('button', { name: 'Retirar versión' });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText('Motivo'), 'La vigencia quedó mal fijada.');
  await userEvent.click(confirm);
  // An uncertain result keeps the dialog and the reason, so the retry is the same intent.
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/No fue posible completar la operación/);
  expect(within(dialog).getByLabelText('Motivo')).toHaveValue('La vigencia quedó mal fijada.');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Retirar versión' }));
  expect(await screen.findByText('Versión retirada.')).toBeInTheDocument();
  expect(screen.getByText(/Se creó un borrador con el mismo contenido/)).toBeInTheDocument();
  const [first, second] = withdrawContractVersion.mock.calls;
  expect(first.slice(0, 2)).toEqual(['v-1', { reason: 'La vigencia quedó mal fijada.', expectedDocumentSha256: sha }]);
  // The retry of the same intent keeps the Idempotency-Key.
  expect(second[2]).toBe(first[2]);
  expect(onSigned).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Abrir Borradores' }));
  expect(onOpenDrafts).toHaveBeenCalled();
});

it('never offers the withdrawal of a version both parties signed, and explains a refusal by its code', async () => {
  const aviamSignature = { ...airlineSignature, party: 'Aviam', signerName: 'Ana Pérez', signerTitle: 'Gerente' };
  getContractDocument.mockResolvedValueOnce({ ...document, contractStatus: 'Active', signableBy: null,
    signatures: [airlineSignature, aviamSignature], signedOn: '2026-11-03' });
  const { unmount } = render(<ContractDetailDrawer versionId="v-1" canManageLifecycle onClose={vi.fn()} />);
  await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' });
  expect(screen.queryByRole('button', { name: 'Retirar versión' })).not.toBeInTheDocument();
  expect(screen.getByText(/Firmado por ambas partes el/)).toBeInTheDocument();
  unmount();
  getContractDocument.mockResolvedValue({ ...document, contractStatus: 'Active', signatures: [], signableBy: null });
  withdrawContractVersion.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409, code: 'version_signed' }));
  render(<ContractDetailDrawer versionId="v-1" canManageLifecycle onClose={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Retirar versión' }));
  await userEvent.type(within(screen.getByRole('dialog', { name: /^Retirar la versión/ })).getByLabelText('Motivo'), 'Motivo válido');
  await userEvent.click(within(screen.getByRole('dialog', { name: /^Retirar la versión/ })).getByRole('button', { name: 'Retirar versión' }));
  expect(await screen.findByText('La versión ya rige el contrato: no se puede retirar.')).toBeInTheDocument();
  // A conflict re-reads the document; a version the server says governs is not offered again.
  expect(getContractDocument.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(screen.queryByRole('button', { name: 'Retirar versión' })).not.toBeInTheDocument();
});

it('never offers the withdrawal of the legacy first version that governs an active contract without signatures (2-C)', async () => {
  getContractDocument.mockResolvedValueOnce({ ...document, contractStatus: 'Active', versionNumber: 1, signatures: [],
    signableBy: null, signedOn: '2026-01-01' });
  render(<ContractDetailDrawer versionId="v-1" canManageLifecycle onClose={vi.fn()} />);
  await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 1' });
  expect(screen.queryByRole('region', { name: 'Retirar versión' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retirar versión' })).not.toBeInTheDocument();
  expect(withdrawContractVersion).not.toHaveBeenCalled();
});

it('explains a countersignature over other content by its code (2-N28)', async () => {
  signContractVersion.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409, code: 'airline_signed_other_content' }));
  render(<ContractDetailDrawer versionId="v-1" canSign onClose={vi.fn()} />);
  await userEvent.type(await screen.findByLabelText('Nombre completo'), 'Ana Pérez');
  await userEvent.type(screen.getByLabelText('Cargo'), 'Gerente comercial');
  await userEvent.click(screen.getByRole('checkbox'));
  draw();
  await userEvent.click(screen.getByRole('button', { name: 'Acepto y firmo' }));
  expect(await screen.findByText(/La aerolínea firmó un contenido distinto al actual/)).toBeInTheDocument();
});

it('writes the validity and the day both parties signed in full inside their sentences (N36)', async () => {
  const aviamSignature = { ...airlineSignature, party: 'Aviam', signerName: 'Ana Pérez', signerTitle: 'Gerente' };
  getContractDocument.mockResolvedValueOnce({ ...document, contractStatus: 'Active', signableBy: null,
    signatures: [airlineSignature, aviamSignature], signedOn: '2026-11-03' });
  render(<ContractDetailDrawer versionId="v-1" onClose={vi.fn()} />);
  const drawer = await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' });
  expect(drawer).toHaveTextContent('Del 3 de noviembre de 2026 al 2 de noviembre de 2027 · USD · versión aprobada');
  expect(screen.getByText('Firmado por ambas partes el 3 de noviembre de 2026.')).toBeInTheDocument();
  expect(drawer).not.toHaveTextContent(/2026-11-03|2027-11-02/);
});

it('trims a padded airline code and keeps an ICAO code whole (N33)', async () => {
  getContractDocument.mockResolvedValueOnce({ ...document, airlineName: 'Southwest', airlineLegalName: 'Southwest Airlines Co.',
    airlineCode: 'WN ' });
  const { unmount } = render(<ContractDetailDrawer versionId="v-1" onClose={vi.fn()} />);
  const drawer = await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' });
  expect(drawer).toHaveTextContent('AVIAM (prestador) y Southwest Airlines Co. (WN).');
  expect(drawer).not.toHaveTextContent('(WN )');
  unmount();
  getContractDocument.mockResolvedValueOnce({ ...document, airlineName: 'Southwest', airlineLegalName: 'Southwest Airlines Co.',
    airlineCode: 'SWA' });
  render(<ContractDetailDrawer versionId="v-1" onClose={vi.fn()} />);
  expect(await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' }))
    .toHaveTextContent('AVIAM (prestador) y Southwest Airlines Co. (SWA).');
});

it('writes a validity with no end in words, never «al Sin vencimiento» (N33)', async () => {
  getContractDocument.mockResolvedValueOnce({ ...document, validTo: null });
  render(<ContractDetailDrawer versionId="v-1" onClose={vi.fn()} />);
  const drawer = await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' });
  // CN-13: only the airline signed: Finance approved the prices, the signatures are still pending.
  expect(drawer).toHaveTextContent('Desde el 3 de noviembre de 2026, sin vencimiento · USD · precios aprobados · firmas pendientes');
  expect(drawer).not.toHaveTextContent('versión aprobada');
  expect(drawer).not.toHaveTextContent(/al Sin vencimiento/);
});

it('writes one month and one day of renewal and notice in the singular (N33)', () => {
  const one = { renewalTermMonths: 1, renewalNoticeDays: 1, terminationNoticeDays: 1, terminationTerms: null };
  expect(validityLines({ validity: { ...one, renewalMode: 'Automatic' } })).toEqual([
    'Renovación automática por 1 mes: la nueva versión se inicia 1 día antes del fin.',
    'Terminación con 1 día de preaviso.',
  ]);
  expect(validityLines({ validity: { ...one, renewalMode: 'Manual' } })[0])
    .toBe('Renovación manual por períodos de 1 mes; aviso 1 día antes.');
  expect(validityLines({ validity })).toEqual([
    'Renovación automática por 12 meses: la nueva versión se inicia 30 días antes del fin.',
    'Terminación con 60 días de preaviso. Incumplimiento grave.',
  ]);
});

it('names a new contract «Borrador 1cc18541…» in its title and its withdrawal, never by its DRAFT- code (N35)', async () => {
  // Until Contratos fixes its validity, a new contract's code is «DRAFT-» and the id of the request it came from. A
  // final code stays as the API sends it: the other tests of this file read «Contrato CTR-2026-0001 · versión 2».
  getContractDocument.mockResolvedValue({ ...document, contractCode: 'DRAFT-1cc18541e2a94f3b8c7d6e5f4a3b2c1d',
    validity: null, signatures: [], signableBy: null });
  render(<ContractDetailDrawer versionId="v-1" canManageLifecycle onClose={vi.fn()} />);
  const drawer = await screen.findByRole('dialog', { name: 'Contrato Borrador 1cc18541… · versión 2' });
  expect(within(drawer).getByRole('heading', { name: 'Contrato Borrador 1cc18541… · versión 2' })).toBeInTheDocument();
  await userEvent.click(within(drawer).getByRole('button', { name: 'Retirar versión' }));
  expect(screen.getByRole('dialog', { name: 'Retirar la versión 2 del contrato Borrador 1cc18541…' })).toBeInTheDocument();
  expect(screen.queryByText(/DRAFT-/)).not.toBeInTheDocument();
});

it('keeps every field of the validity form inside its column and names one day in the singular (N33)', async () => {
  getContractDocument.mockResolvedValueOnce({ ...document, contractCode: 'DRAFT-1', validity: null, signatures: [], signableBy: null });
  render(<ContractDetailDrawer versionId="v-1" canSetValidity onClose={vi.fn()} />);
  const form = await screen.findByRole('form', { name: 'Vigencia y renovación' });
  const renewal = within(form).getByLabelText('Renovación');
  // A select is as wide as its longest option unless it may shrink: «Automática: se inicia sola…» left its column.
  for (const field of [renewal, ...within(form).getAllByRole('spinbutton'), within(form).getByLabelText('Inicio de la vigencia'),
    within(form).getByLabelText('Condiciones de terminación')]) {
    expect(field).toHaveClass('w-full', 'min-w-0');
  }
  await userEvent.selectOptions(renewal, 'Automatic');
  await userEvent.clear(within(form).getByLabelText('Aviso de renovación (días antes)'));
  await userEvent.type(within(form).getByLabelText('Aviso de renovación (días antes)'), '1');
  expect(form).toHaveTextContent('La renovación automática crea la nueva versión 1 día antes del fin;');
});
