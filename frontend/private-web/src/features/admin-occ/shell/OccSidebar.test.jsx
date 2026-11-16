import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { administratorAccess, allowedNavigation, buildAccess } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import ShellFrame from '../../shell/ShellFrame';
import { ADMIN_OCC_NAVIGATION } from '../navigation';
import OccSidebar from './OccSidebar';
import OccTopbar from './OccTopbar';
import { occShellMessages } from './occShellMessages';
import { createOccShellValue, OccShellTestProvider } from './testing/occShellFixtures';

const USER = { name: 'Alex Operations', role: 'Administrador / OCC' };
const READ_AT = '2026-11-12T17:50:00Z';
const STATION_QUERY = '?stationId=20000000-0000-4000-8000-000000000001';

const GROUPS = {
  es: [
    ['En vivo', ['Panorama', 'Monitoreo de vuelos', 'Mapa de posiciones', 'Chat interno']],
    ['Planificar', ['Planificación', 'Cobertura de posiciones', 'Contratos listos']],
    ['Revisar', ['Revisión', 'Reportes', 'Notificaciones']],
    ['Estación', ['Datos maestros', 'Tablets', 'Usuarios', 'Mis gastos']],
  ],
  en: [
    ['Live', ['Overview', 'Flight monitoring', 'Positions map', 'Internal chat']],
    ['Plan', ['Planning', 'Stand coverage', 'Ready contracts']],
    ['Review', ['Review', 'Reports', 'Notifications']],
    ['Station', ['Master data', 'Tablets', 'Users', 'My expenses']],
  ],
};
const MODULES = GROUPS.es.flatMap(([, modules]) => modules);

// Synthetic notices in the shape of OperationalNotificationResponse, with invented ids.
let sequence = 0;
function notice(kind, overrides = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(12, '0');
  return { id: `94000000-0000-4000-8000-${suffix}`, operationId: `74000000-0000-4000-8000-${suffix}`,
    operationCode: `OP-${500 + sequence}`, stationCode: 'PUJ', kind, sourceId: `84000000-0000-4000-8000-${suffix}`,
    occurredAt: '2026-11-12T17:45:00Z', readAt: null, ...overrides };
}

// A desktop rail, expanded unless the test says otherwise, inside the shell's test provider.
function rail(props = {}, shell) {
  return (
    <LanguageScope>
      <OccShellTestProvider value={shell}>
        <OccSidebar navigation={ADMIN_OCC_NAVIGATION} user={USER} onLogout={vi.fn()} breakpoint="desktop" railVisible
          railExpanded overlayOpen={false} onToggle={vi.fn()} onCloseOverlay={vi.fn()} {...props} />
      </OccShellTestProvider>
    </LanguageScope>
  );
}

const navigationOf = (language = 'es') => screen.getByRole('navigation', { name: occShellMessages[language].navLabel });
const hints = () => [...document.querySelectorAll('[data-occ-rail-hint]')];

// A fixed box for an element, in viewport coordinates, as the browser would measure it.
function placeAt(element, { top, height = 36, left = 12, width = 47 }) {
  element.getBoundingClientRect = () => ({ top, height, left, width, bottom: top + height, right: left + width,
    x: left, y: top, toJSON() {} });
}

// Each group of the navigation, in order, is the list named after it and holds these modules, in order.
function expectGroups(nav, groups) {
  const lists = within(nav).getAllByRole('list');
  expect(lists).toHaveLength(groups.length);
  groups.forEach(([group, modules], index) => {
    expect(within(nav).getByRole('list', { name: group })).toBe(lists[index]);
    expect(within(lists[index]).getAllByRole('link'))
      .toEqual(modules.map(name => within(lists[index]).getByRole('link', { name })));
  });
}

afterEach(() => {
  // Unmount first: resetting the language store notifies whatever is still mounted.
  cleanup();
  resetLanguageForTests();
  window.history.replaceState({}, '', '/');
});

it.each([
  ['es', 'Estación', 'Mis gastos', 'desktop'],
  ['en', 'Station', 'My expenses', 'mobile'],
])('shows OCC expenses in %s under %s', (language, section, label, breakpoint) => {
  resetLanguageForTests(language);
  window.history.replaceState({}, '', '/admin-occ/expenses');

  render(
    <LanguageScope>
      <OccSidebar navigation={ADMIN_OCC_NAVIGATION} user={{ name: 'Alex Operations' }}
        breakpoint={breakpoint} railVisible={breakpoint === 'desktop'} railExpanded
        overlayOpen={breakpoint === 'mobile'} onToggle={vi.fn()} onCloseOverlay={vi.fn()} />
    </LanguageScope>,
  );

  const group = screen.getByText(section).parentElement;
  const link = within(group).getByRole('link', { name: label });
  expect(link).toHaveAttribute('href', '/admin-occ/expenses');
  expect(link).toHaveAttribute('aria-current', 'page');
});

describe('OCC rail', () => {
  it('shows the four groups and their modules in order in Spanish and English', () => {
    for (const language of ['es', 'en']) {
      resetLanguageForTests(language);
      window.history.replaceState({}, '', '/admin-occ/dashboard');
      const view = render(rail());

      const nav = navigationOf(language);
      expectGroups(nav, GROUPS[language]);
      // The group names are short sentence-case labels on screen, never a raw message key. (In English the group
      // «Revisar» and the module «Revisión» are both «Review», so the label is looked up among the group labels.)
      for (const [group] of GROUPS[language]) {
        const label = within(nav).getByText(group, { selector: 'p' });
        expect(label, group).toHaveClass('text-xs', 'font-semibold', 'text-occ-nav-muted');
        expect(label, group).not.toHaveClass('sr-only');
        expect(label.className, group).not.toMatch(/uppercase|tracking/);
      }
      expect(nav).not.toHaveTextContent(/sections\.|nav\./);
      view.unmount();
    }
  });

  it('hides modules the department access does not allow and drops empty groups', () => {
    window.history.replaceState({}, '', '/admin-occ/dashboard');
    // A member who watches the operation and reads its notices: no planning, review, reports, master data, tablets or
    // users. «Mis gastos» needs no permission.
    const member = buildAccess({ kind: 'Member', department: 'operations', canManageDepartmentUsers: false, permissions: [
      'operations.dashboard.read', 'operations.flight_monitoring.read', 'operations.chat.read',
      'operations.notifications.read',
    ] });
    const view = render(rail({ navigation: allowedNavigation(ADMIN_OCC_NAVIGATION, member) }));

    let nav = navigationOf();
    expectGroups(nav, [
      ['En vivo', ['Panorama', 'Monitoreo de vuelos', 'Chat interno']],
      ['Revisar', ['Notificaciones']],
      ['Estación', ['Mis gastos']],
    ]);
    expect(within(nav).queryByText('Planificar')).not.toBeInTheDocument();
    for (const hidden of ['Mapa de posiciones', 'Planificación', 'Cobertura de posiciones', 'Contratos listos', 'Revisión',
      'Reportes', 'Datos maestros', 'Tablets', 'Usuarios']) {
      expect(within(nav).queryByRole('link', { name: hidden }), hidden).not.toBeInTheDocument();
    }

    // Collapsed, an empty group leaves no rule behind either.
    view.rerender(rail({ navigation: allowedNavigation(ADMIN_OCC_NAVIGATION, member), railExpanded: false }));
    nav = navigationOf();
    expect(within(nav).getAllByRole('list')).toHaveLength(3);
    expect(nav.querySelectorAll('[data-occ-group-rule]')).toHaveLength(3);
    view.unmount();

    // A department administrator sees the 14 modules, «Usuarios» included.
    const administrator = buildAccess(administratorAccess('operations', DepartmentPermissionCodes.operations));
    render(rail({ navigation: allowedNavigation(ADMIN_OCC_NAVIGATION, administrator) }));
    expectGroups(navigationOf(), GROUPS.es);
  });

  it('marks only the active item with aria-current=page', () => {
    window.history.replaceState({}, '', '/admin-occ/review/74000000-0000-4000-8000-000000000001');
    const view = render(rail());

    const expectOnlyActive = name => {
      const links = within(navigationOf()).getAllByRole('link');
      const active = within(navigationOf()).getByRole('link', { name });
      expect(links.filter(link => link.getAttribute('aria-current') === 'page')).toEqual([active]);
      // The raised slab and the 2 px accent bar mark it, and nothing else.
      expect(active).toHaveClass('bg-occ-nav-active');
      // The bar is a border, which forced-colours mode keeps.
      expect(active.querySelector('[data-occ-active-bar]')).toHaveClass('border-l-2', 'border-occ-nav-accent');
      for (const link of links.filter(other => other !== active)) {
        expect(link).not.toHaveAttribute('aria-current');
        expect(link).not.toHaveClass('bg-occ-nav-active');
        expect(link.querySelector('[data-occ-active-bar]')).toBeNull();
      }
    };

    // A page below a module keeps the module active.
    expectOnlyActive('Revisión');
    act(() => globalThis.__nextRouterMock.push('/admin-occ/chat'));
    expectOnlyActive('Chat interno');

    // Collapsed, the mark stays on the same module.
    view.rerender(rail({ railExpanded: false }));
    expectOnlyActive('Chat interno');
  });

  it('shows neutral count plates for Chat interno, Revisión and Notificaciones from the loaded notices without changing the link names', () => {
    window.history.replaceState({}, '', '/admin-occ/dashboard');
    const items = [
      notice('agent_message'), notice('agent_message'), notice('agent_message'),
      notice('agent_message', { readAt: READ_AT }),
      notice('operation_submitted'),
      notice('incident_reported'),
    ];
    const view = render(rail({}, createOccShellValue({ notices: { items } })));

    const counted = [['Chat interno', '3'], ['Revisión', '1'], ['Notificaciones', '5']];
    for (const [name, figure] of counted) {
      // The name is the label alone; the count reaches screen readers as the link's description.
      const link = screen.getByRole('link', { name, description: `${figure} sin leer` });
      const plate = link.querySelector('[data-occ-count-plate]');
      expect(plate.textContent, name).toBe(figure);
      expect(plate, name).toHaveAttribute('aria-hidden', 'true');
      // Neutral: the figure in mono on the raised slab, with no signal colour.
      expect(plate, name).toHaveClass('bg-occ-panel-raised', 'text-occ-text', 'font-mono', 'text-xs');
      expect(plate.className, name).not.toMatch(/warn|danger|accent|signal|status/);
    }
    for (const name of MODULES.filter(module => !counted.some(([countedName]) => countedName === module))) {
      const link = screen.getByRole('link', { name });
      expect(link.querySelector('[data-occ-count-plate]'), name).toBeNull();
      expect(link, name).not.toHaveAttribute('aria-describedby');
    }

    // The plates follow the shell's notices: a received hand-off leaves Revisión.
    const received = items.map(item => (item.kind === 'operation_submitted' ? { ...item, readAt: READ_AT } : item));
    view.rerender(rail({}, createOccShellValue({ notices: { items: received } })));
    expect(screen.getByRole('link', { name: 'Revisión' }).querySelector('[data-occ-count-plate]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Notificaciones', description: '4 sin leer' })).toBeInTheDocument();

    // A plate spells out 99 at most; the description keeps the whole count.
    const flood = Array.from({ length: 120 }, () => notice('agent_message'));
    view.rerender(rail({}, createOccShellValue({ notices: { items: flood } })));
    const chat = screen.getByRole('link', { name: 'Chat interno', description: '120 sin leer' });
    expect(chat.querySelector('[data-occ-count-plate]').textContent).toBe('99+');

    // Without the notices permission there is nothing to count.
    view.rerender(rail({}, createOccShellValue({ notices: { status: 'forbidden', items: [] } })));
    expect(document.querySelector('[data-occ-count-plate]')).toBeNull();
    view.unmount();

    resetLanguageForTests('en');
    render(rail({}, createOccShellValue({ notices: { items } })));
    expect(screen.getByRole('link', { name: 'Internal chat', description: '3 unread' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Notifications', description: '5 unread' })).toBeInTheDocument();
  });

  it('keeps accessible names and shows labels on hover and focus when collapsed', async () => {
    window.history.replaceState({}, '', '/admin-occ/dashboard');
    const user = userEvent.setup();
    render(rail({ railExpanded: false }, createOccShellValue({ notices: { items: [notice('agent_message')] } })));
    const nav = navigationOf();

    // Every module keeps its name, and no label is on screen until it is asked for.
    for (const name of MODULES) expect(within(nav).getByRole('link', { name }), name).toHaveAttribute('aria-label', name);
    expect(hints()).toEqual([]);
    // The groups keep their names for screen readers; on screen each one is a 1 px rule.
    for (const [group] of GROUPS.es) {
      expect(within(nav).getByRole('list', { name: group })).toBeInTheDocument();
      expect(within(nav).getByText(group)).toHaveClass('sr-only');
    }
    expect(nav.querySelectorAll('[data-occ-group-rule]')).toHaveLength(4);
    // The count plate stays, without touching the name.
    const chat = within(nav).getByRole('link', { name: 'Chat interno', description: '1 sin leer' });
    expect(chat.querySelector('[data-occ-count-plate]').textContent).toBe('1');

    // Hover: the label shows beside the item, fixed to the screen so the scrolling nav cannot clip it.
    placeAt(chat, { top: 200 });
    await user.hover(chat);
    expect(hints()).toHaveLength(1);
    const hint = chat.querySelector('[data-occ-rail-hint]');
    expect(hint).toHaveTextContent('Chat interno');
    expect(hint).toHaveAttribute('aria-hidden', 'true');
    expect(hint).toHaveClass('fixed');
    expect(hint).toHaveStyle({ top: '218px', left: '59px' });
    expect(within(nav).getByRole('link', { name: 'Chat interno' })).toBe(chat);
    // It follows its item when the nav scrolls.
    placeAt(chat, { top: 120 });
    fireEvent.scroll(nav);
    expect(chat.querySelector('[data-occ-rail-hint]')).toHaveStyle({ top: '138px' });
    await user.unhover(chat);
    expect(hints()).toEqual([]);

    // Focus shows it as well, and Esc dismisses it without moving focus.
    const overview = within(nav).getByRole('link', { name: 'Panorama' });
    act(() => overview.focus());
    expect(hints().map(element => element.textContent)).toEqual(['Panorama']);
    await user.keyboard('{Escape}');
    expect(hints()).toEqual([]);
    expect(overview).toHaveFocus();
    // The next item shows its own name; leaving the rail hides it.
    await user.tab();
    expect(within(nav).getByRole('link', { name: 'Monitoreo de vuelos' })).toHaveFocus();
    expect(hints().map(element => element.textContent)).toEqual(['Monitoreo de vuelos']);
    act(() => document.activeElement.blur());
    expect(hints()).toEqual([]);

    // Expanded, the names are on screen and nothing pops up.
    cleanup();
    render(rail());
    await user.hover(screen.getByRole('link', { name: 'Chat interno' }));
    act(() => screen.getByRole('link', { name: 'Panorama' }).focus());
    expect(hints()).toEqual([]);
  });

  it('shows initials, name, role and Cerrar sesión in the footer', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    const view = render(rail({ onLogout }));
    let footer = navigationOf().closest('[data-occ-nav]');

    const initials = within(footer).getByText('AO');
    expect(initials).toHaveAttribute('aria-hidden', 'true');
    // A neutral plate, like the account plate of the status bar.
    expect(initials).toHaveClass('bg-occ-panel-raised', 'border-occ-line-strong', 'text-occ-text');
    expect(within(footer).getByText('Alex Operations')).toBeInTheDocument();
    expect(within(footer).getByText('Administrador / OCC')).toBeInTheDocument();
    await user.click(within(footer).getByRole('button', { name: 'Cerrar sesión' }));
    expect(onLogout).toHaveBeenCalledOnce();

    // Collapsed: the initials and the button, which keeps its name and shows it beside itself.
    view.rerender(rail({ onLogout, railExpanded: false }));
    footer = navigationOf().closest('[data-occ-nav]');
    expect(within(footer).getByText('AO')).toBeInTheDocument();
    expect(within(footer).queryByText('Alex Operations')).not.toBeInTheDocument();
    const logout = within(footer).getByRole('button', { name: 'Cerrar sesión' });
    await user.hover(logout);
    expect(hints().map(element => element.textContent)).toEqual(['Cerrar sesión']);
    await user.click(logout);
    expect(onLogout).toHaveBeenCalledTimes(2);
    expect(hints()).toEqual([]);
    view.unmount();

    resetLanguageForTests('en');
    render(rail({ onLogout }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('no longer shows the identity card', () => {
    for (const railExpanded of [true, false]) {
      const view = render(rail({ railExpanded, user: { name: 'Alex Operations', role: 'Controlador' } }));
      const body = navigationOf().closest('[data-occ-nav]');
      // The station and the department live in the status bar, not in the rail.
      for (const text of ['PUJ', 'OCC', 'Centro de Operaciones', /Punta Cana/]) {
        expect(within(body).queryByText(text), `${railExpanded}: ${text}`).not.toBeInTheDocument();
      }
      expect(body.querySelector('[title]'), String(railExpanded)).toBeNull();
      view.unmount();
    }
    // Nor do the messages keep its texts.
    for (const language of ['es', 'en']) {
      for (const key of ['departmentShort', 'station', 'stationShort']) {
        expect(occShellMessages[language], `${language}: ${key}`).not.toHaveProperty(key);
      }
    }
  });
});

describe('OCC skip link', () => {
  // The whole OCC frame: ShellFrame with the rail and the status bar, and a screen with one control.
  function frame() {
    return (
      <LanguageScope>
        <OccShellTestProvider>
          <ShellFrame department="occ" rootAttributes={{ 'data-occ-bridge': '' }} SidebarComponent={OccSidebar}
            TopbarComponent={OccTopbar} rootClassName="bg-occ-canvas text-occ-text" mainKey="/admin-occ/dashboard"
            sidebarProps={{ navigation: ADMIN_OCC_NAVIGATION, user: USER, onLogout: vi.fn(), breakpoint: 'desktop',
              railVisible: true, railExpanded: true, overlayOpen: false, onToggle: vi.fn(), onCloseOverlay: vi.fn() }}
            topbarProps={{ navigation: ADMIN_OCC_NAVIGATION, user: USER, onOpenMenu: vi.fn(), onLogout: vi.fn() }}>
            <button type="button">Primera acción de la pantalla</button>
          </ShellFrame>
        </OccShellTestProvider>
      </LanguageScope>
    );
  }

  it('the first Tab stop is Saltar al contenido and it moves focus to main-content', async () => {
    window.history.replaceState({}, '', `/admin-occ/dashboard${STATION_QUERY}`);
    const user = userEvent.setup();
    render(frame());

    await user.tab();
    const skip = screen.getByRole('link', { name: 'Saltar al contenido' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main-content');
    // The first element of the frame's root, so it also takes the OCC tokens.
    const root = document.querySelector('[data-shell-root]');
    expect(root.firstElementChild).toBe(skip);
    expect(skip.closest('[data-department="occ"]')).toBe(root);
    // Hidden until it has focus.
    expect(skip).toHaveClass('sr-only', 'focus:not-sr-only');

    await user.keyboard('{Enter}');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveFocus();
    expect(main).toHaveAttribute('tabindex', '-1');
    // The URL keeps the screen's query and gains no fragment.
    expect(window.location.pathname + window.location.search).toBe(`/admin-occ/dashboard${STATION_QUERY}`);
    expect(window.location.hash).toBe('');

    // The next Tab stop is the screen's first control, past the rail and the status bar; main gives tabindex back.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Primera acción de la pantalla' })).toHaveFocus();
    expect(main).not.toHaveAttribute('tabindex');
  });

  it('is named in the active language', async () => {
    resetLanguageForTests('en');
    const user = userEvent.setup();
    render(frame());
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
  });
});
