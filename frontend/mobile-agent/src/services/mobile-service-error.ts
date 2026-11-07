import { ElevantApiError } from '@elevant/api-client';
import {
  isMobileAgentNetworkError,
} from '../config/elevant-api';
import { MobileSessionStorageError } from '../storage/mobile-session';

export type MobileServiceErrorCode =
  | 'authentication_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'session_expired'
  | 'network_unavailable'
  | 'request_timeout'
  | 'not_found'
  | 'conflict'
  | 'device_conflict'
  | 'device_in_use'
  | 'device_revoked'
  | 'malformed_response'
  | 'request_failed'
  | 'storage_unavailable'
  | 'cancelled';

const messages: Record<MobileServiceErrorCode, string> = {
  authentication_failed: 'Las credenciales no son válidas.',
  unauthenticated: 'Inicia sesión para continuar.',
  forbidden: 'La cuenta no tiene acceso a Mobile Agent.',
  session_expired: 'La sesión expiró. Inicia sesión nuevamente.',
  network_unavailable: 'No fue posible conectar con ELEVANT.',
  request_timeout: 'ELEVANT tardó demasiado en responder.',
  not_found: 'La operación ya no está disponible.',
  conflict: 'La operación cambió y debe actualizarse.',
  device_conflict: 'El registro seguro del dispositivo entró en conflicto.',
  device_in_use: 'Otro agente usa esta tablet en una operación en curso.',
  device_revoked: 'OCC revocó esta tablet.',
  malformed_response: 'ELEVANT devolvió una respuesta no compatible.',
  request_failed: 'No fue posible completar la solicitud.',
  storage_unavailable: 'No fue posible acceder al almacenamiento seguro.',
  cancelled: 'La solicitud fue cancelada.',
};

/**
 * The Problem Details codes the tablet explains in Spanish (phase 3, block B). The server's title is never shown; a
 * code this version does not know keeps the message of its status, as the deployed APK does.
 */
const problemMessages: ReadonlyMap<string, string> = new Map([
  // 3-N04: the airline's contract stopped being in force before the operation started.
  ['contract_not_in_force',
    'El contrato de la aerolínea no está vigente. No inicies la operación y avisa a OCC.'],
]);

type MobileServiceErrorOptions = Readonly<{
  status?: number;
  traceId?: string;
  retryable?: boolean;
  problemCode?: string;
}>;

/** A Problem Details code as the API sends it (snake_case), or undefined. */
function safeProblemCode(value: string | undefined) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value)
    ? value
    : undefined;
}

function messageFor(code: MobileServiceErrorCode, problemCode: string | undefined) {
  return (problemCode === undefined ? undefined : problemMessages.get(problemCode)) ?? messages[code];
}

function safeTraceId(value: string | undefined) {
  if (typeof value !== 'string') return undefined;
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .trim()
    .slice(0, 128);
  return sanitized || undefined;
}

export class MobileServiceError extends Error {
  readonly code: MobileServiceErrorCode;
  readonly status: number | undefined;
  readonly traceId: string | undefined;
  readonly retryable: boolean;
  /**
   * The Problem Details code the API sent (`contract_not_in_force`, 3-N04), so a screen explains the cause; `code`
   * stays the kind of failure every screen already handles.
   */
  readonly problemCode: string | undefined;

  constructor(
    code: MobileServiceErrorCode,
    options: MobileServiceErrorOptions = {},
  ) {
    super(messageFor(code, safeProblemCode(options.problemCode)));
    this.name = 'MobileServiceError';
    this.code = code;
    this.status = Number.isInteger(options.status) ? options.status : undefined;
    this.traceId = safeTraceId(options.traceId);
    this.problemCode = safeProblemCode(options.problemCode);
    this.retryable =
      options.retryable ??
      [
        'network_unavailable',
        'request_timeout',
        'request_failed',
        'storage_unavailable',
      ].includes(code);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isAbortError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

export function asMobileServiceError(
  error: unknown,
  context: 'login' | 'authenticated' = 'authenticated',
) {
  if (error instanceof MobileServiceError) return error;
  if (isAbortError(error)) return new MobileServiceError('cancelled');
  if (isMobileAgentNetworkError(error)) {
    return new MobileServiceError(
      error.reason === 'timeout' ? 'request_timeout' : 'network_unavailable',
    );
  }
  if (error instanceof MobileSessionStorageError) {
    return new MobileServiceError('storage_unavailable');
  }
  if (error instanceof ElevantApiError) {
    if (error.kind === 'malformed-response') {
      return new MobileServiceError('malformed_response', {
        status: error.status,
        traceId: error.traceId,
      });
    }
    // 2-N02: the server names why the tablet cannot be used by this account.
    if (error.code === 'device_in_use_by_active_agent') {
      return new MobileServiceError('device_in_use', {
        status: error.status,
        traceId: error.traceId,
        retryable: false,
      });
    }
    if (error.code === 'device_revoked') {
      return new MobileServiceError('device_revoked', {
        status: error.status,
        traceId: error.traceId,
        retryable: false,
      });
    }
    if (error.status === 401) {
      return new MobileServiceError(
        context === 'login' ? 'authentication_failed' : 'unauthenticated',
        { status: error.status, traceId: error.traceId },
      );
    }
    if (error.status === 403) {
      return new MobileServiceError('forbidden', {
        status: error.status,
        traceId: error.traceId,
      });
    }
    // 3-N04: the Problem Details code travels with the failure, so a screen names the cause (the contract that is no
    // longer in force) while every screen keeps reacting to the kind of failure it already knows.
    if (error.status === 404) {
      return new MobileServiceError('not_found', {
        status: error.status,
        traceId: error.traceId,
        problemCode: error.code,
      });
    }
    if (error.status === 409) {
      return new MobileServiceError('conflict', {
        status: error.status,
        traceId: error.traceId,
        problemCode: error.code,
      });
    }

    return new MobileServiceError('request_failed', {
      status: error.status,
      traceId: error.traceId,
      retryable: error.status >= 500 || error.status === 429,
      problemCode: error.code,
    });
  }

  return new MobileServiceError('request_failed');
}
