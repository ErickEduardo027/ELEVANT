import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import PresencePeople from './PresencePeople';
import PresenceStatusPicker from './PresenceStatusPicker';
import { resolvePresence } from './presenceStatus';

const client = vi.hoisted(() => ({ getOwnOperationalPresence: vi.fn(), putOwnOperationalPresenceStatus: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: { accountId: 'self', token: 'synthetic-token' } }) }));
vi.mock('../auth/requestForAuthSession', () => ({ requestForAuthSession: operation => operation(client) }));

beforeEach(() => {
  client.getOwnOperationalPresence.mockReset().mockResolvedValue({ state: 'active', availability: null, message: null });
  client.putOwnOperationalPresenceStatus.mockReset().mockImplementation(async status => ({ state: 'active', ...status }));
});
afterEach(() => { cleanup(); act(() => resetLanguageForTests('es')); });

const person = (accountId, name, state, availability = null, message = null) =>
  ({ accountId, name, role: 'agent', state, lastActivityAt: null, availability, message });

it('separates connection from chosen availability and never invents a status', () => {
  expect(resolvePresence(person('a', 'A', 'active'))).toBe('available');
  expect(resolvePresence(person('a', 'A', 'away'))).toBe('away');
  expect(resolvePresence(person('a', 'A', 'active', 'doNotDisturb'))).toBe('doNotDisturb');
  expect(resolvePresence(person('a', 'A', 'offline', 'busy'))).toBe('offline');
  expect(resolvePresence(person('a', 'A', 'active', 'appearOffline'))).toBe('offline');
  expect(resolvePresence(person('a', 'A', 'unknown'))).toBe('unknown');
  expect(resolvePresence(undefined)).toBe('unknown');
});

it('shows each participant with an indicator, label and only the message they set', () => {
  render(<LanguageScope><PresencePeople participants={[
    person('self', 'Yo Mismo', 'active', 'busy'),
    person('b', 'Bea Rampa', 'active', 'beRightBack', 'Atendiendo operaciones de Arajet'),
    person('c', 'Carlos Pista', 'offline'),
  ]} /></LanguageScope>);
  expect(screen.queryByText('Yo Mismo')).not.toBeInTheDocument();
  expect(screen.getByText('Vuelvo enseguida')).toBeInTheDocument();
  expect(screen.getByText('Atendiendo operaciones de Arajet')).toBeInTheDocument();
  expect(screen.getByText('Desconectado')).toBeInTheDocument();
  expect(document.querySelector('[data-presence="beRightBack"] [data-presence="beRightBack"]')).not.toBeNull();
});

it('keeps a neutral fallback when there is no presence information', () => {
  render(<LanguageScope><PresencePeople participants={[]} /></LanguageScope>);
  expect(screen.getByText('Sin información de presencia')).toBeInTheDocument();
  expect(screen.queryByText(/Disponible|Desconectado/)).not.toBeInTheDocument();
});

it('lets the user choose their own status and message through the API', async () => {
  render(<LanguageScope><PresenceStatusPicker /></LanguageScope>);
  const trigger = await screen.findByRole('button', { name: 'Mi estado: Disponible' });
  await waitFor(() => expect(trigger).toBeEnabled());
  await userEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Mi estado' });
  await userEvent.click(within(dialog).getByRole('radio', { name: 'No molestar' }));
  expect(client.putOwnOperationalPresenceStatus).toHaveBeenLastCalledWith({ availability: 'doNotDisturb', message: null });
  await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'No molestar' })).toHaveAttribute('aria-checked', 'true'));
  await userEvent.type(within(dialog).getByLabelText('Mensaje de estado'), 'Atendiendo operaciones de Arajet');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar mensaje' }));
  expect(client.putOwnOperationalPresenceStatus).toHaveBeenLastCalledWith({ availability: 'doNotDisturb', message: 'Atendiendo operaciones de Arajet' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Restablecer estado automático' }));
  expect(client.putOwnOperationalPresenceStatus).toHaveBeenLastCalledWith({ availability: null, message: 'Atendiendo operaciones de Arajet' });
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('hides the selector when the account cannot publish presence', async () => {
  client.getOwnOperationalPresence.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
  const { container } = render(<LanguageScope><PresenceStatusPicker /></LanguageScope>);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
