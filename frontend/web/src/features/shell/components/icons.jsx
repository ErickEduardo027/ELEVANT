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

export function BarChartIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 20V10M12 20V4M20 20v-6.5" />
      <path d="M4 20h16" />
    </Icon>
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

export function ShieldCheckIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 3.2 5 6v5.4c0 4.3 2.9 8 7 9.4 4.1-1.4 7-5.1 7-9.4V6l-7-2.8Z" />
      <path d="m9.2 12.1 2 2 3.6-3.9" />
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

// Carnet/permiso aeroportuario: no existía en el set de iconos de referencia
// (feat/adminocc); se agrega siguiendo el mismo lenguaje visual (outline,
// stroke 1.7, viewBox 24).
export function IdCardIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="5.3" width="18" height="13.4" rx="2" />
      <circle cx="8.4" cy="10.6" r="1.9" />
      <path d="M5.4 15.6c.4-1.6 1.5-2.4 3-2.4s2.6.8 3 2.4" />
      <path d="M13.8 9.5h5M13.8 12.3h5" />
    </Icon>
  );
}

export function ClockIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.3V12l3.2 2" />
    </Icon>
  );
}

export function RefreshCwIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
      <path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" />
      <path d="M4 20v-4.5h4.5" />
    </Icon>
  );
}

export function CheckCircleIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.3 12.3 2.4 2.4 5-5.2" />
    </Icon>
  );
}

export function UserMinusIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8.2" r="3.2" />
      <path d="M3.2 19c.5-3.3 2.8-5.2 5.8-5.2s5.3 1.9 5.8 5.2" />
      <path d="M16.5 11h4.5" />
    </Icon>
  );
}

export function AlertTriangleIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 4.2 2.9 19.6a1 1 0 0 0 .9 1.5h16.4a1 1 0 0 0 .9-1.5L12 4.2Z" />
      <path d="M12 10v4.2" />
      <path d="M12 17.4h.01" />
    </Icon>
  );
}

// Iconos añadidos para el módulo "Gestión de usuarios y cuentas". Siguen el
// mismo lenguaje visual (outline, stroke 1.7, viewBox 24) del set existente.
export function SearchIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m20 20-4.3-4.3" />
    </Icon>
  );
}

export function PlusIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
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

export function DotsVerticalIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="5.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.8" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function MailIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="5.3" width="18" height="13.4" rx="2" />
      <path d="m4 6.5 8 6 8-6" />
    </Icon>
  );
}

export function KeyIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="15.5" r="4" />
      <path d="M11 12.7 18.5 5.2M16.3 7.4l2.1 2.1M13.6 10.1l1.7 1.7" />
    </Icon>
  );
}

export function MapPinIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 21s7-6.4 7-11.5A7 7 0 0 0 5 9.5C5 14.6 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.4" />
    </Icon>
  );
}

export function BriefcaseIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="7.8" width="18" height="12" rx="2" />
      <path d="M8.5 7.8V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.8" />
      <path d="M3 12.5h18" />
    </Icon>
  );
}

export function PlaneIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 2.5v9.7l7.5 4.4v-2l-7.5-4.6V4.8a1.3 1.3 0 0 0-2.6 0v5.2L2 14.6v2L9.5 12v6l-2.4 1.7v1.6L12 20l4.9 1.3v-1.6L14.5 18v-6" />
    </Icon>
  );
}

export function ChevronLeftIcon(props) {
  return (
    <Icon {...props}>
      <path d="m15 6-6 6 6 6" />
    </Icon>
  );
}

export function ChevronRightIcon(props) {
  return (
    <Icon {...props}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

// Documento de soporte adjunto a una habilitación: no existía en el set de
// iconos de referencia; se agrega siguiendo el mismo lenguaje visual
// (outline, stroke 1.7, viewBox 24).
export function FileTextIcon(props) {
  return (
    <Icon {...props}>
      <path d="M7 3.5h7l3.5 3.5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V7a1 1 0 0 0 1 1h3.5" />
      <path d="M9 12.5h6M9 15.7h6M9 18.8h3.5" />
    </Icon>
  );
}

export function LinkExternalIcon(props) {
  return (
    <Icon {...props}>
      <path d="M9 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
      <path d="M14 4h6v6M20 4 11 13" />
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

export function MessageCircleIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 12.2a8 8 0 1 1 3.4 6.5L4 20l1.2-3.6a7.9 7.9 0 0 1-1.2-4.2Z" />
    </Icon>
  );
}
