// The manifest of the OCC legacy bridge: which legacy utility classes the OCC repaints with its dark tokens, and how.
// occLegacyBridge.js turns it into src/styles/occ-legacy-bridge.css (committed), and occStyleGuard.test.js fails when
// the stylesheet drifts from this list or when a file mounted under /admin-occ uses a legacy colour class that has no
// line here. The bridge changes no JSX: removing `data-occ-bridge` from the OCC shell switches all of it off.
//
// Each entry is { id, declarations, classes, inside?, pairs?, selectors?, important? }:
// - `declarations`: CSS property → value, only with tokens that src/styles/occ.css defines.
// - `classes`: Tailwind classes, with their variants (`dark:`, `hover:`, `focus:`, `sm:`, …), that get the declarations.
// - `inside`: classes of descendants that take the entry's `color` (the text of a button inside a fill).
// - `pairs`: [a, b]: an element with class b that has class a too, or sits inside an element with class a, takes the
//   declarations.
// - `selectors`: plain selectors, for a state that a global rule or an inline style paints and the bridge would
//   otherwise cover.
// - `important`: the declarations carry !important, the only way to beat an inline style. Only an entry of plain
//   selectors and no class may set it.
// The order of the list is the order of the stylesheet: when two classes of one element set the same property with the
// same specificity, the entry further down wins.
//
// Colour follows the «cabina oscura» rule: normal states carry no hue. Amber and red belong to `status-warning` and
// `status-danger` only, and cyan to what is selected or can be acted on. The other statuses (`info`, `active`,
// `success`, `neutral`) and the brand orange `signal-500` (eyebrows, numbering, counters, unread and status dots) are
// plain text colours; the orange keeps cyan only where it outlined the selected item.

export const OCC_BRIDGE_SCOPE = '[data-department="occ"][data-occ-bridge]';

// The colour of a border or a ring that names none. Tailwind's preflight paints a bare `border` light grey (#e5e7eb)
// and a bare ring half-transparent blue; under the OCC a bare border is a control boundary and a bare ring is a focus
// ring. This rule weighs nothing (`:where`), so any colour class still wins over it.
export const OCC_BRIDGE_DEFAULTS = Object.freeze({
  'border-color': 'var(--occ-line-strong)',
  '--tw-ring-color': 'var(--occ-accent)',
});

export const OCC_LEGACY_BRIDGE = Object.freeze([
  // 1. Text. `text-white` is plain text here; on a fill it takes the fill's ink through `inside` (group 4).
  {
    id: 'text',
    declarations: { color: 'var(--occ-text)' },
    classes: [
      'text-ink-900', 'text-text-primary-light', 'text-text-primary-dark', 'dark:text-text-primary-dark', 'text-white',
      'hover:text-ink-900', 'dark:hover:text-text-primary-dark', 'hover:text-white',
    ],
  },
  {
    id: 'text-muted',
    declarations: { color: 'var(--occ-muted)' },
    // `text-ink-600` has no colour in tailwind.config.js; every use sits next to `dark:text-text-secondary-dark`.
    // `text-signal-500` is the brand orange of eyebrows, numbering and notes such as «pendiente de primer acceso».
    classes: [
      'text-text-secondary-light', 'dark:text-text-secondary-dark', 'text-ink-600', 'text-white/80', 'text-signal-500',
    ],
  },
  {
    id: 'text-faint',
    declarations: { color: 'var(--occ-faint)' },
    classes: ['text-text-secondary-light/60', 'dark:text-text-secondary-dark/60'],
  },
  {
    id: 'text-accent',
    declarations: { color: 'var(--occ-accent)' },
    classes: ['text-accent-600', 'hover:text-accent-600'],
  },
  {
    id: 'text-danger',
    declarations: { color: 'var(--occ-danger)' },
    classes: ['text-status-danger', 'text-status-danger/90', 'text-rose-700', 'dark:text-rose-300'],
  },
  {
    id: 'text-warn',
    declarations: { color: 'var(--occ-warn)' },
    classes: ['text-status-warning'],
  },
  {
    id: 'text-ok',
    declarations: { color: 'var(--occ-ok)' },
    classes: ['text-status-success'],
  },

  // 2. Surfaces: panel, raised slab, page, input well, floating panel. The well comes after the panel so that an
  //    input with `bg-white dark:bg-surface-dark` is a well.
  {
    id: 'surface-panel',
    declarations: { 'background-color': 'var(--occ-panel)' },
    classes: [
      'bg-white', 'bg-white/55', 'bg-white/60', 'bg-white/70', 'bg-white/80', 'bg-white/90', 'bg-white/95',
      'dark:bg-surface-dark-card', 'dark:bg-surface-dark-card/90', 'dark:bg-surface-dark-card/95',
    ],
  },
  {
    id: 'surface-raised',
    declarations: { 'background-color': 'var(--occ-panel-raised)' },
    // `bg-signal-500/15` is the tag of a custom permission level (PermissionMatrix): a note, not an alarm.
    classes: [
      'bg-black/5', 'bg-black/10', 'bg-black/[.03]', 'bg-black/[0.025]', 'bg-black/[0.03]', 'bg-ink-900/[0.035]',
      'bg-white/[0.03]', 'bg-status-success/10', 'bg-signal-500/15', 'bg-slate-50/70',
      'dark:bg-white/5', 'dark:bg-white/10', 'dark:bg-white/[.03]', 'dark:bg-white/[.04]', 'dark:bg-white/[0.025]',
      'dark:bg-white/[0.03]', 'dark:bg-white/[0.035]', 'dark:bg-white/[0.04]', 'dark:bg-slate-900/40',
      'hover:bg-black/5', 'dark:hover:bg-white/5',
    ],
  },
  {
    id: 'surface-canvas',
    declarations: { 'background-color': 'var(--occ-canvas)' },
    classes: ['bg-surface-light'],
  },
  {
    id: 'surface-field',
    declarations: { 'background-color': 'var(--occ-field)' },
    classes: ['bg-surface-dark', 'dark:bg-surface-dark'],
  },
  {
    id: 'surface-float',
    declarations: { 'background-color': 'var(--occ-panel-float)' },
    classes: ['bg-slate-950/90'],
  },

  // 3. Tints: the selected row, the alarm boxes.
  {
    id: 'tint-accent',
    declarations: { 'background-color': 'var(--occ-accent-soft)' },
    classes: [
      'bg-accent-600/5', 'bg-accent-600/10', 'bg-accent-600/[0.04]', 'bg-accent-600/[0.06]',
      'dark:bg-accent-600/10', 'dark:bg-accent-600/15', 'dark:bg-accent-600/20', 'dark:bg-accent-600/[0.08]',
      'hover:bg-accent-600/10', 'aria-[current=true]:bg-accent-600/10',
    ],
  },
  {
    id: 'tint-danger',
    declarations: { 'background-color': 'var(--occ-danger-soft)' },
    classes: ['bg-status-danger/5', 'bg-status-danger/10', 'hover:bg-status-danger/5', 'hover:bg-status-danger/10'],
  },
  {
    id: 'tint-warn',
    declarations: { 'background-color': 'var(--occ-warn-soft)' },
    classes: ['bg-status-warning/10', 'bg-status-warning/15', 'hover:bg-status-warning/10'],
  },

  // 4. Fills carry their own ink, on the element and on the `text-white` inside them. The primary action is the light
  //    key. Amber and red fill warning and danger only; a normal state («En operación», «Rodaje»…) and the orange of
  //    counters and dots get a plain light fill, in the text colour, with the key's ink. The other status dots are
  //    text («success») or secondary («info», «neutral»).
  {
    id: 'fill-primary',
    declarations: { 'background-color': 'var(--occ-primary)', color: 'var(--occ-on-primary)' },
    classes: ['bg-accent-600', 'bg-accent-600/80', 'bg-ink-900'],
    inside: ['text-white', 'text-white/80'],
  },
  {
    id: 'fill-primary-hover',
    declarations: { 'background-color': 'var(--occ-primary-hover)' },
    classes: ['hover:bg-accent-600/90', 'hover:bg-accent-700'],
  },
  {
    id: 'fill-danger',
    declarations: { 'background-color': 'var(--occ-danger-fill)', color: 'var(--occ-on-danger)' },
    classes: ['bg-status-danger'],
    inside: ['text-white'],
  },
  {
    id: 'fill-warn',
    declarations: { 'background-color': 'var(--occ-warn-fill)', color: 'var(--occ-on-warn)' },
    classes: ['bg-status-warning'],
    inside: ['text-white'],
  },
  {
    id: 'fill-neutral',
    declarations: { 'background-color': 'var(--occ-text)', color: 'var(--occ-on-primary)' },
    classes: ['bg-signal-500', 'bg-status-active'],
    inside: ['text-white'],
  },
  {
    id: 'dot-text',
    declarations: { 'background-color': 'var(--occ-text)' },
    classes: ['bg-status-success'],
  },
  {
    id: 'dot-muted',
    declarations: { 'background-color': 'var(--occ-muted)' },
    classes: ['bg-status-info', 'bg-status-neutral'],
  },

  // 5. Scrim behind drawers and dialogs.
  {
    id: 'scrim',
    declarations: { 'background-color': 'var(--occ-scrim)' },
    classes: ['bg-ink-900/40', 'bg-ink-900/50', 'bg-ink-900/60', 'bg-black/60'],
  },

  // 6. Joints, control boundaries, rings, outlines. Every control boundary is `line-strong`; cyan marks the selected
  //    item and the focus (`border-signal-500` and `ring-signal-500` outline the selected flight or stand row).
  {
    id: 'border-line',
    declarations: { 'border-color': 'var(--occ-line)' },
    classes: [
      'border-black/5', 'border-black/10', 'border-ink-900/10', 'border-white/15', 'border-accent-600/10',
      'border-slate-200', 'dark:border-white/5', 'dark:border-white/10', 'dark:border-slate-700',
      'divide-black/5', 'divide-black/10', 'dark:divide-white/5', 'dark:divide-white/10',
    ],
  },
  {
    id: 'border-line-strong',
    declarations: { 'border-color': 'var(--occ-line-strong)' },
    classes: [
      'border-black/15', 'border-black/20', 'border-white/80', 'border-slate-300',
      'border-accent-600', 'border-accent-600/20', 'border-accent-600/25', 'border-accent-600/30', 'border-accent-600/40',
      'border-status-success', 'border-status-success/25', 'border-status-success/30',
      'dark:border-white/15', 'dark:border-white/20',
      'hover:border-accent-600', 'hover:border-accent-600/40', 'hover:border-accent-600/45',
    ],
  },
  {
    id: 'border-accent',
    declarations: { 'border-color': 'var(--occ-accent)' },
    classes: ['border-signal-500', 'border-sky-300/80', 'focus:border-accent-600'],
  },
  {
    id: 'border-danger',
    declarations: { 'border-color': 'var(--occ-danger)' },
    classes: [
      'border-status-danger', 'border-status-danger/25', 'border-status-danger/30', 'border-status-danger/40',
      'border-status-danger/60', 'dark:border-status-danger/30',
    ],
  },
  {
    id: 'border-warn',
    declarations: { 'border-color': 'var(--occ-warn)' },
    classes: [
      'border-status-warning', 'border-status-warning/25', 'border-status-warning/30', 'border-status-warning/40',
      'border-amber-400',
    ],
  },
  {
    id: 'ring-accent',
    declarations: { '--tw-ring-color': 'var(--occ-accent)' },
    classes: ['ring-accent-600', 'ring-signal-500', 'focus:ring-accent-600', 'focus:ring-accent-600/20', 'focus-visible:ring-accent-600'],
  },
  {
    id: 'ring-line-strong',
    declarations: { '--tw-ring-color': 'var(--occ-line-strong)' },
    classes: ['ring-white/10'],
  },
  {
    id: 'ring-danger',
    declarations: { '--tw-ring-color': 'var(--occ-danger)' },
    classes: ['ring-status-danger/20', 'ring-status-danger/40'],
  },
  {
    id: 'outline-accent',
    declarations: { 'outline-color': 'var(--occ-accent)' },
    classes: ['focus-visible:outline-accent-600', 'focus-visible:outline-sky-300'],
  },
  {
    id: 'accent-color',
    declarations: { 'accent-color': 'var(--occ-accent)' },
    classes: ['accent-accent-600'],
  },
  {
    // app/globals.css draws an invalid field (src/components/formValidation.js) with a red border at the weight of a
    // border rule above; here the red outranks every border class of the field, focus included, as it did before.
    id: 'invalid-field',
    declarations: { 'border-color': 'var(--occ-danger)' },
    classes: [],
    selectors: ['[aria-invalid="true"]:not([type="checkbox"]):not([type="radio"])'],
  },
  {
    // FlightCard (Planificación), FlightListItem (Monitoreo de vuelos) and PositionListItem (Mapa de posiciones) draw a
    // status stripe with an inline colour of dashboard/statusMeta.js: blue, orange, green, amber or red. Their badge
    // already names the status, so under the OCC the stripe is a joint like the rest of the border. Only !important
    // outweighs an inline style.
    id: 'status-stripe',
    declarations: { 'border-left-color': 'var(--occ-line)' },
    classes: [],
    selectors: ['[data-testid="flight-card"]', '[data-testid="flight-list-item"]', '[data-testid="position-list-item"]'],
    important: true,
  },

  // 7. Pairs. Red text on the red tint reads below 4.5:1, so on that tint the text is plain and the colour stays in the
  //    tint and the border.
  {
    id: 'danger-tint-text',
    declarations: { color: 'var(--occ-text)' },
    classes: [],
    pairs: [
      ['bg-status-danger/10', 'text-status-danger'], ['bg-status-danger/10', 'text-status-danger/90'],
      ['bg-status-danger/5', 'text-status-danger'],
      ['hover:bg-status-danger/10', 'text-status-danger'], ['hover:bg-status-danger/5', 'text-status-danger'],
    ],
  },

  // 8. Flat: no blur and no shadow. Shadows are cleared through --tw-shadow, never with `box-shadow: none`, because
  //    Tailwind draws the focus rings with box-shadow too.
  {
    id: 'flat-backdrop',
    declarations: { '-webkit-backdrop-filter': 'none', 'backdrop-filter': 'none' },
    classes: ['backdrop-blur-sm', 'backdrop-blur-md', 'backdrop-blur-lg', 'backdrop-blur-xl'],
  },
  {
    id: 'flat-shadow',
    declarations: { '--tw-shadow': '0 0 #0000', '--tw-shadow-colored': '0 0 #0000' },
    classes: ['shadow', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl', 'hover:shadow-md'],
  },

  // 9. Shape: radius by role, panels 6 px and controls 4 px.
  {
    id: 'radius-panel',
    declarations: { 'border-radius': 'var(--occ-radius-panel)' },
    classes: ['rounded-2xl', 'rounded-xl', 'rounded-[1.5rem]', 'sm:rounded-2xl', 'sm:rounded-xl'],
  },
  {
    id: 'radius-panel-top',
    declarations: { 'border-top-left-radius': 'var(--occ-radius-panel)', 'border-top-right-radius': 'var(--occ-radius-panel)' },
    classes: ['rounded-t-2xl'],
  },
  {
    id: 'radius-control',
    declarations: { 'border-radius': 'var(--occ-radius-control)' },
    classes: ['rounded-lg'],
  },

  // 10. Repairs. `font-sans` is system-ui in tailwind.config.js and would drop Manrope; it names the family instead of
  //     inheriting it, because some uses sit inside a monospace cell. Tailwind generates no class for an opacity
  //     modifier on an occ colour, so these floating panels had no background at all.
  {
    id: 'font-manrope',
    declarations: { 'font-family': "var(--font-manrope), system-ui, 'Segoe UI', sans-serif" },
    classes: ['font-sans'],
  },
  {
    id: 'panel-float',
    declarations: { 'background-color': 'var(--occ-panel-float)' },
    classes: ['bg-occ-panel/90', 'bg-occ-panel/95'],
  },
].map(entry => Object.freeze(entry)));

// Legacy colour classes that a file under /admin-occ contains but that never paint inside the OCC frame, each with the
// reason. Empty: everything the scan finds is mapped.
export const OCC_BRIDGE_UNMAPPED = Object.freeze({});

// Folders already rebuilt with the OCC tokens and the occ-ui primitives: they may not use a legacy colour class. The
// first one arrives with U3.
export const MIGRATED_FOLDERS = Object.freeze([]);
