import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { occShellMessages } from './occShellMessages';
import {
  arrivalToasts, EMPTY_TOAST_QUEUE, nextToastExpiry, noticeToastId, OCC_TOAST_LIFETIME_MS, OCC_TOAST_LIMIT,
  reduceToastQueue,
} from './occToastQueue';

const spanish = { pathname: '/admin-occ/dashboard', t: createTranslator(occShellMessages, 'es'), language: 'es' };
const english = { pathname: '/admin-occ/dashboard', t: createTranslator(occShellMessages, 'en'), language: 'en' };

// Synthetic notices in the shape of OperationalNotificationResponse, with invented ids.
let sequence = 0;
function notice(kind, overrides = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(12, '0');
  return { id: `93000000-0000-4000-8000-${suffix}`, operationId: `73000000-0000-4000-8000-${suffix}`,
    operationCode: `OP-${400 + sequence}`, stationCode: 'PUJ', kind, sourceId: `83000000-0000-4000-8000-${suffix}`,
    occurredAt: `2026-11-12T14:${String(sequence % 60).padStart(2, '0')}:00Z`, readAt: null, ...overrides };
}

// A toast as arrivalToasts builds it.
let toastSequence = 0;
function toast(priority) {
  toastSequence += 1;
  return { id: `toast:${priority}:${toastSequence}`, priority, message: `${priority} ${toastSequence}`,
    action: { label: 'Abrir', path: '/admin-occ/review' } };
}

const arrive = (state, toasts, now) => reduceToastQueue(state, { type: 'arrive', toasts, now });
const ids = state => state.visible.map(item => item.id);

describe('the toast queue', () => {
  it('shows at most three toasts', () => {
    const toasts = [toast('notice'), toast('attention'), toast('notice'), toast('notice'), toast('attention')];
    let state = EMPTY_TOAST_QUEUE;
    toasts.forEach((item, index) => {
      state = arrive(state, [item], index * 1_000);
      expect(state.visible.length, String(index)).toBeLessThanOrEqual(OCC_TOAST_LIMIT);
    });
    expect(OCC_TOAST_LIMIT).toBe(3);
    // The newest three, in the order they showed.
    expect(ids(state)).toEqual(toasts.slice(2).map(item => item.id));
    expect(state.waiting).toEqual([]);

    // One read that brings three toasts fills the three places at once.
    const burst = [toast('urgent'), toast('attention'), toast('notice')];
    expect(ids(arrive(EMPTY_TOAST_QUEUE, burst, 0))).toEqual(burst.map(item => item.id));
  });

  it('keeps an urgent toast at least 15 s', () => {
    const urgent = toast('urgent');
    let state = arrive(EMPTY_TOAST_QUEUE, [urgent], 0);
    expect(state.visible[0]).toMatchObject({ id: urgent.id, shownAt: 0, expiresAt: 15_000 });
    expect(OCC_TOAST_LIFETIME_MS).toEqual({ urgent: 15_000, attention: 10_000, notice: 8_000 });

    // A run of later toasts never pushes it out: the others give way to each other.
    for (let second = 1; second <= 8; second += 1) {
      state = arrive(state, [toast(second % 2 ? 'notice' : 'attention')], second * 1_000);
      expect(ids(state), String(second)).toContain(urgent.id);
    }
    state = reduceToastQueue(state, { type: 'expire', now: 14_999 });
    expect(ids(state)).toContain(urgent.id);
    state = reduceToastQueue(state, { type: 'expire', now: 15_000 });
    expect(ids(state)).not.toContain(urgent.id);

    // Attention 10 s and a notice 8 s, each from the moment it shows.
    let calm = arrive(EMPTY_TOAST_QUEUE, [toast('attention'), toast('notice')], 1_000);
    expect(calm.visible.map(item => item.expiresAt)).toEqual([11_000, 9_000]);
    expect(nextToastExpiry(calm)).toBe(9_000);
    calm = reduceToastQueue(calm, { type: 'expire', now: 9_000 });
    expect(calm.visible.map(item => item.priority)).toEqual(['attention']);
    expect(nextToastExpiry(reduceToastQueue(calm, { type: 'expire', now: 11_000 }))).toBeNull();
    expect(nextToastExpiry(EMPTY_TOAST_QUEUE)).toBeNull();
  });

  it('drops the oldest non-urgent toast for a new one', () => {
    const [notice1, attention1, urgent1] = [toast('notice'), toast('attention'), toast('urgent')];
    let state = arrive(EMPTY_TOAST_QUEUE, [notice1], 0);
    state = arrive(state, [attention1], 1_000);
    state = arrive(state, [urgent1], 2_000);

    const notice2 = toast('notice');
    state = arrive(state, [notice2], 3_000);
    expect(ids(state)).toEqual([attention1.id, urgent1.id, notice2.id]);
    // The one that gives way is gone, not waiting.
    expect(state.waiting).toEqual([]);

    const notice3 = toast('notice');
    state = arrive(state, [notice3], 4_000);
    expect(ids(state)).toEqual([urgent1.id, notice2.id, notice3.id]);
  });

  it('makes a new toast wait its turn while the three are urgent', () => {
    const urgent = [toast('urgent'), toast('urgent'), toast('urgent')];
    let state = arrive(EMPTY_TOAST_QUEUE, urgent, 0);
    const [late, later] = [toast('notice'), toast('urgent')];
    state = arrive(state, [late], 1_000);
    state = arrive(state, [later], 2_000);
    expect(ids(state)).toEqual(urgent.map(item => item.id));
    expect(state.waiting.map(item => item.id)).toEqual([late.id, later.id]);

    // Closing one lets the first in line show, for its whole time from then on.
    state = reduceToastQueue(state, { type: 'dismiss', id: urgent[1].id, now: 5_000 });
    expect(ids(state)).toEqual([urgent[0].id, urgent[2].id, late.id]);
    expect(state.visible[2]).toMatchObject({ shownAt: 5_000, expiresAt: 13_000 });
    expect(state.waiting.map(item => item.id)).toEqual([later.id]);

    // When the first two are over, the last one shows.
    state = reduceToastQueue(state, { type: 'expire', now: 15_000 });
    expect(ids(state)).toEqual([later.id]);
    expect(state.visible[0]).toMatchObject({ shownAt: 15_000, expiresAt: 30_000 });
    expect(state.waiting).toEqual([]);

    // A toast closed while it waits never shows.
    let queued = arrive(arrive(EMPTY_TOAST_QUEUE, urgent, 0), [late], 1_000);
    queued = reduceToastQueue(queued, { type: 'dismiss', id: late.id, now: 2_000 });
    expect(queued.waiting).toEqual([]);
    expect(ids(reduceToastQueue(queued, { type: 'expire', now: 15_000 }))).toEqual([]);
  });

  it('never makes a toast give way to another of the same read', () => {
    const [urgent1, urgent2] = [toast('urgent'), toast('urgent')];
    const state = arrive(EMPTY_TOAST_QUEUE, [urgent1, urgent2], 0);
    const burst = [toast('attention'), toast('notice'), toast('notice')];
    const next = arrive(state, burst, 1_000);
    // One place was free: the first of the read takes it and the others wait for theirs.
    expect(ids(next)).toEqual([urgent1.id, urgent2.id, burst[0].id]);
    expect(next.waiting.map(item => item.id)).toEqual([burst[1].id, burst[2].id]);
  });

  it('clear empties the queue, waiting toasts included', () => {
    const urgent = [toast('urgent'), toast('urgent'), toast('urgent')];
    const state = arrive(arrive(EMPTY_TOAST_QUEUE, urgent, 0), [toast('notice')], 1_000);
    expect(state.waiting).toHaveLength(1);
    expect(reduceToastQueue(state, { type: 'clear' })).toBe(EMPTY_TOAST_QUEUE);
    expect(reduceToastQueue(EMPTY_TOAST_QUEUE, { type: 'clear' })).toBe(EMPTY_TOAST_QUEUE);
    expect(nextToastExpiry(reduceToastQueue(state, { type: 'clear' }))).toBeNull();
  });

  it('names a notice toast after its notice, so its receipt can take it away', () => {
    const incident = notice('incident_reported');
    const [only] = arrivalToasts([incident], spanish);
    expect(only.id).toBe(noticeToastId(incident.id));
    const state = arrive(EMPTY_TOAST_QUEUE, [only], 0);
    expect(ids(reduceToastQueue(state, { type: 'dismiss', id: noticeToastId(incident.id), now: 1_000 }))).toEqual([]);
  });

  it('ignores a toast already queued and leaves the state alone when nothing changes', () => {
    const item = toast('attention');
    const state = arrive(EMPTY_TOAST_QUEUE, [item], 0);
    expect(arrive(state, [item], 1_000)).toBe(state);
    expect(arrive(state, [], 1_000)).toBe(state);
    expect(reduceToastQueue(state, { type: 'expire', now: 1_000 })).toBe(state);
    expect(reduceToastQueue(state, { type: 'dismiss', id: 'not-there', now: 1_000 })).toBe(state);
    expect(reduceToastQueue(state, { type: 'unknown' })).toBe(state);
    // Time is the caller's: an action without it is a mistake, not a silent zero.
    for (const type of ['arrive', 'dismiss', 'expire']) {
      expect(() => reduceToastQueue(state, { type, toasts: [], id: item.id }), type).toThrow(TypeError);
    }
  });
});

describe('arrivalToasts', () => {
  it('writes each notice as «{tipo}, {código}» and opens where the notice points, the most pressing first', () => {
    const message = notice('agent_message');
    const incident = notice('incident_reported');
    const released = notice('agent_released');
    const toasts = arrivalToasts([message, incident, released], spanish);
    // The stack draws «{message}, {code}», the code as a plate (OccToastStack.test.jsx).
    expect(toasts).toEqual([
      { id: `notice:${incident.id}`, priority: 'urgent', message: 'Incidencia reportada en rampa',
        code: incident.operationCode,
        action: { label: 'Abrir', path: `/admin-occ/review?operationId=${incident.operationId}` } },
      { id: `notice:${released.id}`, priority: 'attention',
        message: 'Gestión Humana liberó al agente de la operación: reasígnela', code: released.operationCode,
        action: { label: 'Abrir', path: '/admin-occ/planning' } },
      { id: `notice:${message.id}`, priority: 'notice', message: 'Nuevo mensaje del agente', code: message.operationCode,
        action: { label: 'Abrir', path: `/admin-occ/chat?operationId=${message.operationId}` } },
    ]);
    // No middle dot anywhere, and a notice without a code says its kind alone.
    expect(JSON.stringify(toasts)).not.toContain('·');
    expect(arrivalToasts([notice('deviation_reported', { operationCode: '' })], spanish)[0])
      .toMatchObject({ message: 'Desviación reportada en rampa', code: null });
    expect(arrivalToasts([incident], english)[0]).toMatchObject({
      message: 'Incident reported on the ramp', code: incident.operationCode, action: { label: 'Open' },
    });
  });

  it('summarizes the rest of a burst with Ver', () => {
    const arrived = ['operation_submitted', 'incident_reported', 'flight_changed', 'deviation_reported', 'operation_started']
      .map((kind, index) => notice(kind, { occurredAt: `2026-11-12T15:0${index}:00Z` }));
    const toasts = arrivalToasts(arrived, spanish);
    // Three places: the two most pressing, and one summary for the other three.
    expect(toasts).toHaveLength(OCC_TOAST_LIMIT);
    expect(toasts.map(item => item.priority)).toEqual(['urgent', 'attention', 'notice']);
    expect(toasts[2]).toEqual({
      id: `summary:${arrived[4].id}`, priority: 'notice', message: 'Tienes 3 avisos operativos nuevos más.', code: null,
      action: { label: 'Ver', path: '/admin-occ/notifications' },
    });
    expect(arrivalToasts(arrived, english)[2]).toMatchObject({
      message: 'You have 3 more new operational notices.', action: { label: 'View', path: '/admin-occ/notifications' },
    });
    // The summary is as pressing as what it stands for, so an urgent notice in it still interrupts.
    const urgentBurst = [notice('incident_reported'), notice('incident_reported'), notice('incident_reported'),
      notice('agent_message')];
    expect(arrivalToasts(urgentBurst, spanish).map(item => item.priority)).toEqual(['urgent', 'urgent', 'urgent']);
    expect(arrivalToasts(urgentBurst, spanish)[2].message).toBe('Tienes 2 avisos operativos nuevos más.');

    // Up to three, each has its own toast, the most pressing and then the newest first, and nothing is summarized.
    const three = [notice('operation_submitted', { occurredAt: '2026-11-12T13:01:00Z' }),
      notice('incident_reported', { occurredAt: '2026-11-12T13:00:00Z' }),
      notice('flight_changed', { occurredAt: '2026-11-12T13:02:00Z' })];
    expect(arrivalToasts(three, spanish).map(item => item.id))
      .toEqual([three[1], three[2], three[0]].map(item => `notice:${item.id}`));
    expect(arrivalToasts([], spanish)).toEqual([]);

    // A burst always fits: the queue shows the whole of it at once.
    const state = arrive(EMPTY_TOAST_QUEUE, toasts, 0);
    expect(ids(state)).toEqual(toasts.map(item => item.id));
  });

  it('never toasts a message while the chat is open', () => {
    const arrived = [notice('agent_message'), notice('occ_message'), notice('deviation_reported')];
    const inChat = arrivalToasts(arrived, { ...spanish, pathname: '/admin-occ/chat' });
    expect(inChat.map(item => item.id)).toEqual([`notice:${arrived[2].id}`]);
    expect(arrivalToasts(arrived, spanish)).toHaveLength(3);
  });

  it('carries the same arrival texts in both languages', () => {
    expect(Object.keys(occShellMessages.en.arrivals)).toEqual(Object.keys(occShellMessages.es.arrivals));
    expect(Object.keys(occShellMessages.es.arrivals)).toEqual(['open', 'viewAll', 'more']);
  });
});
