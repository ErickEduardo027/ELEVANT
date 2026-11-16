import { OccStatusGlyph } from './OccStatusPill';

/**
 * The legend of a board with states, for its header (contratos 2.4: every board with states shows its legend there, at
 * the owner's request): one entry per mark the board draws, in the board's order, each with the glyph of its tone as
 * OccStatusPill draws it (OccStatusGlyph) and its word.
 * - `label` names the list for assistive technology («Atributos y estado»), like «Prioridad» in Notificaciones.
 * - `items`: `[{ key, tone, label }]`. A mark the board writes with a pill takes the pill's own tone and word, so the
 *   legend and the board never differ. Each entry carries `data-tone`, and its glyph `data-shape`.
 * The glyphs are hidden from assistive technology: the words say the marks. Small and secondary, in the header's
 * secondary text, so it explains the board without competing with it. It takes `className` and forwards
 * `data-testid`; an unknown tone throws, like any vocabulary typo.
 */
export default function OccStatusLegend({ label, items, className = '', 'data-testid': testId }) {
  return (
    <ul aria-label={label} data-occ-status-legend="" data-testid={testId}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-occ-muted ${className}`}>
      {items.map(item => (
        <li key={item.key} data-tone={item.tone} className="flex items-center gap-1.5">
          <OccStatusGlyph tone={item.tone} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
