export default function PositionsListDrawer({ open, onClose, children }) {
  if (!open) return null;

  return (
    <>
      <div
        data-testid="positions-list-drawer-backdrop"
        className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
      />
      <aside
        data-testid="positions-list-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Lista de posiciones"
        className="fixed inset-y-0 left-0 z-50 w-full max-w-sm overflow-y-auto border-r border-black/5 bg-white/95 p-3 shadow-lg backdrop-blur-md transition-transform duration-200 dark:border-white/5 dark:bg-surface-dark-card"
      >
        {children}
      </aside>
    </>
  );
}
