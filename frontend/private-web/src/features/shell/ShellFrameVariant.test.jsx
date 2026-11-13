import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ShellFrame from './ShellFrame';
import { LayoutGridIcon } from './components/icons';

// ShellFrame's `main` before `mainVariant` existed: the template literal ended in a space before mainClassName.
const TODAY_MAIN = 'min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 [animation:elevant-fade-in_180ms_ease-out] sm:p-6 3xl:px-10';
const user = { name: 'Alex Operations', role: 'Administrador OCC' };
const station = { code: 'PUJ', localAbbr: 'AST', localTime: '2026-10-06T22:00:00-04:00', utcTime: '2026-10-07T02:00:00Z' };

// The default rail and top bar of every other department, as ShellFrame.test.jsx renders them.
function renderFrame(frameProps = {}) {
  return render(
    <ShellFrame
      mainKey="home"
      sidebarProps={{ modules: [{ id: 'home', label: 'Inicio', icon: LayoutGridIcon }], activeModuleId: 'home', user, breakpoint: 'desktop', railVisible: true, railExpanded: true, overlayOpen: false, onToggle: vi.fn(), onCloseOverlay: vi.fn() }}
      topbarProps={{ station, theme: 'light', onToggleTheme: vi.fn(), user, onOpenMenu: vi.fn(), onLogout: vi.fn() }}
      {...frameProps}
    >
      <p>Contenido</p>
    </ShellFrame>,
  );
}

afterEach(cleanup);

it("renders exactly today's main classes by default", () => {
  const { unmount } = renderFrame();
  expect(screen.getByRole('main').getAttribute('class')).toBe(`${TODAY_MAIN} `);
  unmount();

  // Asking for 'scroll' is the same, and a department's own classes still follow.
  renderFrame({ mainVariant: 'scroll', mainClassName: 'pb-24' });
  expect(screen.getByRole('main').getAttribute('class')).toBe(`${TODAY_MAIN} pb-24`);
  expect(screen.getByRole('main')).toHaveTextContent('Contenido');
});

it('fill removes the padding and the scroll', () => {
  renderFrame({ mainVariant: 'fill', mainClassName: 'bg-occ-canvas' });
  const main = screen.getByRole('main');
  // A full-height screen, such as a map, fills the space under the top bar and scrolls nothing itself.
  expect([...main.classList]).toEqual(['min-w-0', 'flex-1', 'overflow-hidden', '[animation:elevant-fade-in_180ms_ease-out]', 'bg-occ-canvas']);
  for (const gone of ['overflow-y-auto', 'overscroll-contain', 'p-4', 'sm:p-6', '3xl:px-10']) expect(main).not.toHaveClass(gone);
  // It is still the one main landmark, where the skip link of the OCC lands.
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(main).toHaveAttribute('id', 'main-content');
  expect(main).toHaveTextContent('Contenido');
});

it('other departments get no new attributes', () => {
  for (const frameProps of [{}, { mainVariant: 'scroll' }, { mainVariant: 'fill' }]) {
    const { container, unmount } = renderFrame(frameProps);
    const variant = frameProps.mainVariant ?? 'default';
    expect(container.querySelector('[data-shell-root]').getAttributeNames().sort(), variant)
      .toEqual(['class', 'data-shell-root']);
    expect(screen.getByRole('main').getAttributeNames().sort(), variant).toEqual(['class', 'data-shell-main', 'id']);
    unmount();
  }
});

it('rejects a main variant it does not know', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(() => renderFrame({ mainVariant: 'full' })).toThrow(RangeError);
  } finally {
    consoleError.mockRestore();
  }
});
