import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
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

function topbar(props, shell) {
  return (
    <LanguageScope>
      <OccShellTestProvider value={shell}>
        <OccTopbar navigation={ADMIN_OCC_NAVIGATION} user={USER} onOpenMenu={vi.fn()} onLogout={vi.fn()} {...props} />
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

  // Until the alerts drawer arrives, the button opens the notifications page, as the bell did.
  await userEvent.click(screen.getByRole('button', { name: 'No alerts' }));
  expect(window.location.pathname).toBe('/admin-occ/notifications');
  expect(screen.getByText('Notifications')).toBeInTheDocument();
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
