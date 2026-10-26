import { useEffect, useState } from 'react';

// Valor centinela de la opción «Otro»: quien consume el combobox debe
// sustituirlo por el texto personalizado antes de persistir.
export const OTHER_OPTION = '__other__';

const fold = text => String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Combobox con búsqueda según el patrón WAI-ARIA 1.2 (lista emergente). Sólo
// permite elegir opciones existentes o «Otro»; el texto escrito filtra y nunca
// se guarda por sí solo.
export default function Combobox({ id, label, value, options, onChange, placeholder, hint, error,
  required = false, otherLabel = 'Otro', otherHint, allowOther = true }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = `${id}-listbox`;
  const messageId = `${id}-message`;
  const other = { value: OTHER_OPTION, label: otherLabel, hint: otherHint };
  const extras = allowOther ? [other] : [];
  const selected = [...options, ...extras].find(option => option.value === value) ?? null;
  const filtered = query ? options.filter(option =>
    [option.label, option.value, option.hint].some(field => fold(field).includes(fold(query)))) : options;
  const visible = [...filtered, ...extras];
  const optionId = index => `${id}-option-${index}`;

  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex, id]);

  function show() {
    if (open) return;
    setOpen(true); setActiveIndex(Math.max(0, visible.findIndex(option => option.value === value)));
  }
  function hide() { setOpen(false); setQuery(null); setActiveIndex(-1); }
  function choose(option) {
    if (!option) return;
    onChange(option.value); hide();
  }
  function handleKeyDown(event) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!open) { show(); return; }
        setActiveIndex(current => Math.min(visible.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1))));
        return;
      case 'Home':
      case 'End':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(event.key === 'Home' ? 0 : visible.length - 1);
        return;
      case 'Enter':
        if (!open) return;
        event.preventDefault();
        choose(visible[activeIndex]);
        return;
      case 'Escape':
        if (!open) return;
        // Cierra sólo la lista, no el drawer que contiene el formulario.
        event.preventDefault(); event.stopPropagation();
        hide();
        return;
      case 'Tab':
        if (open) hide();
        return;
      default:
    }
  }
  function handleInput(event) {
    setQuery(event.target.value); setOpen(true); setActiveIndex(0);
  }

  return <div className="block text-xs font-semibold">
    <label htmlFor={id}>{label}{required && <span aria-hidden="true" className="ml-0.5 text-status-danger">*</span>}</label>
    <div className="relative mt-1">
      <input id={id} type="text" role="combobox" autoComplete="off" spellCheck={false}
        aria-expanded={open} aria-controls={listboxId} aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-required={required || undefined} aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        placeholder={placeholder} value={query ?? selected?.label ?? ''}
        onChange={handleInput} onKeyDown={handleKeyDown} onClick={show} onBlur={hide}
        className={`block w-full rounded-lg border bg-white p-2 pr-9 text-sm font-normal focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-surface-dark ${error ? 'border-status-danger' : 'border-black/10 dark:border-white/10'}`} />
      <button type="button" tabIndex={-1} aria-label={`Mostrar opciones de ${label}`}
        onMouseDown={event => event.preventDefault()}
        onClick={() => { if (open) hide(); else { document.getElementById(id)?.focus(); show(); } }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-text-secondary-light disabled:cursor-not-allowed dark:text-text-secondary-dark">
        <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}><path fill="currentColor" d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" /></svg>
      </button>
      <div hidden={!open} className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-surface-dark-card">
        {query && !filtered.length && <p className="px-3 py-2 text-xs font-normal text-text-secondary-light dark:text-text-secondary-dark">Sin coincidencias. Elige «{otherLabel}» para escribirlo.</p>}
        <ul id={listboxId} role="listbox" aria-label={label} className="max-h-60 overflow-y-auto py-1">
          {open && visible.map((option, index) => <li key={option.value} id={optionId(index)} role="option"
            aria-selected={option.value === value}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}
            onMouseMove={() => { if (index !== activeIndex) setActiveIndex(index); }}
            className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-normal ${option.value === OTHER_OPTION ? 'border-t border-black/10 dark:border-white/10' : ''} ${index === activeIndex ? 'bg-accent-600/10' : ''} ${option.value === value ? 'font-semibold text-accent-600' : ''}`}>
            <span>{option.label}</span>
            {option.hint && <span className="shrink-0 text-[11px] text-text-secondary-light dark:text-text-secondary-dark">{option.hint}</span>}
          </li>)}
        </ul>
      </div>
    </div>
    {(error || hint) && <p id={messageId} className={`mt-1 text-xs font-normal ${error ? 'text-status-danger' : 'text-text-secondary-light dark:text-text-secondary-dark'}`}>{error || hint}</p>}
  </div>;
}
