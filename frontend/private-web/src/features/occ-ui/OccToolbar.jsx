/**
 * The bar at the top of a work screen or a register (design E.1 and F): the page's `h1` from `title`, with no line
 * above it and no paragraph under it (a module explains itself in its empty state), then the controls that scope the
 * page.
 * - `summary` sits on the title's line, in secondary text («12 escalas»).
 * - Under it, a `toolbar` named `label` (the title by default) holds the controls (`children`) at the start and
 *   `actions` at the end; both wrap on a narrow screen. They line up on their bottom edge, so a field with its label
 *   above it sits level with the buttons. The `h1` stays outside the toolbar, and with neither controls nor actions
 *   there is no toolbar at all.
 * `data-occ-toolbar` marks the bar; it takes `className` and forwards `data-testid`.
 */
export default function OccToolbar({
  title, label, summary, actions, children, className = '', 'data-testid': testId,
}) {
  const hasControls = Boolean(children) || Boolean(actions);
  return (
    <header data-occ-toolbar="" data-testid={testId} className={`flex min-w-0 flex-col gap-2 ${className}`}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-base font-semibold text-occ-text">{title}</h1>
        {summary ? <div className="text-sm text-occ-muted">{summary}</div> : null}
      </div>
      {hasControls ? (
        <div role="toolbar" aria-label={label ?? title} className="flex min-w-0 flex-wrap items-end gap-2">
          {children}
          {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
