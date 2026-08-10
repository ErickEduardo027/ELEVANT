export type PortalId = string;
export type IsoDateTime = string;
export type CurrencyCode = "USD" | "DOP";

export interface DataProvenance {
  source: "ELEVANT_CORE" | "AIRLINE_PORTAL" | "ERP" | "DOCUMENT_STORE";
  sourceRecordId: string;
  capturedAt: IsoDateTime;
  lastSyncedAt: IsoDateTime;
  quality: "VERIFIED" | "REPORTED" | "ESTIMATED";
  note?: string;
}

export interface PortalFlight {
  id: PortalId;
  airlineId: PortalId;
  flightNumber: string;
  operationDate: string;
  direction: "ARRIVAL" | "DEPARTURE";
  origin: string;
  destination: string;
  station: string;
  scheduledAt: IsoDateTime;
  estimatedAt: IsoDateTime | null;
  actualAt: IsoDateTime | null;
  aircraftRegistration: string;
  aircraftType: string;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  operationId: PortalId | null;
  provenance: DataProvenance;
}

export interface OperationService {
  code: string;
  name: string;
  unit: "SERVICE" | "MINUTE" | "UNIT" | "PERSON";
  contractedQuantity: number;
  executedQuantity: number;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "NOT_EXECUTED";
}

export interface Operation {
  id: PortalId;
  airlineId: PortalId;
  flightId: PortalId;
  station: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  assignedTeam: string;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  slaTargetMinutes: number;
  services: OperationService[];
  incidentCount: number;
  evidenceCount: number;
  provenance: DataProvenance;
}

export interface ContractServiceRate {
  serviceCode: string;
  serviceName: string;
  unit: OperationService["unit"];
  unitPrice: number;
  currency: CurrencyCode;
}

export interface Contract {
  id: PortalId;
  airlineId: PortalId;
  contractNumber: string;
  title: string;
  stations: string[];
  validFrom: string;
  validUntil: string;
  status: "DRAFT" | "ACTIVE" | "EXPIRED";
  serviceRates: ContractServiceRate[];
  provenance: DataProvenance;
}

export interface PortalDocument {
  id: PortalId;
  airlineId: PortalId;
  station: string;
  operationId: PortalId | null;
  flightId: PortalId | null;
  type:
    | "SERVICE_ORDER"
    | "OPERATION_REPORT"
    | "EVIDENCE"
    | "CONTRACT"
    | "INVOICE";
  name: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  createdAt: IsoDateTime;
  status: "PROCESSING" | "AVAILABLE" | "REVOKED";
  requiredPermission: "documents:read" | "evidence:read" | "billing:read" | "contracts:read";
  downloadUrl: string | null;
  provenance: DataProvenance;
}

export interface InvoiceLine {
  id: PortalId;
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  operationId: PortalId | null;
}

export interface Invoice {
  id: PortalId;
  airlineId: PortalId;
  invoiceNumber: string;
  kind: "PREBILL" | "INVOICE";
  periodStart: string;
  periodEnd: string;
  issuedAt: IsoDateTime;
  dueAt: IsoDateTime | null;
  currency: CurrencyCode;
  subtotal: number;
  tax: number;
  total: number;
  status:
    | "PENDING_REVIEW"
    | "ACCEPTED"
    | "DISPUTED"
    | "ISSUED"
    | "PAID"
    | "OVERDUE";
  lines: InvoiceLine[];
  respondedAt: IsoDateTime | null;
  responseNote: string | null;
  provenance: DataProvenance;
}

export interface ReconciliationDifference {
  serviceCode: string;
  description: string;
  contractedQuantity: number;
  executedQuantity: number;
  amountImpact: number;
}

export interface Reconciliation {
  id: PortalId;
  airlineId: PortalId;
  operationId: PortalId;
  station: string;
  periodStart: string;
  periodEnd: string;
  status: "PENDING_REVIEW" | "MATCHED" | "ACCEPTED" | "DISPUTED";
  differences: ReconciliationDifference[];
  currency: CurrencyCode;
  varianceAmount: number;
  respondedAt: IsoDateTime | null;
  responseNote: string | null;
  provenance: DataProvenance;
}

export interface ServiceRequest {
  id: PortalId;
  airlineId: PortalId;
  station: string;
  flightId: PortalId | null;
  requestedBy: PortalId;
  type: "ADDITIONAL_SERVICE" | "SCHEDULE_CHANGE" | "SPECIAL_ASSISTANCE" | "OTHER";
  title: string;
  description: string;
  requestedFor: IsoDateTime;
  status: "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  cancellationReason: string | null;
  provenance: DataProvenance;
}

export interface BillingCase {
  id: PortalId;
  airlineId: PortalId;
  invoiceId: PortalId | null;
  reconciliationId: PortalId | null;
  type: "PREBILL_DISPUTE" | "RECONCILIATION_DISPUTE" | "INVOICE_CLAIM";
  subject: string;
  description: string;
  lineIds: PortalId[];
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";
  createdBy: PortalId;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  resolution: string | null;
  provenance: DataProvenance;
}

export interface Notification {
  id: PortalId;
  airlineId: PortalId;
  category: "OPERATION" | "DOCUMENT" | "BILLING" | "REQUEST" | "SYSTEM";
  title: string;
  message: string;
  createdAt: IsoDateTime;
  readAt: IsoDateTime | null;
  href: string | null;
}

export interface Audit {
  id: PortalId;
  airlineId: PortalId;
  actorId: PortalId;
  actorName: string;
  action: string;
  entityType:
    | "SERVICE_REQUEST"
    | "INVOICE"
    | "RECONCILIATION"
    | "BILLING_CASE"
    | "NOTIFICATION"
    | "DOCUMENT";
  entityId: PortalId;
  occurredAt: IsoDateTime;
  details: Record<string, string | number | boolean | null | string[]>;
}

export interface PortalKpis {
  flightsToday: number;
  operationsInProgress: number;
  operationsCompleted: number;
  onTimePerformancePercent: number;
  serviceCompliancePercent: number;
  openIncidents: number;
  pendingBillingReviews: number;
  unreadNotifications: number;
}

export interface PortalFixtureSet {
  flights: PortalFlight[];
  operations: Operation[];
  contracts: Contract[];
  documents: PortalDocument[];
  invoices: Invoice[];
  reconciliations: Reconciliation[];
  serviceRequests: ServiceRequest[];
  billingCases: BillingCase[];
  notifications: Notification[];
  audits: Audit[];
}

export interface CreateServiceRequestInput {
  station: string;
  flightId?: PortalId | null;
  type: ServiceRequest["type"];
  title: string;
  description: string;
  requestedFor: string | Date;
}

export interface DisputeInput {
  reason: string;
  subject?: string;
  lineIds?: PortalId[];
}

export interface InvoiceClaimInput {
  subject: string;
  description: string;
}

export interface PortalListFilters {
  station?: string;
  from?: string | Date;
  to?: string | Date;
}
