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

export function MenuIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  );
}

export function BellIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 9.5a6 6 0 0 1 12 0v4.2l1.6 2.6H4.4L6 13.7V9.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Icon>
  );
}

export function SunIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2m0 14v2m9-9h-2M5 12H3m14.5-6.5-1.4 1.4M6.9 17.1l-1.4 1.4m0-13 1.4 1.4m10.2 10.2 1.4 1.4" />
    </Icon>
  );
}

export function MoonIcon(props) {
  return (
    <Icon {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </Icon>
  );
}

export function ChevronDownIcon(props) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function PlaneIcon(props) {
  return (
    <Icon {...props}>
      <path d="M3.5 12.8 20 7.2c.9-.3 1.6.5 1.2 1.3l-2 3.8-6 2-1 4.7-1.6.5-.6-5-4-1.2Z" />
    </Icon>
  );
}

export function ShieldCheckIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 3.2 5 6v5.4c0 4.3 2.9 8 7 9.4 4.1-1.4 7-5.1 7-9.4V6l-7-2.8Z" />
      <path d="m9.2 12.1 2 2 3.6-3.9" />
    </Icon>
  );
}

export function MapPinIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.3" />
    </Icon>
  );
}

export function AlertTriangleIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 4 2.5 20h19L12 4Z" />
      <path d="M12 10.5v4.2" />
      <circle cx="12" cy="17.3" r="0.15" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function RefreshCwIcon(props) {
  return (
    <Icon {...props}>
      <path d="M20 8a8 8 0 0 0-14.6-4.3M4 16a8 8 0 0 0 14.6 4.3" />
      <path d="M20 3.5V8h-4.5M4 20.5V16h4.5" />
    </Icon>
  );
}

export function UsersIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="8.5" cy="8.2" r="2.7" />
      <path d="M3.2 18c.5-2.9 2.6-4.6 5.3-4.6s4.8 1.7 5.3 4.6" />
      <path d="M15.5 6.3a2.6 2.6 0 0 1 0 5" />
      <path d="M17 13.6c2.2.4 3.6 1.9 4 4.3" />
    </Icon>
  );
}

export function ChecklistIcon(props) {
  return (
    <Icon {...props}>
      <path d="M9 6h10M9 12h10M9 18h10" />
      <path d="m4 6 1 1 1.6-1.6M4 12l1 1 1.6-1.6M4 18l1 1 1.6-1.6" />
    </Icon>
  );
}
