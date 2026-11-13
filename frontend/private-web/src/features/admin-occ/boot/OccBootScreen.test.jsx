import { isInaccessible, render, screen, within } from '@testing-library/react';
import postcss from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
import { readSource } from '../../../styles/occSourceScan';
import { OCC_BOOT_EXIT_MS, OCC_BOOT_READY_TIMEOUT_MS } from './occBootMachine';
import OccBootScreen, { OCC_BOOT_ISOTYPE_SRC } from './OccBootScreen';

// vitest does not apply CSS Modules, so the screen's markup is read here through its attributes, and its stylesheet as
// the source it is: every rule with its selector, its declarations and the @media around it.
const STYLESHEET = 'src/features/admin-occ/boot/OccBootScreen.module.css';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function rulesOf(css) {
  const rules = [];
  postcss.parse(css).walkRules(rule => {
    if (rule.parent?.type === 'atrule' && rule.parent.name.endsWith('keyframes')) return;
    const media = rule.parent?.type === 'atrule' && rule.parent.name === 'media' ? rule.parent.params : null;
    const declarations = {};
    rule.walkDecls(declaration => {
      declarations[declaration.prop] = declaration.important ? `${declaration.value} !important` : declaration.value;
    });
    for (const selector of rule.selectors) rules.push({ selector: selector.replace(/\s+/g, ' '), media, declarations });
  });
  return rules;
}

const RULES = rulesOf(readSource(STYLESHEET));
const declared = (selector, media = null) => RULES.find(rule => rule.selector === selector && rule.media === media)
  ?.declarations;
// A duration of the stylesheet, in ms.
const ms = value => {
  const [, amount, unit] = /([\d.]+)(ms|s)\b/.exec(value);
  return Number(amount) * (unit === 's' ? 1000 : 1);
};
// The weight of a selector made of classes, attributes and the universal selector: its class-level specificity.
const weight = selector => (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;

const PROGRESS_RULES = [
  '.bar',
  ".root[data-occ-boot-progress='access'] .bar",
  ".root[data-occ-boot-progress='screen'] .bar",
  ".root[data-occ-boot-progress='complete'] .bar",
];

const part = (cover, name) => cover.querySelector(`[data-occ-boot-part="${name}"]`);

afterEach(() => {
  document.body.replaceChildren();
});

describe('OccBootScreen', () => {
  it('carries the OCC scope and hides itself from assistive technology', () => {
    render(<OccBootScreen phase="waitingAccess" progress="session" />);
    const cover = screen.getByTestId('occ-boot-screen');
    // It renders outside ShellFrame: the scope it carries gives it the dark OCC tokens.
    expect(cover).toHaveAttribute('data-department', 'occ');
    expect(declared('.root')).toMatchObject({
      position: 'fixed', inset: '0', 'z-index': '90', background: 'var(--occ-canvas)', color: 'var(--occ-text)',
    });
    // Above every OCC layer of the Tailwind configuration (the toasts are the highest, 70).
    expect(Number(declared('.root')['z-index'])).toBeGreaterThan(70);

    expect(cover).toHaveAttribute('aria-hidden', 'true');
    expect(isInaccessible(within(cover).getByText('ELEVANT', { exact: false }))).toBe(true);
    // No second status and no live region: the provider's polite announcer and the gates' own status speak for it.
    expect(cover.querySelectorAll('[role], [aria-live]')).toHaveLength(0);
    expect(screen.queryAllByRole('status', { hidden: true })).toEqual([]);
  });

  it('shows the isotype and the ELEVANT · OCC logo with no lists or figures', () => {
    render(<OccBootScreen phase="waitingAccess" progress="session" />);
    const cover = screen.getByTestId('occ-boot-screen');

    const isotype = part(cover, 'isotype');
    expect(isotype.tagName).toBe('IMG');
    // The white and orange isotype for a dark ground, from public/brand (the rail's mark), loaded at once and
    // decorative.
    expect(OCC_BOOT_ISOTYPE_SRC).toBe('/brand/elevant-mark-dark.png');
    expect(decodeURIComponent(isotype.getAttribute('src'))).toContain(OCC_BOOT_ISOTYPE_SRC);
    expect(isotype).toHaveAttribute('alt', '');
    expect(isotype).toHaveAttribute('loading', 'eager');

    // The logo as it is written, in capitals of its own: no CSS upper-casing anywhere.
    expect(part(cover, 'wordmark')).toHaveTextContent(/^ELEVANT · OCC$/);
    expect(within(part(cover, 'wordmark')).getByText('· OCC')).toBeInTheDocument();
    expect(RULES.filter(rule => 'text-transform' in rule.declarations)).toEqual([]);
    expect(declared('.wordmark')).toMatchObject({ color: 'var(--occ-text)', 'font-weight': '600' });
    expect(declared('.unit')).toMatchObject({ color: 'var(--occ-muted)' });

    // The logo is the only text: no lists, no figures, no data.
    expect(cover).toHaveTextContent(/^ELEVANT · OCC$/);
    expect(cover.textContent).not.toMatch(/\d/);
    expect(cover.querySelectorAll('ul, ol, li, dl, table')).toHaveLength(0);
  });

  it('the progress line follows the orchestrator', () => {
    const view = render(<OccBootScreen phase="waitingAccess" progress="session" />);
    const cover = screen.getByTestId('occ-boot-screen');
    const bar = part(cover, 'bar');
    expect(part(cover, 'progress')).toContainElement(bar);

    // The steps of occBootProgress, in the order the orchestrator reaches them: the same line moves along.
    for (const [phase, progress] of [
      ['waitingAccess', 'session'], ['waitingAccess', 'access'], ['waitingReady', 'screen'], ['leaving', 'complete'],
    ]) {
      view.rerender(<OccBootScreen phase={phase} progress={progress} />);
      expect(screen.getByTestId('occ-boot-screen')).toBe(cover);
      expect(cover).toHaveAttribute('data-occ-boot-progress', progress);
      expect(part(cover, 'bar')).toBe(bar);
    }

    // Each step draws the line further from the left, and the end fills it.
    expect(declared('.bar')).toMatchObject({ 'transform-origin': 'left center', background: 'var(--occ-text)' });
    expect(declared('.track')).toMatchObject({ height: '2px', background: 'var(--occ-line)' });
    const reach = PROGRESS_RULES.map(selector => Number(/^scaleX\(([\d.]+)\)$/.exec(declared(selector).transform)[1]));
    expect(reach[0]).toBeGreaterThan(0);
    reach.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(reach[index]));
    expect(reach.at(-1)).toBe(1);
    // While the screen waits for the first screen, the line creeps on, evenly, for as long as that wait may last.
    const waiting = declared(PROGRESS_RULES[2]);
    expect(ms(waiting['transition-duration'])).toBe(OCC_BOOT_READY_TIMEOUT_MS);
    expect(waiting['transition-timing-function']).toBe('linear');
  });

  it('leaving stops pointer events at once', () => {
    const view = render(<OccBootScreen phase="waitingReady" progress="screen" />);
    const cover = screen.getByTestId('occ-boot-screen');
    // While it waits, it covers the page and takes the clicks.
    expect(cover).not.toHaveStyle({ pointerEvents: 'none' });

    view.rerender(<OccBootScreen phase="leaving" progress="complete" />);
    expect(cover).toHaveAttribute('data-occ-boot-phase', 'leaving');
    // Inline, so no stylesheet can delay it...
    expect(cover).toHaveStyle({ pointerEvents: 'none' });
    // ...and in the stylesheet, with the fade. Pointer events are not transitioned: they stop with the phase.
    expect(declared(".root[data-occ-boot-phase='leaving']")).toMatchObject({ 'pointer-events': 'none', opacity: '0' });
    const exit = [declared('.root').transition, declared('.brand').transition];
    expect(exit.join(', ')).not.toMatch(/pointer-events|\ball\b/);
    // The logo fades out, and the screen with it, before the provider unmounts it.
    expect(declared(".root[data-occ-boot-phase='leaving'] .brand")).toMatchObject({ opacity: '0' });
    for (const transition of exit.flatMap(value => value.split(','))) {
      expect(ms(transition), transition).toBeLessThanOrEqual(OCC_BOOT_EXIT_MS);
    }
  });

  it('reduced motion keeps the routes and the logo still and moves only the progress line', () => {
    render(<OccBootScreen phase="waitingAccess" progress="session" />);
    const cover = screen.getByTestId('occ-boot-screen');
    // The routes are arcs measured as one unit, so a dash of 1 draws each one whole.
    const routes = cover.querySelectorAll('[data-occ-boot-part="route"]');
    expect(routes.length).toBeGreaterThanOrEqual(7);
    expect(routes.length).toBeLessThanOrEqual(9);
    routes.forEach(route => {
      expect(route).toHaveAttribute('pathLength', '1');
      expect(route.getAttribute('d')).toMatch(/^M-?\d+ -?\d+Q-?\d+[ -]\d+ -?\d+ -?\d+$/);
    });
    expect(declared('.trace')).toMatchObject({ 'stroke-dasharray': '1', 'stroke-dashoffset': '1' });

    // Everything that animates by itself: the routes, their airports and the entry of the lock-up...
    const animated = RULES.filter(rule => rule.media === null && rule.declarations.animation)
      .map(rule => rule.selector);
    expect([...animated].sort()).toEqual(['.isotype', '.origin', '.stop', '.trace', '.track', '.wordmark']);
    // ...stands still under reduced motion: the routes drawn whole, the lock-up in place.
    for (const selector of animated) expect(declared(selector, REDUCED_MOTION)?.animation, selector).toBe('none');
    expect(declared('.trace', REDUCED_MOTION)).toMatchObject({ 'stroke-dashoffset': '0', opacity: '1' });
    expect(declared('.stop', REDUCED_MOTION)).toMatchObject({ opacity: '1' });
    expect(declared(".root[data-occ-boot-phase='leaving'] .brand", REDUCED_MOTION)).toMatchObject({ transform: 'none' });

    // occ.css cuts every transition inside the OCC scope to nothing under reduced motion...
    const occCut = rulesOf(readSource('src/styles/occ.css'))
      .find(rule => rule.media === REDUCED_MOTION && rule.selector === "[data-department='occ'] *");
    expect(occCut.declarations['transition-duration']).toMatch(/^0\.01ms !important$/);
    // ...and the bar alone keeps its own, the same as with motion, with a weight that outranks that rule.
    const kept = RULES.filter(rule => rule.media === REDUCED_MOTION
      && Object.keys(rule.declarations).some(property => property.startsWith('transition')));
    expect(kept.map(rule => rule.selector)).toEqual([
      '.root .bar', ".root[data-occ-boot-progress='screen'] .bar", ".root[data-occ-boot-progress='complete'] .bar",
    ]);
    const withMotion = ['600ms', ...PROGRESS_RULES.slice(2).map(selector => declared(selector)['transition-duration'])];
    expect(declared('.bar').transition).toMatch(/^transform 600ms /);
    kept.forEach((rule, index) => {
      expect(rule.declarations['transition-duration']).toMatch(/ !important$/);
      expect(ms(rule.declarations['transition-duration'])).toBe(ms(withMotion[index]));
      expect(weight(rule.selector)).toBeGreaterThan(weight(occCut.selector));
    });
  });
});
