import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { ADMIN_OCC_NAVIGATION } from '../navigation';
import OccTopbar from './OccTopbar';
import { occShellMessages } from './occShellMessages';

const USER = { name: 'Alex Operations', role: 'Administrador / OCC' };

function topbar(props) {
  return (
    <LanguageScope>
      <OccTopbar navigation={ADMIN_OCC_NAVIGATION} user={USER} onOpenMenu={vi.fn()} onLogout={vi.fn()} {...props} />
    </LanguageScope>
  );
}

afterEach(() => {
  // Unmount first: resetting the language store notifies whatever is still mounted.
  cleanup();
  vi.useRealTimers();
  resetLanguageForTests();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

it('shows no theme button in Spanish or English', async () => {
  for (const language of ['es', 'en']) {
    resetLanguageForTests(language);
    // AppShell sends these two props to every top bar; the OCC bar has no use for them.
    const onToggleTheme = vi.fn();
    const view = render(topbar({ theme: 'dark', onToggleTheme }));

    expect(screen.queryByRole('button', { name: /modo|tema|oscuro|claro|mode|theme|dark|light/i }), language)
      .not.toBeInTheDocument();
    // No control of the bar reaches the handler either.
    for (const button of screen.getAllByRole('button')) await userEvent.click(button);
    expect(onToggleTheme, language).not.toHaveBeenCalled();

    expect(occShellMessages[language]).not.toHaveProperty('themeToDark');
    expect(occShellMessages[language]).not.toHaveProperty('themeToLight');
    view.unmount();
  }
});

it('keeps the language toggle, the UTC clock and the notifications badge', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T18:07:00Z'));
  window.history.replaceState({}, '', '/admin-occ/planning');
  const onOpenNotifications = vi.fn();
  const view = render(topbar({ notificationsCount: 3, onOpenNotifications }));

  // Language: two options with the active one pressed.
  const language = screen.getByRole('group', { name: 'Idioma' });
  expect(within(language).getByRole('button', { name: 'Español' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(language).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText('Planificación')).toBeInTheDocument();

  // UTC clock read from this device.
  const clock = screen.getByLabelText('Hora UTC según el reloj de este equipo: 18:07');
  expect(within(clock).getByText('18:07')).toHaveAttribute('datetime', '2026-11-12T18:07:00.000Z');

  // Notifications: the unread count is in the name and in the badge, and the bell opens them.
  const bell = screen.getByRole('button', { name: 'Notificaciones, 3 sin leer' });
  expect(within(bell).getByTestId('notifications-badge')).toHaveTextContent('3');
  await userEvent.click(bell);
  expect(onOpenNotifications).toHaveBeenCalledTimes(1);

  // Choosing the other language translates the bar.
  await userEvent.click(within(language).getByRole('button', { name: 'English' }));
  expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
  expect(screen.getByLabelText('UTC time from this device clock: 18:07')).toBeInTheDocument();
  expect(screen.getByText('Planning')).toBeInTheDocument();

  // The badge caps at 99+ and goes away with nothing unread.
  view.rerender(topbar({ notificationsCount: 140, onOpenNotifications }));
  expect(screen.getByTestId('notifications-badge')).toHaveTextContent('99+');
  view.rerender(topbar({ notificationsCount: 0, onOpenNotifications }));
  expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
});
