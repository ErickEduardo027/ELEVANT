const SIZE_CLASSES = {
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
};

function getInitials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .map(part => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// Generaliza el patrón de iniciales ya usado inline en Sidebar/Topbar
// (UserMenu) para poder reutilizarlo fuera del shell, p. ej. en la columna
// "Usuario" de la tabla de cuentas.
export default function Avatar({ name, size = 'md', imageUrl }) {
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={`shrink-0 rounded-full object-cover ${sizeClass}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent-600 font-semibold text-white ${sizeClass}`}
    >
      {getInitials(name)}
    </span>
  );
}
