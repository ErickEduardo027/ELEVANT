import type { MockAirlineSession } from "@/lib/mock-auth";
import type { CreateServiceRequestInput, ServiceRequest } from "@/lib/portal";
import { getPrototypeApiUrl } from "@/lib/prototype-api";

interface BackendServiceRequest {
  id: string;
  airline: string;
  contactName: string;
  contactEmail: string;
  type: "affiliation" | "additionalService";
  requestedService: string;
  receivedAt: string;
  updatedAt?: string;
  status: "pending" | "inReview" | "approved" | "rejected" | "cancelled";
  decisionNote?: string;
  cancellationReason?: string;
  details?: {
    airlineId?: string;
    requestedBy?: string;
    station?: string;
    flightId?: string | null;
    portalType?: ServiceRequest["type"];
    title?: string;
    description?: string;
    requestedFor?: string;
  } | null;
}

export type TrackedServiceRequest = ServiceRequest & { decisionNote: string | null };

function statusFromBackend(status: BackendServiceRequest["status"]): ServiceRequest["status"] {
  const statuses: Record<BackendServiceRequest["status"], ServiceRequest["status"]> = {
    pending: "SUBMITTED",
    inReview: "IN_REVIEW",
    approved: "APPROVED",
    rejected: "REJECTED",
    cancelled: "CANCELLED",
  };
  return statuses[status];
}

function toPortalRequest(item: BackendServiceRequest, session: MockAirlineSession): TrackedServiceRequest {
  const createdAt = item.receivedAt;
  const details = item.details ?? {};
  return {
    id: item.id,
    airlineId: details.airlineId ?? session.airlineId,
    station: details.station ?? session.stations.primary,
    flightId: details.flightId ?? null,
    requestedBy: details.requestedBy ?? session.userId,
    type: details.portalType ?? "OTHER",
    title: details.title ?? item.requestedService,
    description: details.description ?? item.requestedService,
    requestedFor: details.requestedFor ?? createdAt,
    status: statusFromBackend(item.status),
    createdAt,
    updatedAt: item.updatedAt ?? item.receivedAt,
    cancellationReason: item.cancellationReason ?? null,
    decisionNote: item.decisionNote?.trim() || null,
    provenance: {
      source: "AIRLINE_PORTAL",
      sourceRecordId: item.id,
      capturedAt: createdAt,
      lastSyncedAt: item.updatedAt ?? item.receivedAt,
      quality: "VERIFIED",
    },
  };
}

async function request(path: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${getPrototypeApiUrl()}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      cache: "no-store",
    });
  } catch {
    throw new Error("No fue posible conectar con la API de Development.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No fue posible completar la solicitud.");
  return payload;
}

export async function listTrackedServiceRequests(session: MockAirlineSession): Promise<TrackedServiceRequest[]> {
  const rows = await request(`/api/public/service-requests?contactEmail=${encodeURIComponent(session.user.email)}`);
  return rows.map((item: BackendServiceRequest) => toPortalRequest(item, session));
}

export async function createTrackedServiceRequest(
  session: MockAirlineSession,
  input: CreateServiceRequestInput,
): Promise<TrackedServiceRequest> {
  const requestedFor = new Date(input.requestedFor);
  if (!input.station || !input.title.trim() || !input.description.trim() || Number.isNaN(requestedFor.getTime())) {
    throw new Error("Completa correctamente los datos obligatorios.");
  }
  if (requestedFor.getTime() < Date.now()) throw new Error("La fecha solicitada no puede estar en el pasado.");
  const created = await request("/api/public/service-requests", {
    method: "POST",
    body: JSON.stringify({
      airline: session.airline.displayName,
      contactName: session.user.fullName,
      contactEmail: session.user.email,
      type: "additionalService",
      requestedService: input.title,
      details: {
        airlineId: session.airlineId,
        requestedBy: session.userId,
        station: input.station,
        flightId: input.flightId ?? null,
        portalType: input.type,
        title: input.title.trim(),
        description: input.description.trim(),
        requestedFor: requestedFor.toISOString(),
      },
    }),
  });
  return toPortalRequest(created, session);
}

export async function cancelTrackedServiceRequest(
  session: MockAirlineSession,
  requestId: string,
  reason: string,
): Promise<TrackedServiceRequest> {
  const updated = await request(`/api/public/service-requests/${encodeURIComponent(requestId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ contactEmail: session.user.email, reason }),
  });
  return toPortalRequest(updated, session);
}
