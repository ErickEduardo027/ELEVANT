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

export function HomeIcon(props) {
  return <Icon {...props}><path d="m3 10 9-7 9 7v10H6V10" /><path d="M9.5 20v-6h5v6" /></Icon>;
}

export function ContractIcon(props) {
  return <Icon {...props}><path d="M6 3.5h9l3 3V20H6z" /><path d="M15 3.5V7h3M9 11h6M9 14h6M9 17h4" /></Icon>;
}

export function RequestIcon(props) {
  return <Icon {...props}><path d="M4 5h16v14H4z" /><path d="m4 7 8 6 8-6" /></Icon>;
}

export function ServiceIcon(props) {
  return <Icon {...props}><path d="M4 7h16M4 12h16M4 17h10" /><circle cx="7" cy="7" r="1" fill="currentColor" /><circle cx="7" cy="12" r="1" fill="currentColor" /><circle cx="7" cy="17" r="1" fill="currentColor" /></Icon>;
}

export function AlertIcon(props) {
  return <Icon {...props}><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v5M12 17.2v.1" /></Icon>;
}

export function ArrowIcon(props) {
  return <Icon {...props}><path d="M5 12h14M14 7l5 5-5 5" /></Icon>;
}
