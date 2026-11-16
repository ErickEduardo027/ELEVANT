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

export function XIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function CheckCircleIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.3 2.3 2.3 4.7-5.2" />
    </Icon>
  );
}

export function CornerUpLeftIcon(props) {
  return (
    <Icon {...props}>
      <path d="M9 14 4.5 9.5 9 5" />
      <path d="M4.5 9.5H15a4.5 4.5 0 0 1 4.5 4.5v4" />
    </Icon>
  );
}

export function HistoryIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 5v4.5h4.5" />
      <path d="M4.5 9.5A8 8 0 1 1 5 15" />
      <path d="M12 8.3v4l3 1.7" />
    </Icon>
  );
}

export function MoreVerticalIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="5.3" r="0.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="0.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.7" r="0.4" fill="currentColor" stroke="none" />
      <path d="M12 5.3v0M12 12v0M12 18.7v0" strokeWidth="2.6" />
    </Icon>
  );
}

export function CameraIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 8.2a1.5 1.5 0 0 1 1.5-1.5h1.8L8.6 4.8h6.8l1.3 1.9h1.8A1.5 1.5 0 0 1 20 8.2v9.3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="12.6" r="3.3" />
    </Icon>
  );
}

export function FileTextIcon(props) {
  return (
    <Icon {...props}>
      <path d="M7 3.5h7l3 3v13.3a0.7 0.7 0 0 1-0.7 0.7H7.7A0.7 0.7 0 0 1 7 19.8Z" />
      <path d="M14 3.5v3h3" />
      <path d="M9.3 12h5.4M9.3 15.3h5.4" />
    </Icon>
  );
}

export function ScaleIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v16M7 20.5h10" />
      <path d="M12 5.5 5 8.3l3.3 6.4a3.6 3.6 0 0 0 6.4 0L18 8.3Z" />
    </Icon>
  );
}
