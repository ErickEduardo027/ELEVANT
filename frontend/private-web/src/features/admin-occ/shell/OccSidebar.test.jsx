import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { ADMIN_OCC_NAVIGATION } from '../navigation';
import OccSidebar from './OccSidebar';

afterEach(() => {
  resetLanguageForTests();
  window.history.replaceState({}, '', '/');
});

it.each([
  ['es', 'Operación', 'Mis gastos', 'desktop'],
  ['en', 'Operations', 'My expenses', 'mobile'],
])('shows OCC expenses in %s under %s', (language, section, label, breakpoint) => {
  resetLanguageForTests(language);
  window.history.replaceState({}, '', '/admin-occ/expenses');

  render(
    <LanguageScope>
      <OccSidebar navigation={ADMIN_OCC_NAVIGATION} user={{ name: 'Alex Operations' }}
        breakpoint={breakpoint} railVisible={breakpoint === 'desktop'} railExpanded
        overlayOpen={breakpoint === 'mobile'} onToggle={vi.fn()} onCloseOverlay={vi.fn()} />
    </LanguageScope>,
  );

  const group = screen.getByText(section).parentElement;
  const link = within(group).getByRole('link', { name: label });
  expect(link).toHaveAttribute('href', '/admin-occ/expenses');
  expect(link).toHaveAttribute('aria-current', 'page');
});
