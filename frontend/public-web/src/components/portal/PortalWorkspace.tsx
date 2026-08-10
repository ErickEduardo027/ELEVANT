"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useMockSession } from "@/components/auth/MockSessionProvider";
import { downloadPortalDocument } from "@/lib/portal-documents";
import {
  createMockPortalRepository,
  type Audit,
  type BillingCase,
  type Contract,
  type Invoice,
  type MockPortalRepository,
  type Notification,
  type Operation,
  type PortalDocument,
  type PortalFlight,
  type PortalKpis,
  type Reconciliation,
  type ServiceRequest,
} from "@/lib/portal";

export type PortalTimeMode = "AIRPORT" | "UTC";

export interface PortalWorkspaceData {
  kpis: PortalKpis;
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

export type PortalActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

interface PortalWorkspaceContextValue {
  repository: MockPortalRepository;
  data: PortalWorkspaceData;
  timeMode: PortalTimeMode;
  setTimeMode: (mode: PortalTimeMode) => void;
  lastRefreshedAt: Date;
  refresh: () => void;
  mutate: <T>(operation: (repository: MockPortalRepository) => T) => PortalActionResult<T>;
  downloadDocument: (id: string) => Promise<PortalActionResult<PortalDocument>>;
  resetDemo: () => void;
}

const PortalWorkspaceContext = createContext<PortalWorkspaceContextValue | null>(null);

function readWorkspace(repository: MockPortalRepository): PortalWorkspaceData {
  return {
    kpis: repository.getKpis(),
    flights: repository.listFlights(),
    operations: repository.listOperations(),
    contracts: repository.listContracts(),
    documents: repository.listDocuments(),
    invoices: repository.listInvoices(),
    reconciliations: repository.listReconciliations(),
    serviceRequests: repository.listServiceRequests(),
    billingCases: repository.listBillingCases(),
    notifications: repository.listNotifications(),
    audits: repository.listAudit(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "No fue posible completar la acción en el entorno de demostración.";
}

export function PortalWorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useMockSession();
  const [revision, setRevision] = useState(0);
  const [timeMode, setTimeMode] = useState<PortalTimeMode>("AIRPORT");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => new Date());
  const repository = useMemo(
    () => (session ? createMockPortalRepository(session) : null),
    [session],
  );

  const data = useMemo(() => {
    void revision;
    return repository ? readWorkspace(repository) : null;
  }, [repository, revision]);

  const refresh = useCallback(() => {
    setLastRefreshedAt(new Date());
    setRevision((value) => value + 1);
  }, []);

  const mutate = useCallback(
    <T,>(operation: (current: MockPortalRepository) => T): PortalActionResult<T> => {
      if (!repository) {
        return { ok: false, message: "La sesión del portal todavía no está disponible." };
      }
      try {
        const value = operation(repository);
        refresh();
        return { ok: true, value };
      } catch (error) {
        return { ok: false, message: errorMessage(error) };
      }
    },
    [refresh, repository],
  );

  const downloadDocument = useCallback(
    async (id: string): Promise<PortalActionResult<PortalDocument>> => {
      if (!repository || !session) {
        return { ok: false, message: "La sesión del portal todavía no está disponible." };
      }
      try {
        const document = repository.getAuthorizedDocument(id);
        await downloadPortalDocument(document, {
          airlineName: session.airline.displayName,
          station: document.station,
        });
        repository.recordDocumentDownload(id);
        refresh();
        return { ok: true, value: document };
      } catch (error) {
        return { ok: false, message: errorMessage(error) };
      }
    },
    [refresh, repository, session],
  );

  const resetDemo = useCallback(() => {
    repository?.resetMockState();
    refresh();
  }, [refresh, repository]);

  if (!repository || !data) return null;

  return (
    <PortalWorkspaceContext.Provider
      value={{
        repository,
        data,
        timeMode,
        setTimeMode,
        lastRefreshedAt,
        refresh,
        mutate,
        downloadDocument,
        resetDemo,
      }}
    >
      {children}
    </PortalWorkspaceContext.Provider>
  );
}

export function usePortalWorkspace(): PortalWorkspaceContextValue {
  const context = useContext(PortalWorkspaceContext);
  if (!context) {
    throw new Error(
      "usePortalWorkspace debe utilizarse dentro de PortalWorkspaceProvider.",
    );
  }
  return context;
}
