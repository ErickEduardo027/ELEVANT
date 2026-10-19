import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(screen.getByRole('button', { name: 'Pausar carrusel de aerolíneas' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('lets the user pause and resume the logo movement explicitly', async () => {
    const user = userEvent.setup();
    const { container } = render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: 'Pausar carrusel de aerolíneas' }));
    expect(container.querySelector('.elv-marquee')).toHaveAttribute('data-paused', 'true');
    expect(screen.getByRole('button', { name: 'Reanudar carrusel de aerolíneas' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Reanudar carrusel de aerolíneas' }));
    expect(container.querySelector('.elv-marquee')).toHaveAttribute('data-paused', 'false');
  });
});

describe('login intro', () => {
  beforeEach(resetLoginIntroForTests);
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('plays once per page and can be skipped by clicking', async () => {
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

  it('waits for the logo before starting its visible animation', () => {
    vi.useFakeTimers();
    const { container } = render(<LoginIntro marks={<img src="/delayed-logo.png" alt="" />} />);
    expect(container.querySelector('.elv-intro-screen')).not.toBeVisible();
    act(() => vi.advanceTimersByTime(4000));
    const image = container.querySelector('img');
    Object.defineProperty(image, 'naturalWidth', { value: 560 });
    fireEvent.load(image);
    expect(container.querySelector('.elv-intro-screen')).toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector('.elv-intro-screen')).toBeVisible();
    act(() => vi.advanceTimersByTime(2000));
    expect(container.querySelector('.elv-intro-screen')).toBeNull();
  });

  it('does not interrupt someone already interacting while the logo loads', () => {
    const { container } = render(<LoginIntro marks={<img src="/delayed-logo.png" alt="" />} />);
    fireEvent.pointerDown(document.body);
    const image = container.querySelector('img');
    if (image) fireEvent.load(image);
    expect(container.querySelector('.elv-intro-screen')).toBeNull();
  });

  it('does not interrupt click-only assistive technology activation', () => {
    const { container } = render(<LoginIntro marks={<img src="/delayed-logo.png" alt="" />} />);
    fireEvent.click(document.body);
    expect(container.querySelector('.elv-intro-screen')).toBeNull();
  });

  it('ignores the previous release session flag on a fresh page', () => {
    sessionStorage.setItem('elevant-private-intro-seen', '1');
    const { container } = render(<LoginIntro marks={<span />} />);
    expect(container.querySelector('.elv-intro-screen')).toBeVisible();
    sessionStorage.removeItem('elevant-private-intro-seen');
  });

  it.each([true, false])('plays the welcome automatically when reduced motion is %s', reduced => {
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
    const { container } = render(<LoginIntro marks={<span />} />);
    expect(container.querySelector('.elv-intro-screen')).toBeVisible();
  });

  it('leaves the login available if the brand image fails', () => {
    const { container } = render(<LoginIntro marks={<img src="/missing-logo.png" alt="" />} />);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('.elv-intro-screen')).toBeNull();
  });
});
