// Inline, so that no stylesheet can delay it: a leaving screen never takes a click.
const LETS_CLICKS_THROUGH = Object.freeze({ pointerEvents: 'none' });

// The OCC boot screen's surface (contratos 2.6): it covers the page from the session check until the first screen is
// ready. It renders outside ShellFrame, so it carries the OCC scope (`data-department`) and therefore its dark tokens
// itself. It is hidden from assistive technology, which hears the provider's announcement and the plain loading
// screens underneath, and it lets clicks through from the moment it starts leaving.
export default function OccBootScreen({ phase, progress }) {
  return (
    <div
      data-testid="occ-boot-screen"
      data-department="occ"
      data-occ-boot-phase={phase}
      data-occ-boot-progress={progress}
      aria-hidden="true"
      className="fixed inset-0 z-[80] bg-occ-canvas text-occ-text"
      style={phase === 'leaving' ? LETS_CLICKS_THROUGH : undefined}
    />
  );
}
