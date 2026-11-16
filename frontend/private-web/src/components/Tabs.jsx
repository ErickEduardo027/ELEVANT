// Pestañas genéricas (pill activo), generalizadas de ReviewTabs/ReportTabs
// de `feat/adminocc`. Soporta un contador opcional por pestaña.
export default function Tabs({ tabs, activeId, onChange }) {
  return (
    <div role="tablist" className="-mx-1 flex gap-1.5 overflow-x-auto border-b border-black/5 px-1 pb-2 [scrollbar-width:thin] dark:border-white/5">
      {tabs.map(tab => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-accent-600 text-white'
                : 'text-text-secondary-light hover:bg-black/5 hover:text-ink-900 dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark'
            }`}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span className={`ml-1.5 text-xs ${isActive ? 'text-white/80' : 'text-text-secondary-light dark:text-text-secondary-dark'}`}>
                ({tab.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
