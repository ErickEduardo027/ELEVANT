export type PortalSource =
  | string
  | {
      label: string;
      system?: string;
      receivedAt?: string;
    };

export interface PortalService {
  id?: string;
  name: string;
  status: string;
  sla?: string;
  scheduledAt?: string;
  completedAt?: string;
  owner?: string;
  source?: PortalSource;
}

export interface PortalTimelineEvent {
  id?: string;
  at: string;
  title: string;
  description?: string;
  status?: string;
  source?: PortalSource;
}

export interface PortalIncident {
  id?: string;
  title: string;
  severity?: string;
  status: string;
  openedAt?: string;
  updatedAt?: string;
  summary?: string;
  source?: PortalSource;
}

export interface PortalDocument {
  id?: string;
  name: string;
  category?: string;
  status?: string;
  updatedAt?: string;
  href?: string;
  source?: PortalSource;
}

export interface PortalFlight {
  operationId: string;
  flightNumber: string;
  route: string;
  aircraft: string;
  registration: string;
  station: string;
  stand: string;
  flightStatus: string;
  operationStatus: string;
  scheduledAt: string;
  estimatedAt: string;
  updatedAt: string;
  source: PortalSource;
  services: PortalService[];
  timeline: PortalTimelineEvent[];
  incidents: PortalIncident[];
  documents: PortalDocument[];
}

export interface PortalKpi {
  id?: string;
  label: string;
  value: string | number;
  detail?: string;
  tone?: "neutral" | "positive" | "attention" | "critical";
}

export interface PortalRecentChange {
  id?: string;
  at: string;
  title: string;
  description?: string;
  flightNumber?: string;
  operationId?: string;
  source?: PortalSource;
}

export interface PortalOverview {
  kpis: PortalKpi[];
  activeFlights: PortalFlight[];
  recentChanges: PortalRecentChange[];
}

export interface PortalFlightFilters {
  query: string;
  status: string;
  station: string;
}

export type PortalViewState = "loading" | "ready" | "empty" | "error";

export function sourceLabel(source: PortalSource | undefined): string {
  if (!source) return "Fuente no informada";
  return typeof source === "string" ? source : source.label;
}

export function sourceDetail(source: PortalSource | undefined): string | null {
  if (!source || typeof source === "string") return null;
  return [source.system, source.receivedAt].filter(Boolean).join(" · ") || null;
}
