function Icon({ className, children }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

export function HomeIcon(props) {
  return <Icon {...props}><path d="m3 10 9-7 9 7v10H6V10" /><path d="M9.5 20v-6h5v6" /></Icon>;
}

export function ApprovedServicesIcon(props) {
  return <Icon {...props}><path d="M5 4h14v16H5z" /><path d="m8 12 2.2 2.2L16 8.5M8 6.8h5" /></Icon>;
}

export function PreInvoiceIcon(props) {
  return <Icon {...props}><path d="M6 3.5h9l3 3V20H6z" /><path d="M15 3.5V7h3M9 11h6M9 14h6M9 17h3" /></Icon>;
}

export function ReconciliationIcon(props) {
  return <Icon {...props}><path d="M4 7h13M4 17h13" /><path d="m14 4 3 3-3 3M7 14l-3 3 3 3" /><circle cx="19" cy="17" r="2" /></Icon>;
}

export function TariffIcon(props) {
  return <Icon {...props}><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5M16.5 16.5h.01" /></Icon>;
}

export function ReportIcon(props) {
  return <Icon {...props}><path d="M4 20V10M12 20V4M20 20v-6.5" /><path d="M4 20h16" /></Icon>;
}

export function AlertIcon(props) {
  return <Icon {...props}><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v5M12 17.2v.1" /></Icon>;
}

export function ArrowIcon(props) {
  return <Icon {...props}><path d="M5 12h14M14 7l5 5-5 5" /></Icon>;
}

/** «Cuentas por pagar»: a bill going out. */
export function PayablesIcon(props) {
  return <Icon {...props}><path d="M6 3.5h12V20l-3-1.6-3 1.6-3-1.6-3 1.6z" /><path d="M9.5 8h5M9.5 11.5h5M12 14v3M10.5 15.5 12 14l1.5 1.5" /></Icon>;
}

/** «Configuración»: the tariffs, packages and rules that price an invoice. */
export function SettingsIcon(props) {
  return <Icon {...props}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></Icon>;
}
