import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRole } from '../../../../app/auth-boundary';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { AccessGate, administratorAccess, DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { clearSession, logout, persistSession } from '../../auth/authService';
import { OCC_TEST_ACCOUNT_ID } from '../shell/testing/occShellFixtures';
import { useOccBoot } from './occBootContext';
import { occBootMessages } from './occBootMessages';
import { OccBootAccessSignal, OccBootProvider } from './OccBootProvider';
import { hasSeenOccBoot, markOccBootSeen } from './occBootSession';

// The session is synthetic and has no token, so the session gate starts no presence lease.
const auth = vi.hoisted(() => ({ session: null, ready: true }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ session: auth.session, ready: auth.ready, logout: async () => {} }),
}));

const OCC_SESSION = Object.freeze({
  accountId: OCC_TEST_ACCOUNT_ID, email: 'occ@example.test', name: 'Operador OCC', role: 'ADMIN_OCC',
  roleLabel: 'Administrador OCC', expiresAt: '2099-01-01T00:00:00.000Z',
});
const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
const START = Date.parse('2026-11-13T14:00:00Z');
const never = () => new Promise(() => {});

// The console stand-in: it renders under the gates and hands the test the value of useOccBoot().
let boot;
function ConsoleProbe() {
  const value = useOccBoot();
  useEffect(() => { boot = value; });
  return <p>Consola del OCC</p>;
}

// The OCC entry as RoleLayout composes it: the boot screen around the session gate and the access gate.
function occEntry({ load = never } = {}) {
  return (
    <OccBootProvider>
      <ProtectedRole role="ADMIN_OCC">
        {() => (
          <DepartmentAccessProvider observe={false} load={load}>
            <OccBootAccessSignal />
            <AccessGate><ConsoleProbe /></AccessGate>
          </DepartmentAccessProvider>
        )}
      </ProtectedRole>
    </OccBootProvider>
  );
}

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const bootScreen = () => screen.queryByTestId('occ-boot-screen');
const announcer = () => document.querySelector('[data-occ-boot-announcer]');

// The first entry, with the access loaded: the screen waits for the first screen to report ready.
async function enterWithAccess() {
  render(occEntry({ load: vi.fn().mockResolvedValue(ACCESS) }));
  await flush();
  expect(bootScreen()).toHaveAttribute('data-occ-boot-phase', 'waitingReady');
  expect(bootScreen()).toHaveAttribute('data-occ-boot-progress', 'screen');
  // The console is already mounted underneath, loading its first data.
  expect(screen.getByText('Consola del OCC')).toBeInTheDocument();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(START);
  auth.session = OCC_SESSION;
  auth.ready = true;
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetLanguageForTests('es');
  boot = undefined;
});

describe('OccBootProvider', () => {
  it('the first OCC entry after a login shows the boot screen', async () => {
    // An earlier entry saw it; this login shows it again.
    markOccBootSeen(OCC_TEST_ACCOUNT_ID);
    persistSession(OCC_SESSION);
    expect(hasSeenOccBoot(OCC_TEST_ACCOUNT_ID)).toBe(false);

    render(occEntry());
    const cover = bootScreen();
    expect(cover).toHaveAttribute('data-occ-boot-phase', 'waitingAccess');
    expect(cover).toHaveAttribute('data-occ-boot-progress', 'session');
    // It carries the OCC scope itself and is hidden from assistive technology...
    expect(cover).toHaveAttribute('data-department', 'occ');
    expect(cover).toHaveAttribute('aria-hidden', 'true');
    // ...which hears the session gate's own status underneath, and the screen's polite announcement.
    expect(screen.getByRole('status')).toHaveTextContent('Comprobando sesión…');
    expect(announcer()).toHaveTextContent('Preparando el centro de operaciones…');
    // This tab has now seen it for this account.
    expect(hasSeenOccBoot(OCC_TEST_ACCOUNT_ID)).toBe(true);

    // The session gate passes: the access gate takes over underneath, and the screen stays.
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando permisos…');
    expect(bootScreen()).toBe(cover);
    expect(cover).toHaveAttribute('data-occ-boot-progress', 'access');
  });

  it('a second entry in the same session does not show it', async () => {
    const first = render(occEntry());
    expect(bootScreen()).toBeInTheDocument();
    first.unmount();

    // Another OCC entry in the same tab and the same login (a reload, or back from another page).
    render(occEntry({ load: vi.fn().mockResolvedValue(ACCESS) }));
    expect(bootScreen()).toBeNull();
    await flush();
    expect(screen.getByText('Consola del OCC')).toBeInTheDocument();
    expect(bootScreen()).toBeNull();
    expect(announcer()).toBeEmptyDOMElement();
  });

  it('after a logout it shows again', async () => {
    const first = render(occEntry());
    expect(bootScreen()).toBeInTheDocument();
    first.unmount();

    logout();
    expect(hasSeenOccBoot(OCC_TEST_ACCOUNT_ID)).toBe(false);
    // The next login of the same account enters the OCC again.
    render(occEntry());
    expect(bootScreen()).toHaveAttribute('data-occ-boot-phase', 'waitingAccess');
  });

  it('the server render does not show it', async () => {
    const app = occEntry();
    const container = document.createElement('div');
    container.innerHTML = renderToString(app);
    document.body.append(container);
    // Only the plain status screen of the session gate, and an empty announcer.
    expect(container.querySelector('[data-testid="occ-boot-screen"]')).toBeNull();
    expect(container.querySelector('[data-occ-boot-announcer]')).toBeEmptyDOMElement();
    expect(container).not.toHaveTextContent('Preparando');
    expect(container.querySelector('[role="status"]')).toHaveTextContent('Comprobando sesión…');
    expect(hasSeenOccBoot(OCC_TEST_ACCOUNT_ID)).toBe(false);

    // It decides after hydration, without a hydration mismatch.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root;
    await act(async () => { root = hydrateRoot(container, app); });
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydrat|did not match/i);
    expect(container.querySelector('[data-testid="occ-boot-screen"]'))
      .toHaveAttribute('data-occ-boot-phase', 'waitingAccess');

    await act(async () => root.unmount());
    container.remove();
  });

  it('shows once under StrictMode, as `next dev` renders it', async () => {
    // StrictMode runs the decision twice on mount: the second run finds the tab marked and changes nothing.
    render(<StrictMode>{occEntry({ load: vi.fn().mockResolvedValue(ACCESS) })}</StrictMode>);
    expect(screen.getAllByTestId('occ-boot-screen')).toHaveLength(1);
    expect(bootScreen()).toHaveAttribute('data-occ-boot-phase', 'waitingAccess');
    await flush();
    expect(bootScreen()).toHaveAttribute('data-occ-boot-phase', 'waitingReady');
    await flush(6_000);
    expect(bootScreen()).toHaveAttribute('data-occ-boot-phase', 'leaving');
    await flush(400);
    expect(bootScreen()).toBeNull();
  });

  it('decides only once the session is known on the client', async () => {
    auth.ready = false;
    const view = render(occEntry());
    expect(bootScreen()).toBeNull();
    expect(hasSeenOccBoot(OCC_TEST_ACCOUNT_ID)).toBe(false);

    auth.ready = true;
    view.rerender(occEntry());
    expect(bootScreen()).toHaveAttribute('data-occ-boot-phase', 'waitingAccess');
  });

  it('waits for the access with no timeout and keeps «Cargando permisos…» as the only status underneath', async () => {
    render(occEntry({ load: never }));
    await flush();
    await flush(60_000);
    const cover = bootScreen();
    expect(cover).toHaveAttribute('data-occ-boot-phase', 'waitingAccess');
    expect(cover).toHaveAttribute('data-occ-boot-progress', 'access');
    // Hidden elements included: the screen and its announcer add no second status.
    const statuses = screen.getAllByRole('status', { hidden: true });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent('Cargando permisos…');
    expect(announcer()).not.toHaveAttribute('role');
    expect(announcer()).toHaveAttribute('aria-live', 'polite');
    // The announcer sits outside the hidden tree.
    expect(cover).not.toContainElement(announcer());
    expect(announcer().closest('[aria-hidden="true"]')).toBeNull();
  });

  it.each(['console', 'map'])('leaves on markReady("%s")', async source => {
    await enterWithAccess();
    act(() => boot.markReady(source));
    expect(bootScreen()).toHaveAttribute('data-occ-boot-phase', 'leaving');
    expect(bootScreen()).toHaveAttribute('data-occ-boot-progress', 'complete');
    expect(announcer()).toHaveTextContent('Listo.');
    // Repeating it, or the other screen reporting, changes nothing.
    act(() => boot.markReady(source === 'console' ? 'map' : 'console'));
    expect(bootScreen()).toHaveAttribute('data-occ-boot-phase', 'leaving');

    await flush(399);
    expect(bootScreen()).toBeInTheDocument();
    await flush(1);
    expect(bootScreen()).toBeNull();
    expect(announcer()).toBeEmptyDOMElement();
    expect(screen.getByText('Consola del OCC')).toBeInTheDocument();
  });

  it('leaves 6 s after the access when no screen reports ready', async () => {
    await enterWithAccess();
    await flush(5_999);
    expect(bootScreen()).toHaveAttribute('data-occ-boot-phase', 'waitingReady');
    await flush(1);
    expect(bootScreen()).toHaveAttribute('data-occ-boot-phase', 'leaving');
    await flush(400);
    expect(bootScreen()).toBeNull();
    // A late report finds nothing to end.
    act(() => boot.markReady('console'));
    expect(bootScreen()).toBeNull();
  });

  it('stops intercepting pointer events as soon as it leaves', async () => {
    await enterWithAccess();
    // While it waits it covers the page and takes the clicks.
    expect(bootScreen()).not.toHaveStyle({ pointerEvents: 'none' });
    act(() => boot.markReady('console'));
    // From the first frame of its exit, clicks reach the console underneath.
    expect(bootScreen()).toHaveStyle({ pointerEvents: 'none' });
  });

  it('gives way at once to the AccessGate error', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Internal provider exception details'))
      .mockResolvedValueOnce(ACCESS);
    render(occEntry({ load }));
    expect(bootScreen()).toBeInTheDocument();
    // The session gate passes and the access fails: no exit transition and no 6 s wait.
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar sus permisos.');
    expect(bootScreen()).toBeNull();
    expect(announcer()).toBeEmptyDOMElement();
    expect(screen.queryByText('Internal provider exception details')).not.toBeInTheDocument();

    // A retry that loads the access does not bring it back.
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await flush();
    expect(screen.getByText('Consola del OCC')).toBeInTheDocument();
    expect(bootScreen()).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a session of another role never shows it', async () => {
    vi.spyOn(globalThis.__nextRouterMock, 'replace').mockImplementation(() => {});
    for (const role of ['FINANZAS', 'SUPERADMIN', 'CUSTOM_ABCD1234EF56']) {
      auth.session = { ...OCC_SESSION, role };
      const view = render(occEntry());
      await flush();
      expect(bootScreen(), role).toBeNull();
      expect(announcer(), role).toBeEmptyDOMElement();
      view.unmount();
    }
    // Nor does a visitor without a session, and none of them marks the tab.
    auth.session = null;
    render(occEntry());
    await flush();
    expect(bootScreen()).toBeNull();
    expect(hasSeenOccBoot(OCC_TEST_ACCOUNT_ID)).toBe(false);
  });

  it('announces its progress in the stored language', async () => {
    expect(Object.keys(occBootMessages.en)).toEqual(Object.keys(occBootMessages.es));
    act(() => resetLanguageForTests('en'));
    await enterWithAccess();
    expect(announcer()).toHaveTextContent('Preparing the operations centre…');
    expect(announcer()).toHaveAttribute('lang', 'en');
    act(() => boot.markReady('map'));
    expect(announcer()).toHaveTextContent('Ready.');
  });

  it('useOccBoot is a safe no-op outside the provider', () => {
    const values = [];
    function Outside() {
      const value = useOccBoot();
      values.push(value);
      return <p>Fuera del OCC</p>;
    }
    const view = render(<Outside />);
    view.rerender(<Outside />);
    expect(values[0]).toBe(values[1]);
    expect(() => values[0].markReady('console')).not.toThrow();
    expect(values[0].markReady('console')).toBeUndefined();

    // The access signal outside the provider reports to nobody and renders nothing.
    view.unmount();
    const { container } = render(
      <DepartmentAccessProvider observe={false} initialAccess={ACCESS}>
        <OccBootAccessSignal />
      </DepartmentAccessProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(within(document.body).queryByTestId('occ-boot-screen')).toBeNull();
  });
});
