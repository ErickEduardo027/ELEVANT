import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportTabs from './ReportTabs';

describe('ReportTabs', () => {
  it('renders the default REPORT_TABS and marks the active one', () => {
    render(<ReportTabs active="closure" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Cierre operacional' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders a custom tabs prop instead of the default catalog', () => {
    const customTabs = [
      { id: 'a', label: 'Reporte A' },
      { id: 'b', label: 'Reporte B' },
    ];
    render(<ReportTabs tabs={customTabs} active="a" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Reporte A' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Cierre operacional' })).not.toBeInTheDocument();
  });

  it('calls onChange with the clicked tab id', async () => {
    const customTabs = [
      { id: 'a', label: 'Reporte A' },
      { id: 'b', label: 'Reporte B' },
    ];
    const onChange = vi.fn();
    render(<ReportTabs tabs={customTabs} active="a" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Reporte B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});