import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from './Sidebar';
import { LayoutGridIcon } from './icons';
import { ChecklistIcon } from '../../dashboard/components/icons';

const MODULES = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGridIcon },
  { id: 'approvals', label: 'Aprobaciones', icon: ChecklistIcon },
];

const USER = { name: 'Laisha Ramírez', role: 'Administrador OCC' };

function baseProps(overrides = {}) {
  return {
    modules: MODULES,
    activeModuleId: 'dashboard',
    onSelectModule: () => {},
    user: USER,
    onLogout: () => {},
    breakpoint: 'desktop',
    railVisible: true,
    railExpanded: true,
    overlayOpen: false,
    onToggle: () => {},
    onCloseOverlay: () => {},
    ...overrides,
  };
}

describe('Sidebar', () => {
  it('renders every module label when the rail is expanded', () => {
    render(<Sidebar {...baseProps()} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Aprobaciones')).toBeInTheDocument();
  });

  it('marks the active module and highlights a different one when selected', () => {
    render(<Sidebar {...baseProps({ activeModuleId: 'approvals' })} />);
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Aprobaciones').closest('button')).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByText('Dashboard').closest('button')).not.toHaveAttribute('aria-current');
  });

  it('calls onSelectModule with the clicked module id', async () => {
    const onSelectModule = vi.fn();
    render(<Sidebar {...baseProps({ onSelectModule })} />);
    await userEvent.click(screen.getByText('Aprobaciones'));
    expect(onSelectModule).toHaveBeenCalledWith('approvals');
  });

  it('shows a badge count on a module when provided', () => {
    render(<Sidebar {...baseProps({ badgeCounts: { approvals: 4 } })} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('calls onToggle when the collapse button is clicked on desktop', async () => {
    const onToggle = vi.fn();
    render(<Sidebar {...baseProps({ onToggle })} />);
    await userEvent.click(screen.getByRole('button', { name: /contraer barra lateral/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('calls onLogout from the footer user menu logout action', async () => {
    const onLogout = vi.fn();
    render(<Sidebar {...baseProps({ onLogout })} />);
    await userEvent.click(screen.getByRole('button', { name: /laisha/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /cerrar sesi/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('collapses every item to an icon with only a hover tooltip for its label', () => {
    render(<Sidebar {...baseProps({ railExpanded: false })} />);
    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('tooltip')).toHaveLength(MODULES.length);
    expect(within(nav).getByRole('tooltip', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('closes the overlay when the backdrop is clicked on tablet/mobile', async () => {
    const onCloseOverlay = vi.fn();
    render(
      <Sidebar
        {...baseProps({ breakpoint: 'tablet', railExpanded: false, overlayOpen: true, onCloseOverlay })}
      />
    );
    const backdrop = document.querySelector('[aria-hidden="false"].fixed.inset-0');
    await userEvent.click(backdrop);
    expect(onCloseOverlay).toHaveBeenCalledTimes(1);
  });
});
