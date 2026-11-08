import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readSession } from '../features/auth/authService';

vi.mock('../features/auth/authService', () => ({
  readSession: vi.fn(), handleUnauthorizedResponse: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.example.test');
  readSession.mockReturnValue({ token: 'hr-token' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const ok = () => vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: 'emp-1' }),
  { status: 200, headers: { 'content-type': 'application/json' } }));

it('sends the record version with the intent key on an update, a transfer and a termination (2-N06)', async () => {
  const fetch = ok();
  vi.stubGlobal('fetch', fetch);
  const { terminateEmployee, transferEmployee, updateEmployee } = await import('./humanResourcesEmployeesService');
  const key = 'a0000000-0000-7000-8000-0000000000f1';
  await updateEmployee('emp-1', { positionId: 'pos-office', expectedVersion: 'E1' }, key);
  await transferEmployee('emp-1', { department: 'contracts', expectedVersion: 'E1' }, key);
  await terminateEmployee('emp-1', { terminatedOn: '2026-11-07', expectedVersion: 'E1' }, key);
  const calls = fetch.mock.calls.map(([url, init]) => [String(url), init.method, init.headers['Idempotency-Key']]);
  expect(calls).toEqual([
    ['https://api.example.test/api/v1/human-resources/employees/emp-1', 'PUT', key],
    ['https://api.example.test/api/v1/human-resources/employees/emp-1/transfer', 'POST', key],
    ['https://api.example.test/api/v1/human-resources/employees/emp-1/termination', 'POST', key],
  ]);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ positionId: 'pos-office', expectedVersion: 'E1' });
});

it('keeps an update without a key for older callers and keeps the server code of a refusal', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'emp-1' }),
      { status: 200, headers: { 'content-type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ title: 'El registro cambió.', code: 'version_conflict' }),
      { status: 409, headers: { 'content-type': 'application/problem+json' } }));
  vi.stubGlobal('fetch', fetch);
  const { governanceMessage, updateEmployee } = await import('./humanResourcesEmployeesService');
  await updateEmployee('emp-1', { expectedVersion: 'E1' });
  expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBeUndefined();
  const failure = await updateEmployee('emp-1', { expectedVersion: 'E0' }, 'a0000000-0000-7000-8000-0000000000f2')
    .catch(error => error);
  expect(failure).toMatchObject({ status: 409, code: 'version_conflict' });
  expect(governanceMessage(failure)).toBe('El expediente cambió mientras lo revisaba. Vuelva a abrirlo e intente de nuevo.');
});

it('tells that only the agent unblocks an operation in progress, from the tablet (2-N06)', async () => {
  const { governanceMessage } = await import('./humanResourcesEmployeesService');
  const message = governanceMessage({ status: 409, code: 'agent_has_operation_in_progress' });
  expect(message).toMatch(/Debe enviarla desde la tablet/);
  expect(message).not.toMatch(/OCC/);
});
