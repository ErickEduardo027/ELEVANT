import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidebarGroup from './SidebarGroup';
import { UsersIcon } from './icons';

vi.mock('next/navigation', () => ({ usePathname: () => '/superadmin' }));

const item = { id: 'users', label: 'Usuarios', icon: UsersIcon, children: [
  { id: 'clients', label: 'Clientes' }, { id: 'internal', label: 'Usuarios internos' },
] };

afterEach(cleanup);

describe('SidebarGroup', () => {
  it('opens as a disclosure in an expanded rail and starts open when a child is active', async () => {
    const onSelect = vi.fn();
    render(<SidebarGroup item={item} expanded useModuleNavigation activeModuleId="internal" onSelectModule={onSelect} />);
    const toggle = screen.getByRole('button', { name: 'Usuarios' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Usuarios internos' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Clientes' }));
    expect(onSelect).toHaveBeenCalledWith('clients');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a flyout by tap or keyboard in a collapsed rail and closes it with Escape', async () => {
    const onSelect = vi.fn();
    render(<SidebarGroup item={item} expanded={false} useModuleNavigation activeModuleId="home" onSelectModule={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'Usuarios' });
    await userEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Usuarios' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    trigger.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Clientes' }));
    expect(onSelect).toHaveBeenCalledWith('clients');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
