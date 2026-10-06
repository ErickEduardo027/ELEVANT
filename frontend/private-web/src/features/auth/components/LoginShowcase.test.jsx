import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import LoginPage from '../LoginPage';
import LoginIntro, { resetLoginIntroForTests } from './LoginIntro';

describe('airline carousel', () => {
  it('exposes one accessible set of airlines and hides the looping duplicate', () => {
    render(<LoginPage />);

    const region = screen.getByRole('complementary', { name: 'Aerolíneas con las que operamos' });
    const names = ['American Airlines', 'United Airlines', 'Delta Air Lines', 'JetBlue', 'Avianca', 'Iberia'];
    names.forEach(name => expect(screen.getAllByRole('img', { name })).toHaveLength(1));
    expect(region.querySelectorAll('ul')).toHaveLength(2);
    expect(region.querySelectorAll('ul[aria-hidden="true"] img[alt=""]')).toHaveLength(names.length);
    expect(region.querySelector('a, button, [tabindex]')).toBeNull();
  });
});

describe('login intro', () => {
  beforeEach(resetLoginIntroForTests);

  it('plays once per session and can be skipped by clicking', async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<LoginIntro marks={<span />} />);
    const screenEl = container.querySelector('.elv-intro-screen');
    expect(screenEl).toBeInTheDocument();
    expect(screenEl).toHaveAttribute('aria-hidden', 'true');

    await user.pointer({ keys: '[MouseLeft]', target: screenEl });
    expect(container.querySelector('.elv-intro-screen')).toBeNull();
    unmount();

    const again = render(<LoginIntro marks={<span />} />);
    expect(again.container.querySelector('.elv-intro-screen')).toBeNull();
  });
});