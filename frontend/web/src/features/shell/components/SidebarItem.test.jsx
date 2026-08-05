import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidebarItem from './SidebarItem';
import { LayoutGridIcon } from './icons';

describe('SidebarItem', () => {
  it('renders the label when expanded', () => {
    render(<SidebarItem icon={LayoutGridIcon} label="Dashboard" expanded onClick={() => {}} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('hides the visible label when collapsed but keeps it in a hover tooltip', () => {
    render(<SidebarItem icon={LayoutGridIcon} label="Dashboard" expanded={false} onClick={() => {}} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Dashboard');
  });

  it('marks the active item with aria-current', () => {
    render(<SidebarItem icon={LayoutGridIcon} label="Dashboard" active expanded onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'page');
  });

  it('calls onClick when pressed', async () => {
    const onClick = vi.fn();
    render(<SidebarItem icon={LayoutGridIcon} label="Dashboard" expanded onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows a badge only when the count is greater than zero', () => {
    const { rerender } = render(
      <SidebarItem icon={LayoutGridIcon} label="Aprobaciones" expanded badge={0} onClick={() => {}} />
    );
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    rerender(<SidebarItem icon={LayoutGridIcon} label="Aprobaciones" expanded badge={4} onClick={() => {}} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
