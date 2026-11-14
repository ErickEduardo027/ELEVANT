import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import postcss from 'postcss';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { readSource } from '../../styles/occSourceScan';
import PresencePeople, { PresenceDot, PresenceLegend } from './PresencePeople';
import PresenceStatusPicker from './PresenceStatusPicker';
import { PRESENCE_LEGEND, PRESENCE_SHAPES, presenceMessages, presenceShape, resolvePresence } from './presenceStatus';

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

// vitest does not apply CSS Modules: the glyph is read through its attributes, and its colours from the stylesheet.
const PRESENCES = ['available', 'busy', 'doNotDisturb', 'beRightBack', 'away', 'offline', 'unknown'];
const dotColours = () => {
  const colours = {};
  postcss.parse(readSource('src/features/chat/PresencePeople.module.css')).walkRules(rule => {
    if (rule.parent?.type === 'atrule') return;
    for (const selector of rule.selectors) {
      if (!/^\.dot(?:\[|$)/.test(selector)) continue;
      rule.walkDecls('color', declaration => { colours[selector] = declaration.value; });
    }
  });
  return colours;
};

it('draws presence by shape, not hue: available filled, busy filled with a bar, away half, offline hollow', () => {
  expect(PRESENCE_SHAPES).toEqual({ available: 'filled', busy: 'filled-bar', doNotDisturb: 'filled-bar',
    beRightBack: 'half', away: 'half', offline: 'hollow', unknown: 'dashed' });
  expect(Object.isFrozen(PRESENCE_SHAPES)).toBe(true);
  // Every presence resolvePresence gives has its shape; a typo throws instead of drawing a silent dot.
  expect(PRESENCES.map(presenceShape)).toEqual(PRESENCES.map(presence => PRESENCE_SHAPES[presence]));
  expect(() => presenceShape('busyish')).toThrow(RangeError);
  expect(() => render(<PresenceDot presence="green" />)).toThrow(RangeError);
  cleanup();

  const { container } = render(<>{PRESENCES.map(presence => <PresenceDot key={presence} presence={presence} />)}</>);
  const dot = presence => container.querySelector(`[data-presence="${presence}"]`);
  const drawing = presence => [...dot(presence).querySelectorAll('[data-part]')]
    .map(part => (part.dataset.fill ? `${part.dataset.part}:${part.dataset.fill}` : part.dataset.part));
  for (const presence of PRESENCES) {
    expect(dot(presence), presence).toHaveAttribute('data-shape', PRESENCE_SHAPES[presence]);
    // The glyph is decoration next to its word: assistive technology hears the word.
    expect(dot(presence), presence).toHaveAttribute('aria-hidden', 'true');
  }
  expect(drawing('available')).toEqual(['body:solid']);
  expect(drawing('busy')).toEqual(['body:solid', 'bar']);
  expect(drawing('doNotDisturb')).toEqual(['body:solid', 'bar']);
  expect(drawing('away')).toEqual(['body:outline', 'half']);
  expect(drawing('beRightBack')).toEqual(['body:outline', 'half']);
  expect(drawing('offline')).toEqual(['body:outline']);
  expect(drawing('unknown')).toEqual(['body:dashed']);
  // No part carries a colour of its own: the stylesheet paints them.
  expect(container.querySelectorAll('[fill^="#"], [stroke^="#"], [style*="fill"], [style*="color"]')).toHaveLength(0);

  // The colour only says how loud a state is, in the neutral tokens: never the green, amber or red of before.
  expect(dotColours()).toEqual({
    '.dot': 'var(--occ-text)',
    ".dot[data-shape='half']": 'var(--occ-muted)',
    ".dot[data-shape='hollow']": 'var(--occ-faint)',
    ".dot[data-shape='dashed']": 'var(--occ-faint)',
  });
});

it('the legend lists each shape with its word in Spanish and English', () => {
  expect(PRESENCE_LEGEND.map(entry => entry.shape)).toEqual(['filled', 'filled-bar', 'half', 'hollow', 'dashed']);
  // Each entry draws its shape with a presence of that shape.
  for (const { shape, presence } of PRESENCE_LEGEND) expect(PRESENCE_SHAPES[presence], shape).toBe(shape);
  for (const language of ['es', 'en']) {
    expect(Object.keys(presenceMessages[language].legend.shapes), language).toEqual(PRESENCE_LEGEND.map(entry => entry.shape));
  }

  const { unmount } = render(<LanguageScope><PresenceLegend /></LanguageScope>);
  const legend = screen.getByRole('list', { name: 'Presencia' });
  expect(within(legend).getAllByRole('listitem').map(item => item.textContent)).toEqual([
    'Disponible', 'Ocupado o no molestar', 'Ausente o vuelvo enseguida', 'Desconectado', 'Sin información',
  ]);
  expect(within(legend).getAllByRole('listitem').map(item => item.querySelector('[data-shape]').dataset.shape))
    .toEqual(['filled', 'filled-bar', 'half', 'hollow', 'dashed']);
  unmount();

  act(() => resetLanguageForTests('en'));
  render(<LanguageScope><PresenceLegend /></LanguageScope>);
  expect(within(screen.getByRole('list', { name: 'Presence' })).getAllByRole('listitem').map(item => item.textContent))
    .toEqual(['Available', 'Busy or do not disturb', 'Away or be right back', 'Offline', 'No information']);
});
