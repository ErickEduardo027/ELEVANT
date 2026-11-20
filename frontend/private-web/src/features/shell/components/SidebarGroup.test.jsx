import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

  describe('long labels (N37)', () => {
    const LONG_ITEM = 'Trazabilidad y validaciones de acceso';
    const LONG_CHILD = 'Usuarios internos y sub-usuarios del departamento';
    const long = { ...item, label: LONG_ITEM, children: [{ id: 'clients', label: 'Clientes' },
      { id: 'internal', label: LONG_CHILD }] };
    /** Up to two lines, then «…», with the whole label on hover; never cut on one line. */
    const expectTwoLines = (text, label) => {
      expect(text).toHaveAttribute('title', label);
      expect(text).toHaveClass('line-clamp-2');
      expect(text).not.toHaveClass('truncate');
    };

    it('writes the group and each item on up to two lines in an expanded rail', () => {
      render(<SidebarGroup item={long} expanded useModuleNavigation activeModuleId="internal" onSelectModule={vi.fn()} />);
      const toggle = screen.getByRole('button', { name: LONG_ITEM });
      expectTwoLines(within(toggle).getByText(LONG_ITEM), LONG_ITEM);
      expectTwoLines(within(screen.getByRole('button', { name: LONG_CHILD })).getByText(LONG_CHILD), LONG_CHILD);
      expectTwoLines(screen.getByText('Clientes'), 'Clientes');
      // The buttons keep the label as their name; only the text carries the title.
      expect(toggle).not.toHaveAttribute('title');
    });

    it('writes each item of the flyout on up to two lines in a collapsed rail', async () => {
      render(<SidebarGroup item={long} expanded={false} useModuleNavigation activeModuleId="home" onSelectModule={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: LONG_ITEM }));
      const entry = screen.getByRole('menuitem', { name: LONG_CHILD });
      expectTwoLines(within(entry).getByText(LONG_CHILD), LONG_CHILD);
      expect(entry).not.toHaveAttribute('title');
    });
  });
});
