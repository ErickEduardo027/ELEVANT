function Icon({ className, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.3-4.3" />
    </Icon>
  );
}

export function XIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function CrosshairIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2.5v3.5M12 18v3.5M2.5 12h3.5M18 12h3.5" />
    </Icon>
  );
}

export function RotateCcwIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 9.5A8 8 0 1 1 4.6 15" />
      <path d="M4 4.5v5h5" />
    </Icon>
  );
}
