import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractListDownloads from './ContractListDownloads';
import { exportContractsList } from '../../../services/contractsReportsService';
import { downloadFile } from '../../../utils/downloadFile';

vi.mock('../../../services/contractsReportsService', () => ({ exportContractsList: vi.fn() }));
vi.mock('../../../utils/downloadFile', () => ({ downloadFile: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('downloads the list as PDF and as Excel side by side', async () => {
  const blob = new Blob(['pdf']);
  exportContractsList.mockResolvedValue({ blob, fileName: 'elevant-contratos-y-vigencias-2026-11-21.pdf' });
  render(<ContractListDownloads filters={{ status: 'Active' }} />);
  const group = screen.getByRole('group', { name: 'Descargas del listado de contratos' });
  expect(group).toContainElement(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(group).toContainElement(screen.getByRole('button', { name: 'Descargar Excel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(exportContractsList).toHaveBeenCalledWith('pdf', { status: 'Active' });
  expect(downloadFile).toHaveBeenCalledWith(blob, 'elevant-contratos-y-vigencias-2026-11-21.pdf');
  await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
  expect(exportContractsList).toHaveBeenLastCalledWith('xlsx', { status: 'Active' });
});

it('explains a refused download without raw error text', async () => {
  exportContractsList.mockRejectedValue(Object.assign(new Error('System.InvalidOperationException at ...'), { status: 403 }));
  render(<ContractListDownloads />);
  await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para descargar este reporte.');
  expect(screen.queryByText(/InvalidOperation/)).not.toBeInTheDocument();
});

it('disables the downloads while one is being prepared', async () => {
  let finish;
  exportContractsList.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<ContractListDownloads />);
  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(screen.getByRole('button', { name: 'Preparando PDF…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeDisabled();
  finish({ blob: new Blob(['x']), fileName: 'f.pdf' });
  expect(await screen.findByRole('button', { name: 'Descargar PDF' })).toBeEnabled();
});
