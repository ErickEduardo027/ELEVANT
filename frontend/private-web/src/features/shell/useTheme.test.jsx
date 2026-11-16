import { StrictMode, useEffect, useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePathname } from 'next/navigation';
import { ThemeProvider, useOptionalTheme, useTheme } from './useTheme';

const STORAGE_KEY = 'elevant-theme';
const OCC_ROUTE = '/admin-occ/dashboard';
const HR_ROUTE = '/gestion-humana/dashboard';

const htmlIsDark = () => document.documentElement.classList.contains('dark');
const storedTheme = () => window.localStorage.getItem(STORAGE_KEY);
const startAt = path => window.history.replaceState({}, '', path);
// Client-side navigation: the provider stays mounted and only the route changes.
const navigate = path => act(() => { globalThis.__nextRouterMock.push(path); });

function resetBrowser() {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  startAt('/');
}

// The button shows the theme a screen receives and toggles it, as a top bar does.
function ThemeButton({ onRender }) {
  const { theme, toggleTheme } = useTheme();
  onRender?.(theme);
  return <button type="button" onClick={toggleTheme}>{theme}</button>;
}

function renderTheme({ onRender, children } = {}) {
  return render(<ThemeProvider><ThemeButton onRender={onRender} />{children}</ThemeProvider>);
}

beforeEach(resetBrowser);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetBrowser();
});

describe('ThemeProvider inside the OCC', () => {
  it('is dark on an OCC route when nothing valid is stored, whatever the system prefers', () => {
    vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: false, media: query })));

    for (const route of ['/admin-occ', OCC_ROUTE, '/admin-occ/review/operations/42']) {
      for (const value of ['dark', 'sepia', null]) {
        resetBrowser();
        if (value !== null) window.localStorage.setItem(STORAGE_KEY, value);
        startAt(route);
        const onRender = vi.fn();
        const view = renderTheme({ onRender });

        expect(screen.getByRole('button'), `${route} with ${value}`).toHaveTextContent('dark');
        expect(htmlIsDark(), `${route} with ${value}`).toBe(true);
        expect(onRender.mock.calls.map(([theme]) => theme).filter(theme => theme !== 'dark')).toEqual([]);
        view.unmount();
      }
    }
  });

  it('applies a stored light theme on an OCC route', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    startAt(OCC_ROUTE);
    renderTheme();

    expect(screen.getByRole('button')).toHaveTextContent('light');
    expect(htmlIsDark()).toBe(false);
  });

  it('toggles the theme on an OCC route and stores the choice for every department', async () => {
    startAt(OCC_ROUTE);
    renderTheme();
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('dark');

    await userEvent.click(button);
    expect(button).toHaveTextContent('light');
    expect(htmlIsDark()).toBe(false);
    expect(storedTheme()).toBe('light');

    navigate(HR_ROUTE);
    expect(button).toHaveTextContent('light');

    navigate(OCC_ROUTE);
    await userEvent.click(button);
    expect(button).toHaveTextContent('dark');
    expect(htmlIsDark()).toBe(true);
    expect(storedTheme()).toBe('dark');
  });

  it('does not store the dark default of the OCC', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    startAt(OCC_ROUTE);
    renderTheme();
    navigate('/admin-occ/planning');

    expect(setItem.mock.calls.filter(([key]) => key === STORAGE_KEY)).toEqual([]);
    expect(storedTheme()).toBeNull();
  });

  it('adds the dark class before any effect runs when the route enters the OCC', () => {
    vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: false, media: query })));
    startAt(HR_ROUTE);
    const seen = [];
    function ScreenEffect() {
      const pathname = usePathname();
      useEffect(() => { seen.push([pathname, htmlIsDark()]); }, [pathname]);
      return null;
    }
    renderTheme({ children: <ScreenEffect /> });

    navigate(OCC_ROUTE);

    expect(seen).toEqual([[HR_ROUTE, false], [OCC_ROUTE, true]]);
  });

  it('puts the dark class back when something else removed it before the route enters the OCC', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    startAt('/superadmin');
    renderTheme();
    expect(htmlIsDark()).toBe(true);

    // The Contracts, Finance and Governance shells still switch the class on their own.
    document.documentElement.classList.remove('dark');
    navigate(OCC_ROUTE);

    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(htmlIsDark()).toBe(true);
  });

  it('puts the dark class back after the Strict Mode remount clears it', () => {
    startAt(OCC_ROUTE);
    // Stands in for React resetting the attributes of <html> during a development remount,
    // which drops the class the boot script added (Next guide: preventing flash before hydration).
    function HtmlReset() {
      useLayoutEffect(() => () => { document.documentElement.classList.remove('dark'); }, []);
      return null;
    }

    render(<StrictMode><ThemeProvider><HtmlReset /><ThemeButton /></ThemeProvider></StrictMode>);

    expect(htmlIsDark()).toBe(true);
  });
});

describe('ThemeProvider outside the OCC', () => {
  it('outside the OCC it applies the stored theme, toggles it and stores the choice', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    startAt(HR_ROUTE);
    renderTheme();
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('dark');
    expect(htmlIsDark()).toBe(true);
    expect(storedTheme()).toBe('dark');

    await userEvent.click(button);
    expect(button).toHaveTextContent('light');
    expect(htmlIsDark()).toBe(false);
    expect(storedTheme()).toBe('light');

    await userEvent.click(button);
    expect(button).toHaveTextContent('dark');
    expect(htmlIsDark()).toBe(true);
    expect(storedTheme()).toBe('dark');
  });

  it('keeps the stored theme through the Strict Mode remount', () => {
    // In development every effect runs twice: the second read must not take the value
    // the first pass has just written for the initial light render.
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    startAt(HR_ROUTE);

    render(<StrictMode><ThemeProvider><ThemeButton /></ThemeProvider></StrictMode>);

    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(htmlIsDark()).toBe(true);
    expect(storedTheme()).toBe('dark');
  });

  it('treats a route that only resembles the OCC prefix as any other department', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    startAt('/admin-occupancy');
    renderTheme();
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('light');
    expect(htmlIsDark()).toBe(false);

    await userEvent.click(button);
    expect(button).toHaveTextContent('dark');
    expect(storedTheme()).toBe('dark');
  });

  it('outside the OCC it follows the system preference when nothing is stored', () => {
    let prefersDark = true;
    vi.stubGlobal('matchMedia', vi.fn(query => ({
      matches: prefersDark && query === '(prefers-color-scheme: dark)', media: query,
    })));
    startAt(HR_ROUTE);
    const dark = renderTheme();
    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(htmlIsDark()).toBe(true);
    // A default is never stored: only a choice is.
    expect(storedTheme()).toBeNull();
    dark.unmount();

    resetBrowser();
    prefersDark = false;
    startAt(HR_ROUTE);
    renderTheme();
    expect(screen.getByRole('button')).toHaveTextContent('light');
    expect(htmlIsDark()).toBe(false);
    expect(storedTheme()).toBeNull();
  });

  it('outside the OCC the system preference is the default, in the OCC dark is', () => {
    vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: false, media: query })));
    startAt(HR_ROUTE);
    renderTheme();
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('light');
    expect(htmlIsDark()).toBe(false);

    navigate(OCC_ROUTE);
    expect(button).toHaveTextContent('dark');
    expect(htmlIsDark()).toBe(true);

    navigate('/finanzas');
    expect(button).toHaveTextContent('light');
    expect(htmlIsDark()).toBe(false);
    expect(storedTheme()).toBeNull();
  });

  it('a stored choice holds in every department, the OCC included', async () => {
    startAt(HR_ROUTE);
    window.localStorage.setItem(STORAGE_KEY, 'light');
    renderTheme();
    const button = screen.getByRole('button');

    navigate(OCC_ROUTE);
    expect(button).toHaveTextContent('light');
    expect(htmlIsDark()).toBe(false);

    navigate(HR_ROUTE);
    await userEvent.click(button);
    expect(storedTheme()).toBe('dark');
    navigate(OCC_ROUTE);
    expect(button).toHaveTextContent('dark');
    expect(htmlIsDark()).toBe(true);
  });
});

describe('theme hooks', () => {
  it('useTheme throws outside a ThemeProvider and useOptionalTheme returns null', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow('useTheme debe usarse dentro de un ThemeProvider');
    expect(renderHook(() => useOptionalTheme()).result.current).toBeNull();

    startAt(HR_ROUTE);
    const inside = renderHook(() => useOptionalTheme(), { wrapper: ThemeProvider });
    expect(inside.result.current).toEqual({ theme: 'light', toggleTheme: expect.any(Function) });
  });
});
