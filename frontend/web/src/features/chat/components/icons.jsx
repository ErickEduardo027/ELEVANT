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

export function SendIcon(props) {
  return (
    <Icon {...props}>
      <path d="m4 12 16-7-6.5 16-2.3-6.8L4 12Z" />
    </Icon>
  );
}

export function PaperclipIcon(props) {
  return (
    <Icon {...props}>
      <path d="M18.5 10.5 10.9 18a3.8 3.8 0 0 1-5.4-5.4l8.4-8.4a2.6 2.6 0 0 1 3.6 3.6l-8.1 8.1a1.3 1.3 0 0 1-1.8-1.8l7.2-7.2" />
    </Icon>
  );
}

export function ArrowLeftIcon(props) {
  return (
    <Icon {...props}>
      <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />
    </Icon>
  );
}

export function CheckIcon(props) {
  return (
    <Icon {...props}>
      <path d="m4.5 12.5 4.5 4.5 10-11" />
    </Icon>
  );
}

export function FileGenericIcon(props) {
  return (
    <Icon {...props}>
      <path d="M7 3.5h7l3 3v13.3a0.7 0.7 0 0 1-0.7 0.7H7.7A0.7 0.7 0 0 1 7 19.8Z" />
      <path d="M14 3.5v3h3" />
    </Icon>
  );
}

export function ImageIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.6" />
      <circle cx="9" cy="10" r="1.7" />
      <path d="m5.5 17 4.5-4.8L13 15l2.5-2.8 3 4.8" />
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
