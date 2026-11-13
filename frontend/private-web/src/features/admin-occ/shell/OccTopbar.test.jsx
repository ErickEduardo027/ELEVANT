import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { OCC_TOAST_PLACEMENT } from '../../occ-ui/OccToastStack';
import { ADMIN_OCC_NAVIGATION } from '../navigation';
import OccTopbar from './OccTopbar';
import { occShellMessages } from './occShellMessages';
import { createOccShellValue, OccShellTestProvider } from './testing/occShellFixtures';

const USER = { name: 'Alex Operations', role: 'Administrador / OCC' };
const RECEIVED_AT = '2026-11-12T17:50:00Z';

// Synthetic notices in the shape of OperationalNotificationResponse, with invented ids.
let sequence = 0;
function notice(kind, overrides = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(12, '0');
  return { id: `92000000-0000-4000-8000-${suffix}`, operationId: `72000000-0000-4000-8000-${suffix}`,
    operationCode: `OP-${300 + sequence}`, stationCode: 'PUJ', kind, sourceId: `82000000-0000-4000-8000-${suffix}`,
    occurredAt: '2026-11-12T17:45:00Z', readAt: null, ...overrides };
}

// Three unreceived alerts (an incident and two that ask for attention), one received and one plain notice.
const DAY = () => [
  notice('incident_reported'),
  notice('deviation_reported'),
  notice('agent_released'),
  notice('contract_not_in_force', { readAt: RECEIVED_AT }),
  notice('operation_submitted'),
];

// Inside a shell root, as ShellFrame draws it: the bar's overlays (the alerts drawer, the toasts) portal into it.
function topbar(props, shell) {
  return (
    <LanguageScope>
      <OccShellTestProvider value={shell}>
        <div data-shell-root="" data-department="occ">
          <OccTopbar navigation={ADMIN_OCC_NAVIGATION} user={USER} onOpenMenu={vi.fn()} onLogout={vi.fn()} {...props} />
        </div>
      </OccShellTestProvider>
    </LanguageScope>
  );
}

afterEach(() => {
  // Unmount first: resetting the language store notifies whatever is still mounted.
  cleanup();
  vi.useRealTimers();
  resetLanguageForTests();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

it('shows no theme button in Spanish or English', async () => {
  for (const language of ['es', 'en']) {
    resetLanguageForTests(language);
    // AppShell sends these two props to every top bar; the OCC bar has no use for them.
    const onToggleTheme = vi.fn();
    const view = render(topbar({ theme: 'dark', onToggleTheme }));

    expect(screen.queryByRole('button', { name: /modo|tema|oscuro|claro|mode|theme|dark|light/i }), language)
      .not.toBeInTheDocument();
    // No control of the bar reaches the handler either.
    for (const button of screen.getAllByRole('button')) await userEvent.click(button);
    expect(onToggleTheme, language).not.toHaveBeenCalled();

    expect(occShellMessages[language]).not.toHaveProperty('themeToDark');
    expect(occShellMessages[language]).not.toHaveProperty('themeToLight');
    view.unmount();
  }
});

it('keeps the language toggle, the clocks and the alerts count', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T18:07:00Z'));
  window.history.replaceState({}, '', '/admin-occ/planning');
  const shell = createOccShellValue({ notices: { status: 'success', items: DAY() } });
  const view = render(topbar({}, shell));

  // Language: two options with the active one pressed, which a strong joint marks without a hue.
  const language = screen.getByRole('group', { name: 'Idioma' });
  expect(within(language).getByRole('button', { name: 'Español' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(language).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
  expect(within(language).getByRole('button', { name: 'Español' }).className.split(/\s+/)).toContain('border-occ-line-strong');
  expect(within(language).getByRole('button', { name: 'English' }).className.split(/\s+/)).toContain('border-transparent');
  expect(screen.getByText('Planificación')).toBeInTheDocument();

  // Clocks read from this device: Punta Cana first, then UTC.
  const clock = screen.getByLabelText('Hora UTC según el reloj de este equipo: 18:07');
  expect(within(clock).getByText('18:07')).toHaveAttribute('datetime', '2026-11-12T18:07:00.000Z');
  const local = screen.getByLabelText('Hora local de Punta Cana según el reloj de este equipo: 14:07');
  expect(local.compareDocumentPosition(clock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  // Alerts: the unreceived count is in the name and in the badge, with the glyph of the highest priority.
  const alerts = screen.getByRole('button', { name: '3 alertas', description: 'Urgente' });
  expect(within(alerts).getByTestId('notifications-badge')).toHaveTextContent(/^3$/);

  // Choosing the other language translates the bar.
  await userEvent.click(within(language).getByRole('button', { name: 'English' }));
  expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '3 alerts', description: 'Urgent' })).toBeInTheDocument();
  expect(screen.getByLabelText('UTC time from this device clock: 18:07')).toBeInTheDocument();
  expect(screen.getByLabelText('Punta Cana local time from this device clock: 14:07')).toBeInTheDocument();
  expect(screen.getByText('Planning')).toBeInTheDocument();

  // With every alert received the badge goes away.
  const received = DAY().map(item => ({ ...item, readAt: RECEIVED_AT }));
  view.rerender(topbar({}, createOccShellValue({ notices: { status: 'success', items: received } })));
  expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'No alerts' })).toBeInTheDocument();

  // The button opens the alerts drawer over the screen, in English too; the page stays where it was.
  await userEvent.click(screen.getByRole('button', { name: 'No alerts' }));
  expect(screen.getByRole('dialog', { name: 'Alerts and notices' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/admin-occ/planning');
});

it('the alerts button opens the drawer and reports aria-expanded', async () => {
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  const markRead = vi.fn(async id => ({ id }));
  const shell = createOccShellValue({ notices: { status: 'success', items: DAY(), markRead } });
  render(topbar({}, shell));
  const button = screen.getByRole('button', { name: '3 alertas', description: 'Urgente' });
  expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).not.toHaveAttribute('aria-controls');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  await userEvent.click(button);
  const drawer = screen.getByRole('dialog', { name: 'Alertas y avisos' });
  expect(drawer).toHaveAttribute('aria-modal', 'true');
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(button).toHaveAttribute('aria-controls', drawer.id);
  // Drawn in the shell root, out of the bar, with the notices the shell already read.
  expect(drawer.closest('header')).toBeNull();
  expect(within(drawer).getAllByRole('button', { name: 'Recibido' })).toHaveLength(3);
  expect(within(drawer).getByText(/^Recibida a las /)).toBeInTheDocument();
  expect(markRead).not.toHaveBeenCalled();

  // Esc closes it and gives focus back to the button.
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).not.toHaveAttribute('aria-controls');
  expect(button).toHaveFocus();

  // The browser's back button closes it too.
  await userEvent.click(button);
  expect(screen.getByRole('dialog', { name: 'Alertas y avisos' })).toBeInTheDocument();
  act(() => { window.history.pushState({}, '', '/admin-occ/planning'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('the toast stack starts under the bar', () => {
  render(topbar({}));
  const bar = screen.getByRole('banner');
  // The bar is 48 px high (h-12); the stack starts 8 px under it, so it never covers the clocks or the alert count.
  expect(bar.className.split(/\s+/)).toContain('h-12');
  expect(OCC_TOAST_PLACEMENT.statusBarPx).toBe(12 * 4);
  expect(OCC_TOAST_PLACEMENT.topPx).toBeGreaterThan(OCC_TOAST_PLACEMENT.statusBarPx);
});

it('names Datos maestros and Tablets instead of their message keys', () => {
  const view = render(topbar({}));
  for (const [path, spanish, english] of [
    ['/admin-occ/master-data', 'Datos maestros', 'Master data'],
    ['/admin-occ/devices', 'Tablets', 'Tablets'],
    ['/admin-occ/position-coverage', 'Cobertura de posiciones', 'Stand coverage'],
  ]) {
    act(() => {
      resetLanguageForTests('es');
      window.history.replaceState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByText(spanish), path).toBeInTheDocument();
    act(() => resetLanguageForTests('en'));
    expect(screen.getByText(english), path).toBeInTheDocument();
    expect(screen.getByRole('banner').textContent, path).not.toMatch(/nav\./);
  }
  view.unmount();
});

it('shows the PUJ station plate and Punta Cana', () => {
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  render(topbar({}));
  const plate = screen.getByText('PUJ');
  expect(plate).toHaveAttribute('data-occ-plate', 'station');
  const city = screen.getByText('Punta Cana');
  // «Punta Cana» goes right after the plate and shows from 1280 px.
  expect(plate.nextElementSibling).toBe(city);
  expect(city.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'xl:inline']));
  expect(screen.getByText('Panorama')).toBeInTheDocument();
});

it('puts the bar in the order of the design and leaves out what the OCC deferred', () => {
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  const shell = createOccShellValue({ live: { state: 'polling', since: 0, lastOkAt: 0 } });
  render(topbar({}, shell));
  const bar = screen.getByRole('banner');
  expect(bar.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-12', 'border-occ-line', 'bg-occ-panel']));
  // No navigation landmark of its own: the rail is the navigation.
  expect(within(bar).queryByRole('navigation')).not.toBeInTheDocument();

  const order = [
    screen.getByRole('button', { name: 'Abrir menú de navegación' }),
    screen.getByText('PUJ'),
    screen.getByText('Panorama'),
    screen.getByRole('button', { name: 'Sin tiempo real' }),
    screen.getByRole('button', { name: 'Fuentes al día' }),
    screen.getByRole('button', { name: 'Sin alertas' }),
    screen.getByLabelText(/^Hora local de Punta Cana/),
    screen.getByLabelText(/^Hora UTC/),
    screen.getByRole('group', { name: 'Idioma' }),
    screen.getByRole('button', { name: 'Leyenda' }),
    screen.getByRole('button', { name: 'Menú de Alex Operations' }),
  ];
  for (let index = 1; index < order.length; index += 1) {
    expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING, String(index))
      .toBeTruthy();
  }
  // Search, wall mode and the theme stay out (contratos 2.2 and 2.4).
  expect(screen.queryByRole('button', { name: /buscar|muro|atajos/i })).not.toBeInTheDocument();
});

it('shows a neutral Alertas while the notices load', () => {
  render(topbar({}, createOccShellValue({ notices: { status: 'loading', items: [] } })));
  const alerts = screen.getByRole('button', { name: 'Alertas' });
  expect(within(alerts).queryByTestId('notifications-badge')).not.toBeInTheDocument();
});

it('says when the notices could not be read, and marks the count of a failed refresh', async () => {
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  const retry = vi.fn();
  const view = render(topbar({}, createOccShellValue({ notices: { status: 'timeout', items: [], retry } })));
  const failed = screen.getByRole('button', { name: 'Alertas: sin datos' });
  expect(failed.querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'triangle');
  // The bar shows the reason only where it has room for it (statusBarLayout.js).
  expect(within(failed).getByText(': sin datos').className).toBe('sr-only 2xl:not-sr-only');
  // The button still opens the alerts, whose drawer offers to read them again.
  await userEvent.click(failed);
  const drawer = screen.getByRole('dialog', { name: 'Alertas y avisos' });
  expect(within(drawer).getByRole('alert')).toHaveTextContent('No se pudieron cargar los avisos.');
  await userEvent.click(within(drawer).getByRole('button', { name: 'Reintentar' }));
  expect(retry).toHaveBeenCalledOnce();
  view.unmount();

  // A refresh that failed keeps the count of the last good read, at 18:02 UTC (14:02 in Punta Cana), and says so.
  render(topbar({}, createOccShellValue({
    notices: { status: 'success', items: DAY(), refreshFailed: true, fetchedAt: '2026-11-12T18:02:00.000Z' },
  })));
  const stale = screen.getByRole('button', {
    name: '3 alertas, sin actualizar', description: 'Urgente. Sin actualizar desde las 14:02',
  });
  expect(within(stale).getByTestId('notifications-badge')).toHaveTextContent(/^3$/);
  expect(within(stale).getByText(', sin actualizar').className).toBe('sr-only 2xl:not-sr-only');
});
