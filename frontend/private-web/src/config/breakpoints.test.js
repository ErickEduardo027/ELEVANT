import { expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config.js';
import { BREAKPOINTS, MEDIA_QUERIES, belowBreakpoint } from './breakpoints';

it('feeds Tailwind the same screens the JS breakpoints use', () => {
  expect(tailwindConfig.theme.screens).toEqual(
    Object.fromEntries(Object.entries(BREAKPOINTS).map(([name, px]) => [name, `${px}px`])),
  );
  expect(tailwindConfig.theme.screens['3xl']).toBe('1920px');
});

it('ends "below" queries just before the matching Tailwind min-width', () => {
  expect(belowBreakpoint('sm')).toBe('(max-width: 639.98px)');
  expect(MEDIA_QUERIES.mobile).toBe('(max-width: 639.98px)');
  expect(MEDIA_QUERIES.belowMd).toBe('(max-width: 767.98px)');
  expect(MEDIA_QUERIES.belowDesktop).toBe('(max-width: 1023.98px)');
});
