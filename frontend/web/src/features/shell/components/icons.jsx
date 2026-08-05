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

export function LayoutGridIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.4" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.4" />
    </Icon>
  );
}

export function CalendarIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.8" width="17" height="15.7" rx="2" />
      <path d="M3.5 9.5h17M8 3v3.4M16 3v3.4" />
      <path d="M7.5 13.2h3M13.5 13.2h3M7.5 16.6h3" />
    </Icon>
  );
}

export function RadarIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.3" />
      <circle cx="12" cy="12" r="4.8" />
      <circle cx="12" cy="12" r="0.2" fill="currentColor" stroke="none" />
      <path d="M12 12 18.2 6.4" />
    </Icon>
  );
}

export function BarChartIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 20V10M12 20V4M20 20v-6.5" />
      <path d="M4 20h16" />
    </Icon>
  );
}

export function MessageCircleIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 12.2a8 8 0 1 1 3.4 6.5L4 20l1.2-3.6a7.9 7.9 0 0 1-1.2-4.2Z" />
    </Icon>
  );
}
