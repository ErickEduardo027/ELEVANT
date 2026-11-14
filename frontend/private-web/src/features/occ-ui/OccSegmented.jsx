'use client';

import { useRef } from 'react';

/** What a segmented control is to assistive technology: a group of toggle buttons, or the tabs of a set of panels. */
export const OCC_SEGMENTED_KINDS = Object.freeze(['group', 'tablist']);
export const OCC_SEGMENTED_SIZES = Object.freeze(['md', 'sm']);

const NO_OPTIONS = Object.freeze([]);

// A light track of 1 px joints; each segment is a control (4 px radius outside, 2 px inside), 44 px high on touch.
const TRACK = 'inline-flex max-w-full flex-wrap items-center gap-0.5 rounded border border-occ-line p-0.5';
const SEGMENT = 'inline-flex shrink-0 items-center gap-1.5 rounded-sm font-semibold disabled:cursor-not-allowed '
  + 'disabled:text-occ-faint [@media(pointer:coarse)]:h-11';
const SEGMENT_SIZE = Object.freeze({ md: 'h-8 px-2.5 text-sm', sm: 'h-7 px-2 text-xs' });
// Chosen = cyan on its soft slab; the rest is secondary text that lights on hover.
const CHOSEN = 'bg-occ-accent-soft text-occ-accent';
const UNCHOSEN = 'text-occ-muted enabled:hover:bg-occ-panel-raised enabled:hover:text-occ-text';

const STEPS = Object.freeze({ ArrowRight: 1, ArrowLeft: -1 });

function Segment({ option, chosen, size, ...control }) {
  const hasCount = option.count !== undefined && option.count !== null;
  return (
    <button type="button" disabled={option.disabled === true} {...control}
      className={`${SEGMENT} ${SEGMENT_SIZE[size]} ${chosen ? CHOSEN : UNCHOSEN}`}>
      {option.label}
      {/* The count is part of the name, after a space: «Llegadas 4». */}
      {hasCount ? <>{' '}<span className="font-mono text-xs font-medium">{option.count}</span></> : null}
    </button>
  );
}

/**
 * A segmented control (design F): `options` are `{ id, label, count, disabled }`, `value` is the chosen id and
 * `onChange(id)` hears a choice.
 * - `as="group"` (default): a `group` named `label`, each option a toggle button with `aria-pressed`, each one a stop
 *   for Tab. This is what the screens' filters are today.
 * - `as="tablist"`: a `tablist` named `label` that switches panels. Each option is a `tab` with `aria-selected` and
 *   `aria-controls={panelIdFor(id)}` (`tabIdFor(id)` gives it an id the panel can name). Only the chosen tab (or the
 *   first that can be chosen) is a stop for Tab; ArrowLeft and ArrowRight move to the previous or next tab and choose
 *   it, wrapping around and skipping disabled ones, and Home and End go to the first and the last.
 * A disabled option can never be chosen. `count` is written in mono inside the option's name. `size` is `md` or `sm`.
 * An unknown kind or size throws.
 */
export default function OccSegmented({
  label, options = NO_OPTIONS, value, onChange, as = 'group', panelIdFor, tabIdFor, size = 'md', className = '',
}) {
  const tabs = useRef(new Map());
  if (!OCC_SEGMENTED_KINDS.includes(as)) throw new RangeError(`Unknown OCC segmented kind: ${String(as)}`);
  if (!OCC_SEGMENTED_SIZES.includes(size)) throw new RangeError(`Unknown OCC segmented size: ${String(size)}`);

  const enabled = options.filter(option => option.disabled !== true);
  const choose = id => { if (id !== value) onChange?.(id); };

  if (as === 'group') {
    return (
      <div role="group" aria-label={label} data-occ-segmented="group" className={`${TRACK} ${className}`}>
        {options.map(option => (
          <Segment key={option.id} option={option} size={size} chosen={option.id === value} aria-pressed={option.id === value}
            onClick={() => choose(option.id)} />
        ))}
      </div>
    );
  }

  const tabStop = enabled.some(option => option.id === value) ? value : enabled[0]?.id;

  function move(event, fromId) {
    let next;
    if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled.at(-1);
    else if (Object.hasOwn(STEPS, event.key)) {
      const index = enabled.findIndex(option => option.id === fromId);
      next = enabled[(index + STEPS[event.key] + enabled.length) % enabled.length];
    } else return;
    event.preventDefault();
    if (!next) return;
    tabs.current.get(next.id)?.focus();
    choose(next.id);
  }

  return (
    <div role="tablist" aria-label={label} data-occ-segmented="tablist" className={`${TRACK} ${className}`}>
      {options.map(option => (
        <Segment key={option.id} option={option} size={size} chosen={option.id === value} role="tab"
          id={tabIdFor?.(option.id)} aria-selected={option.id === value} aria-controls={panelIdFor?.(option.id)}
          tabIndex={option.id === tabStop ? 0 : -1}
          ref={element => {
            if (element) tabs.current.set(option.id, element);
            else tabs.current.delete(option.id);
          }}
          onClick={() => choose(option.id)} onKeyDown={event => move(event, option.id)} />
      ))}
    </div>
  );
}
