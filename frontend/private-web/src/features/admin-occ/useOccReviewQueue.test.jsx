import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

// The pattern of CanonicalReviewRoute.test.jsx: the observer factory keeps the listener it was given.
const live = vi.hoisted(() => ({ listener: null, created: 0, start: null, stop: null }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: listener => {
    live.listener = listener;
    live.created += 1;
    return { start: live.start, stop: live.stop };
  },
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ session: { accountId: '30000000-0000-4000-8000-000000000001' } }),
}));

import { createOccShellValue, OccShellTestProvider } from './shell/testing/occShellFixtures';
import { useOccReviewChangeVersion } from './useOccReviewQueue';

function Version() {
  return <p>{`Versión ${useOccReviewChangeVersion()}`}</p>;
}

afterEach(() => {
  cleanup();
  Object.assign(live, { listener: null, created: 0, start: null, stop: null });
});

it('moves on occ_review through the shell observer inside the OCC frame', () => {
  const shell = createOccShellValue();
  const view = render(<OccShellTestProvider value={shell}><Version /></OccShellTestProvider>);
  expect(screen.getByText('Versión 0')).toBeInTheDocument();
  expect(shell.subscriptions()).toEqual(['occ_review']);

  act(() => shell.announce(['occ_planning']));
  expect(screen.getByText('Versión 0')).toBeInTheDocument();
  act(() => shell.announce(['occ_review']));
  expect(screen.getByText('Versión 1')).toBeInTheDocument();
  // No second observer in the tab.
  expect(live.created).toBe(0);

  view.unmount();
  expect(shell.subscriptions()).toEqual([]);
});

it('keeps its own observer outside the shell', () => {
  live.start = vi.fn(async () => {});
  live.stop = vi.fn(async () => {});
  const view = render(<Version />);
  expect(live.created).toBe(1);
  expect(live.start).toHaveBeenCalledOnce();

  act(() => live.listener(['occ_planning']));
  expect(screen.getByText('Versión 0')).toBeInTheDocument();
  act(() => live.listener(['notifications', 'occ_review']));
  expect(screen.getByText('Versión 1')).toBeInTheDocument();

  view.unmount();
  expect(live.stop).toHaveBeenCalledOnce();
});
