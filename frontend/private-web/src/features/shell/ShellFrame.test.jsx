import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ShellFrame from './ShellFrame';
import { LayoutGridIcon } from './components/icons';

const user = { name: 'Alex Operations', role: 'Administrador OCC' };
const station = { code: 'PUJ', localAbbr: 'AST', localTime: '2026-10-06T22:00:00-04:00', utcTime: '2026-10-07T02:00:00Z' };

function renderFrame() {
  return render(
    <ShellFrame
      mainKey="home"
      sidebarProps={{ modules: [{ id: 'home', label: 'Inicio', icon: LayoutGridIcon }], activeModuleId: 'home', user, breakpoint: 'desktop', railVisible: true, railExpanded: true, overlayOpen: false, onToggle: vi.fn(), onCloseOverlay: vi.fn() }}
      topbarProps={{ station, theme: 'light', onToggleTheme: vi.fn(), user, onOpenMenu: vi.fn(), onLogout: vi.fn() }}
    >
      <p>Contenido</p>
    </ShellFrame>,
  );
}

it('keeps one main landmark that scrolls inside a viewport-height frame', () => {
  const { container } = renderFrame();
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.getByRole('main')).toHaveTextContent('Contenido');
  expect(screen.getByRole('main')).toHaveClass('overflow-y-auto');
  expect(container.querySelector('[data-shell-root]')).toHaveClass('h-dvh', 'overflow-hidden');
});

it('keeps the user menu accessible by name when only initials are visible', () => {
  renderFrame();
  expect(screen.getByRole('button', { name: 'Alex Operations' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
});
