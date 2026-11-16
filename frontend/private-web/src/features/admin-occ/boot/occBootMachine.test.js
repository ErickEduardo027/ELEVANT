import { describe, expect, it } from 'vitest';
import {
  initialOccBoot, isOccBootVisible, occBootAnnouncement, occBootProgress, OCC_BOOT_EXIT_MS, OCC_BOOT_PHASES,
  OCC_BOOT_READY_TIMEOUT_MS, OCC_BOOT_SOURCES, reduceOccBoot,
} from './occBootMachine';

// Folds a list of events (or event types) into the state, from the initial one.
const run = (...events) => events.reduce(
  (state, event) => reduceOccBoot(state, typeof event === 'string' ? { type: event } : event), initialOccBoot());
const ready = source => ({ type: 'ready', source });
const view = state => ({
  phase: state.phase, visible: isOccBootVisible(state), progress: occBootProgress(state),
  announcement: occBootAnnouncement(state),
});

describe('occBootMachine', () => {
  it('starts hidden: nothing shows before the client decides', () => {
    expect(OCC_BOOT_PHASES).toEqual(['hidden', 'waitingAccess', 'waitingReady', 'leaving', 'done']);
    expect(OCC_BOOT_SOURCES).toEqual(['console', 'map']);
    expect(Object.isFrozen(OCC_BOOT_PHASES) && Object.isFrozen(OCC_BOOT_SOURCES)).toBe(true);
    expect(OCC_BOOT_EXIT_MS).toBe(400);

    expect(initialOccBoot()).toEqual({ phase: 'hidden', session: false, access: 'pending', readyFrom: null });
    expect(view(initialOccBoot())).toEqual({ phase: 'hidden', visible: false, progress: 'session', announcement: null });
    // Facts may arrive first; they are kept, but only the client's decision shows the screen.
    const known = run('sessionChecked', 'accessLoaded', ready('console'), 'timeout', 'exitEnd');
    expect(known).toMatchObject({ phase: 'hidden', session: true, access: 'loaded', readyFrom: 'console' });
    expect(isOccBootVisible(known)).toBe(false);
    expect(occBootAnnouncement(known)).toBeNull();
    // An unknown event changes nothing.
    const state = initialOccBoot();
    expect(reduceOccBoot(state, { type: 'paint' })).toBe(state);
  });

  it('waits for the access with no timeout: a timeout before the access is ignored', () => {
    const shown = run('show');
    expect(view(shown)).toEqual({ phase: 'waitingAccess', visible: true, progress: 'session', announcement: 'preparing' });
    expect(reduceOccBoot(shown, { type: 'timeout' })).toBe(shown);
    expect(reduceOccBoot(shown, { type: 'exitEnd' })).toBe(shown);

    const checked = reduceOccBoot(shown, { type: 'sessionChecked' });
    expect(view(checked)).toEqual({ phase: 'waitingAccess', visible: true, progress: 'access', announcement: 'preparing' });
    // The session is checked once; repeating it re-renders nothing, and time alone never ends the wait for the access.
    expect(reduceOccBoot(checked, { type: 'sessionChecked' })).toBe(checked);
    expect(reduceOccBoot(checked, { type: 'timeout' })).toBe(checked);
  });

  it('after the access it waits for the first screen to report ready', () => {
    const waiting = run('show', 'sessionChecked', 'accessLoaded');
    expect(view(waiting)).toEqual({ phase: 'waitingReady', visible: true, progress: 'screen', announcement: 'preparing' });
    expect(reduceOccBoot(waiting, { type: 'accessLoaded' })).toBe(waiting);
    expect(reduceOccBoot(waiting, { type: 'exitEnd' })).toBe(waiting);
  });

  it('leaves on ready from the console and on ready from the map', () => {
    for (const source of OCC_BOOT_SOURCES) {
      const leaving = run('show', 'sessionChecked', 'accessLoaded', ready(source));
      expect(leaving.readyFrom, source).toBe(source);
      expect(view(leaving), source).toEqual({ phase: 'leaving', visible: true, progress: 'complete', announcement: 'ready' });
      // The exit transition ends it.
      const done = reduceOccBoot(leaving, { type: 'exitEnd' });
      expect(view(done), source).toEqual({ phase: 'done', visible: false, progress: 'complete', announcement: null });
    }
  });

  it('ignores a ready from an unknown source and a repeated ready', () => {
    const waiting = run('show', 'sessionChecked', 'accessLoaded');
    for (const event of [ready('panel'), ready(undefined), { type: 'ready' }]) {
      expect(reduceOccBoot(waiting, event)).toBe(waiting);
    }
    const leaving = reduceOccBoot(waiting, ready('console'));
    // The first screen to report counts; the same report, or the other screen's, changes nothing after it.
    expect(reduceOccBoot(leaving, ready('console'))).toBe(leaving);
    expect(reduceOccBoot(leaving, ready('map'))).toBe(leaving);
    const done = reduceOccBoot(leaving, { type: 'exitEnd' });
    expect(reduceOccBoot(done, ready('map'))).toBe(done);
    // A ready while it waits for the access is kept once.
    const early = run('show', ready('map'));
    expect(reduceOccBoot(early, ready('console'))).toBe(early);
    expect(early.readyFrom).toBe('map');
  });

  it('a ready reported before the access ends the wait as soon as the access arrives', () => {
    const early = run('show', 'sessionChecked', ready('console'));
    expect(early).toMatchObject({ phase: 'waitingAccess', readyFrom: 'console' });
    expect(occBootProgress(early)).toBe('access');
    expect(view(reduceOccBoot(early, { type: 'accessLoaded' })))
      .toEqual({ phase: 'leaving', visible: true, progress: 'complete', announcement: 'ready' });
  });

  it('leaves on the 6 s timeout once the access is loaded', () => {
    expect(OCC_BOOT_READY_TIMEOUT_MS).toBe(6_000);
    const leaving = run('show', 'sessionChecked', 'accessLoaded', 'timeout');
    expect(leaving).toMatchObject({ phase: 'leaving', readyFrom: null });
    expect(view(leaving)).toEqual({ phase: 'leaving', visible: true, progress: 'complete', announcement: 'ready' });
    // Leaving is not restarted by a late timeout or a late screen.
    expect(reduceOccBoot(leaving, { type: 'timeout' })).toBe(leaving);
    expect(reduceOccBoot(leaving, ready('console'))).toBe(leaving);
    expect(reduceOccBoot(leaving, { type: 'exitEnd' }).phase).toBe('done');
  });

  it('an access error ends it at once from every visible phase', () => {
    const visible = {
      waitingAccess: run('show', 'sessionChecked'),
      waitingReady: run('show', 'sessionChecked', 'accessLoaded'),
      leaving: run('show', 'sessionChecked', 'accessLoaded', 'timeout'),
    };
    for (const [phase, state] of Object.entries(visible)) {
      expect(state.phase).toBe(phase);
      const failed = reduceOccBoot(state, { type: 'accessFailed' });
      // Straight to done, without the exit transition.
      expect(failed, phase).toMatchObject({ phase: 'done', access: 'failed' });
      expect(view(failed), phase).toEqual({ phase: 'done', visible: false, progress: 'complete', announcement: null });
    }
    // A retry that loads the access afterwards does not bring the screen back.
    const retried = run('show', 'sessionChecked', 'accessFailed', 'accessLoaded', ready('console'), 'timeout');
    expect(retried).toMatchObject({ phase: 'done', access: 'loaded' });
    expect(isOccBootVisible(retried)).toBe(false);
  });

  it('facts reported before show decide the phase it shows in', () => {
    // React runs the access signal's effects (a child) before the provider's decision (its parent).
    expect(run('show').phase).toBe('waitingAccess');
    expect(run('sessionChecked', 'show').phase).toBe('waitingAccess');
    expect(run('sessionChecked', 'accessLoaded', 'show').phase).toBe('waitingReady');
    expect(run('sessionChecked', 'accessLoaded', ready('console'), 'show').phase).toBe('leaving');
    expect(run(ready('map'), 'show', 'sessionChecked', 'accessLoaded').phase).toBe('leaving');
    // An access that already failed never shows it.
    const failed = run('sessionChecked', 'accessFailed', 'show');
    expect(failed).toMatchObject({ phase: 'done', access: 'failed' });
    expect(occBootAnnouncement(failed)).toBeNull();
  });

  it('skip ends it without showing; exitEnd only ends leaving', () => {
    const skipped = run('skip');
    expect(view(skipped)).toEqual({ phase: 'done', visible: false, progress: 'complete', announcement: null });
    // The decision is taken once: a later show or skip changes nothing.
    expect(reduceOccBoot(skipped, { type: 'show' })).toBe(skipped);
    const shown = run('show');
    expect(reduceOccBoot(shown, { type: 'skip' })).toBe(shown);
    expect(reduceOccBoot(shown, { type: 'show' })).toBe(shown);
    // Nothing that happens after a skip shows it.
    expect(run('skip', 'sessionChecked', 'accessLoaded', 'timeout').phase).toBe('done');

    expect(run('exitEnd').phase).toBe('hidden');
    expect(run('show', 'exitEnd').phase).toBe('waitingAccess');
    expect(run('show', 'accessLoaded', 'exitEnd').phase).toBe('waitingReady');
    expect(run('show', 'accessLoaded', 'timeout', 'exitEnd').phase).toBe('done');
  });

  it('progress goes session, access, screen, complete; the announcement is preparing then ready, none after an access error', () => {
    const steps = ['show', 'sessionChecked', 'accessLoaded', ready('console'), 'exitEnd'];
    const seen = steps.map((_, index) => view(run(...steps.slice(0, index + 1))));
    expect(seen.map(({ progress }) => progress)).toEqual(['session', 'access', 'screen', 'complete', 'complete']);
    expect(seen.map(({ announcement }) => announcement)).toEqual(['preparing', 'preparing', 'preparing', 'ready', null]);
    expect(seen.map(({ visible }) => visible)).toEqual([true, true, true, true, false]);

    const failed = ['show', 'sessionChecked', 'accessFailed'];
    const failedSeen = failed.map((_, index) => view(run(...failed.slice(0, index + 1))));
    expect(failedSeen.map(({ announcement }) => announcement)).toEqual(['preparing', 'preparing', null]);
    expect(failedSeen.at(-1)).toEqual({ phase: 'done', visible: false, progress: 'complete', announcement: null });
  });
});
