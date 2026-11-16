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

export function LayersIcon(props) {
  return (
    <Icon {...props}>
      <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
      <path d="m3.5 12 8.5 4.5L20.5 12" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </Icon>
  );
}

export function CubeIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </Icon>
  );
}

export function MaximizeIcon(props) {
  return (
    <Icon {...props}>
      <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" />
    </Icon>
  );
}

export function MinimizeIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 9h4V5M20 9h-4V5M4 15h4v4M20 15h-4v4" />
    </Icon>
  );
}

export function ListIcon(props) {
  return (
    <Icon {...props}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </Icon>
  );
}

export function LinkIcon(props) {
  return (
    <Icon {...props}>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M11 6.5 12.5 5a3 3 0 1 1 4.2 4.2L15 10.7" />
      <path d="M13 17.5 11.5 19a3 3 0 1 1-4.2-4.2L9 13.3" />
    </Icon>
  );
}
