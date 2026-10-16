import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMobileSessionRequestContext, MobileServiceError } from './mobile-auth';
import { isLocalDevelopmentAccessToken } from './local-development-auth';
import { loadRampIncidentCenter } from './ramp-incidents';
import { readPendingOperationMessage, sendOperationalMessage } from './operational-communication';
import { asMobileServiceError } from './mobile-service-error';
import {
  readRampChecklistPendingSubmission,
  submitRampOperationChecklist,
} from './ramp-operation-checklist';
import { transitionRampOperationService } from './ramp-operation-service-execution';
import {
  readRampOperationPendingSubmission,
  submitRampOperation,
} from './ramp-operation-submission';
import { reopenRampOperationCorrection } from './ramp-operation-correction';
import { changeRampServiceCharge } from './ramp-service-charges';
import { readPendingAttendanceDraft } from '../storage/attendance-draft';
import { saveRampAttendanceDraft } from './ramp-attendance-draft';

export type SyncItemState = 'pending' | 'blocked' | 'requires_intervention';
export type SyncItem = Readonly<{
  id: string;
  label: string;
  operationId?: string;
  state: SyncItemState;
  createdAt?: string;
}>;
export type SyncSnapshot = Readonly<{
  items: readonly SyncItem[];
  localDevelopment: boolean;
  updatedAt: string;
}>;

const definitions = [
  ['elevant:mobile:ramp-checklist-submit-command:v1:', 'Checklist por confirmar'],
  ['elevant:mobile:ramp-service-transition-command:v1:', 'Servicio por confirmar'],
  ['elevant:mobile:ramp-service-charge-command:v1:', 'Cargo operativo por confirmar'],
  ['elevant:mobile:ramp-operation-submit-command:v1:', 'Cierre por confirmar'],
  ['elevant:mobile:ramp-correction-command:v1:', 'Corrección por confirmar'],
  ['elevant:mobile:operation-chat-command:v1:', 'Mensaje por enviar'],
  ['elevant:mobile:attendance-draft-pending:v1:', 'Asistencia por confirmar'],
  ['elevant:mobile:operation-evidence:v1:', 'Evidencias pendientes de carga'],
] as const;
const incidentPrefix = 'elevant:mobile:ramp-incident-outbox:v1:';

function suffixAfterAccount(key: string, prefix: string, accountId: string) {
  const values = key.slice(prefix.length).split(':');
  const index = values.findIndex(value => value === accountId.toLowerCase());
  return index >= 0 ? values.slice(index + 1) : [];
}

function operationIdFromKey(key: string, prefix: string, accountId: string) {
  const suffix = key.slice(prefix.length).split(':');
  const accountIndex = suffix.findIndex(value => value === accountId.toLowerCase());
  return accountIndex >= 0 ? suffix[accountIndex + 1] : undefined;
}

function incidentItems(key: string, raw: string | null, accountId: string): SyncItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { items?: { idempotencyKey?: string; createdAt?: string; state?: string }[] };
    if (!Array.isArray(parsed.items)) return [];
    const operationId = operationIdFromKey(key, incidentPrefix, accountId);
    return parsed.items.map((item, index) => ({
      id: item.idempotencyKey ?? `${key}:${index}`,
      label: 'Incidencia operativa',
      operationId,
      state: item.state === 'blocked' ? 'blocked' : 'pending',
      ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}),
    }));
  } catch {
    return [{ id: key, label: 'Incidencia ilegible', state: 'requires_intervention' }];
  }
}

export async function readSyncSnapshot(): Promise<SyncSnapshot> {
  const context = await getMobileSessionRequestContext();
  const accountId = context.session.actor.accountId.toLowerCase();
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.includes(accountId));
  const values = new Map(await AsyncStorage.multiGet(keys));
  const items: SyncItem[] = [];

  for (const key of keys) {
    if (key.startsWith(incidentPrefix)) {
      items.push(...incidentItems(key, values.get(key) ?? null, accountId));
      continue;
    }
    const definition = definitions.find(([prefix]) => key.startsWith(prefix));
    if (!definition || values.get(key) === null) continue;
    const [prefix, label] = definition;
    items.push({
      id: key,
      label,
      operationId: operationIdFromKey(key, prefix, accountId),
      state: prefix.includes('operation-chat') ? 'pending' : 'requires_intervention',
    });
  }

  return {
    items,
    localDevelopment: isLocalDevelopmentAccessToken(context.accessToken),
    updatedAt: new Date().toISOString(),
  };
}

export async function synchronizePendingWork(signal?: AbortSignal) {
  const context = await getMobileSessionRequestContext();
  if (isLocalDevelopmentAccessToken(context.accessToken)) return readSyncSnapshot();
  const accountId = context.session.actor.accountId.toLowerCase();
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.includes(accountId));
  const values = new Map(await AsyncStorage.multiGet(keys));

  for (const key of keys) {
    if (signal?.aborted) throw new MobileServiceError('cancelled');
    try {
      const raw = values.get(key);
      if (raw === null || raw === undefined) continue;
      if (key.startsWith(incidentPrefix)) {
        const [operationId] = suffixAfterAccount(key, incidentPrefix, accountId);
        if (operationId) await loadRampIncidentCenter(operationId, { signal });
        continue;
      }

      const definition = definitions.find(([prefix]) => key.startsWith(prefix));
      if (!definition) continue;
      const [prefix] = definition;
      const parts = suffixAfterAccount(key, prefix, accountId);
      const operationId = parts[0];
      if (!operationId) continue;

      if (prefix.includes('operation-chat')) {
        const pending = await readPendingOperationMessage(operationId);
        if (pending.kind === 'current' && pending.command) {
          await sendOperationalMessage(operationId, pending.command.content, signal);
        }
      } else if (prefix.includes('checklist-submit')) {
        const checklistId = parts[1];
        if (!checklistId) continue;
        const pending = await readRampChecklistPendingSubmission(operationId, checklistId);
        if (pending) await submitRampOperationChecklist(operationId, pending.request, { signal });
      } else if (prefix.includes('service-transition')) {
        const serviceId = parts[1];
        const stored = JSON.parse(raw) as { payload?: string };
        const request = stored.payload ? JSON.parse(stored.payload) as {
          targetStatus: 'InProgress' | 'Completed' | 'NotPerformed' | 'Exception';
          executedQuantity?: number;
          exceptionReason?: string;
        } : null;
        if (serviceId && request) {
          await transitionRampOperationService(operationId, serviceId, request, { signal });
        }
      } else if (prefix.includes('service-charge')) {
        const [serviceId, chargeId, action] = parts.slice(1);
        if (serviceId && chargeId && (action === 'apply' || action === 'remove')) {
          await changeRampServiceCharge(
            operationId, serviceId, chargeId, action === 'apply' ? 'Apply' : 'Remove', { signal });
        }
      } else if (prefix.includes('operation-submit')) {
        const pending = await readRampOperationPendingSubmission(operationId);
        if (pending) await submitRampOperation(operationId, pending.request, { signal });
      } else if (prefix.includes('correction-command')) {
        await reopenRampOperationCorrection(operationId, { signal });
      } else if (prefix.includes('attendance-draft')) {
        const assignmentId = parts[1];
        if (!assignmentId) continue;
        const pending = await readPendingAttendanceDraft(operationId, assignmentId);
        if (pending) {
          await saveRampAttendanceDraft(operationId, assignmentId, pending.request, { signal });
        }
      }
    } catch (error) {
      const issue = asMobileServiceError(error);
      if (issue.code === 'cancelled' || issue.code === 'unauthenticated' || issue.code === 'forbidden') throw issue;
      // La cola permanece intacta y visible para un próximo intento.
    }
  }
  return readSyncSnapshot();
}

export async function hasPendingWork() {
  try {
    return (await readSyncSnapshot()).items.length > 0;
  } catch {
    // If the protected queue cannot be inspected, logout must fail safely.
    return true;
  }
}
