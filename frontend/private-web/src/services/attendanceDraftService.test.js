import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  readSession: vi.fn(() => ({ token: 'occ-token' })),
  handleUnauthorizedResponse: vi.fn(),
}));
vi.mock('../features/auth/authService', () => auth);

import { readAttendanceDraft, saveOccAttendanceDraft } from './attendanceDraftService';

const operationId = '70000000-0000-7000-8000-000000000005';
const assignmentId = '70000000-0000-7000-8000-000000000006';
const stationId = '20000000-0000-7000-8000-000000000003';
const key = '82000000-0000-7000-8000-000000000041';
const request = {
  expectedRevision: 0,
  observedStartAt: '2026-10-02T12:00:00.000Z',
  observedEndAt: null,
  incidentNote: 'Equipo listo',
};
const contribution = {
  revision: 1,
  authorAccountId: '40000000-0000-7000-8000-000000000001',
  recordedAt: '2026-10-02T12:01:00.000Z',
  observedStartAt: request.observedStartAt,
  observedEndAt: null,
  incidentNote: request.incidentNote,
};
const snapshot = { operationId, assignmentId, stationId, occ: contribution, rampAgent: null };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('VITE_ELEVANT_API_URL', 'https://api.example.test');
  auth.readSession.mockReturnValue({ token: 'occ-token' });
  auth.handleUnauthorizedResponse.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('attendanceDraftService', () => {
  it('reads both canonical lanes with the current token and abort signal', async () => {
    let authorizationAtSend = null;
    const fetch = vi.fn((_, init) => {
      authorizationAtSend = new Headers(init.headers).get('authorization');
      return Promise.resolve(jsonResponse(snapshot));
    });
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();

    await expect(readAttendanceDraft(operationId, assignmentId,
      { signal: controller.signal })).resolves.toEqual(snapshot);

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toBe(
      `https://api.example.test/api/v1/operations/${operationId}/assignments/${assignmentId}/attendance-draft`
    );
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
    expect(authorizationAtSend).toBe('Bearer occ-token');
  });

  it('writes only the OCC lane with exactly the provided idempotency key and body', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ contribution, replayed: false }));
    vi.stubGlobal('fetch', fetch);

    await expect(saveOccAttendanceDraft(operationId, assignmentId, request, key))
      .resolves.toEqual({ contribution, replayed: false });

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(`https://api.example.test/api/v1/operations/${operationId}/assignments/${assignmentId}/attendance-draft/occ`);
    expect(init.method).toBe('PUT');
    expect(new Headers(init.headers).get('idempotency-key')).toBe(key);
    expect(new Headers(init.headers).get('x-elevant-installation-id')).toBeNull();
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it.each([
    [401, 'unauthorized', false],
    [403, 'forbidden', false],
    [404, 'not-found', true],
    [409, 'stale-revision', true],
  ])('converts HTTP %i into a safe write error', async (status, code, recoverable) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      title: 'Internal database detail', detail: 'sensitive SQL and PII', status,
    }, status)));

    await expect(saveOccAttendanceDraft(operationId, assignmentId, request, key))
      .rejects.toMatchObject({ status, code, recoverable });
    try { await saveOccAttendanceDraft(operationId, assignmentId, request, key); }
    catch (error) {
      expect(error.message).not.toMatch(/SQL|PII|Internal database detail/);
      expect(error).not.toHaveProperty('detail');
    }
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledTimes(status === 401 ? 2 : 0);
  });

  it.each([
    [new TypeError('network unavailable'), null],
    [jsonResponse({ detail: 'sensitive' }, 503), 503],
  ])('labels a failed PUT as an unknown outcome', async (failure, status) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      failure instanceof Response ? Promise.resolve(failure) : Promise.reject(failure)));

    await expect(saveOccAttendanceDraft(operationId, assignmentId, request, key))
      .rejects.toMatchObject({ code: 'unknown-outcome', status, recoverable: true });
    expect(auth.handleUnauthorizedResponse).not.toHaveBeenCalled();
  });

  it('does not confuse a cancelled GET with a server failure', async () => {
    const aborted = new DOMException('cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(aborted));
    await expect(readAttendanceDraft(operationId, assignmentId)).rejects.toBe(aborted);
  });

  it.each(['read', 'write'])('does not expire a replacement session after an old %s gets 401', async action => {
    let resolveFetch;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveFetch = resolve; })));
    const call = action === 'read'
      ? readAttendanceDraft(operationId, assignmentId)
      : saveOccAttendanceDraft(operationId, assignmentId, request, key);
    await vi.waitFor(() => expect(resolveFetch).toBeTypeOf('function'));
    auth.readSession.mockReturnValue({ token: 'replacement-token' });
    resolveFetch(jsonResponse({ status: 401 }, 401));
    await expect(call).rejects.toMatchObject({ code: 'cancelled' });
    expect(auth.handleUnauthorizedResponse).not.toHaveBeenCalled();
  });

  it('does not return a stale successful read under a replacement session', async () => {
    let resolveFetch;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveFetch = resolve; })));
    const call = readAttendanceDraft(operationId, assignmentId);
    await vi.waitFor(() => expect(resolveFetch).toBeTypeOf('function'));
    auth.readSession.mockReturnValue({ token: 'replacement-token' });
    resolveFetch(jsonResponse(snapshot));
    await expect(call).rejects.toMatchObject({ code: 'cancelled' });
  });
});
