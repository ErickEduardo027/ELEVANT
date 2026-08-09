import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportButton from './ExportButton';
import * as reportsService from '../../../services/reportsService';

describe('ExportButton', () => {
  it('opens a menu with PDF and Excel options', async () => {
    render(<ExportButton reportId="closure" />);
    await userEvent.click(screen.getByRole('button', { name: /exportar/i }));
    expect(screen.getByRole('menuitem', { name: 'PDF' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Excel' })).toBeInTheDocument();
  });

  it('walks through generating -> completed and calls onExported with the result', async () => {
    const onExported = vi.fn();
    render(<ExportButton reportId="closure" onExported={onExported} />);

    await userEvent.click(screen.getByRole('button', { name: /exportar/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'PDF' }));

    expect(screen.getByRole('button', { name: /generando/i })).toBeInTheDocument();
    expect(screen.getByTestId('export-spinner')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: /completado/i })).toBeInTheDocument(), { timeout: 2000 });
    expect(onExported).toHaveBeenCalledWith(expect.objectContaining({ format: 'pdf', fileName: expect.stringMatching(/\.pdf$/) }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^exportar$/i })).toBeInTheDocument(), { timeout: 3000 });
  });

  it('shows an error state and calls onExportError when the export fails', async () => {
    vi.spyOn(reportsService, 'exportReport').mockRejectedValueOnce(new Error('falló'));
    const onExportError = vi.fn();
    render(<ExportButton reportId="closure" onExportError={onExportError} />);

    await userEvent.click(screen.getByRole('button', { name: /exportar/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Excel' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument(), { timeout: 2000 });
    expect(onExportError).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it('disables the trigger while generating', async () => {
    render(<ExportButton reportId="closure" />);
    await userEvent.click(screen.getByRole('button', { name: /exportar/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'PDF' }));
    expect(screen.getByRole('button', { name: /generando/i })).toBeDisabled();
  });
});
