import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { AccessGate, DepartmentAccessProvider } from './DepartmentAccessContext';

afterEach(() => act(() => resetLanguageForTests('es')));

it('reads the global language for loading without resetting document language', () => {
  act(() => resetLanguageForTests('en'));
  const documentLanguage = document.documentElement.lang;
  render(<DepartmentAccessProvider observe={false} load={() => new Promise(() => {})}>
    <AccessGate><p>Authorized content</p></AccessGate>
  </DepartmentAccessProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('Loading permissions…');
  act(() => resetLanguageForTests('es'));
  expect(screen.getByRole('status')).toHaveTextContent('Cargando permisos…');
  expect(document.documentElement.lang).toBe(documentLanguage);
  expect(screen.queryByText('Authorized content')).not.toBeInTheDocument();
});

it('offers a translated safe error and retries the existing access loader', async () => {
  act(() => resetLanguageForTests('en'));
  const documentLanguage = document.documentElement.lang;
  const load = vi.fn().mockRejectedValueOnce(new Error('Internal provider exception details'))
    .mockResolvedValueOnce({ kind: 'Administrator', permissions: [], stations: [] });
  const user = userEvent.setup();
  render(<DepartmentAccessProvider observe={false} load={load}>
    <AccessGate><p>Authorized content</p></AccessGate>
  </DepartmentAccessProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Your permissions could not be loaded.');
  expect(screen.queryByText('Internal provider exception details')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Authorized content')).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(2);
  expect(document.documentElement.lang).toBe(documentLanguage);
});
