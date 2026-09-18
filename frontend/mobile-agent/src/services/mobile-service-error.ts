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
  malformed_response: 'ELEVANT devolvió una respuesta no compatible.',
  request_failed: 'No fue posible completar la solicitud.',
  storage_unavailable: 'No fue posible acceder al almacenamiento seguro.',
  cancelled: 'La solicitud fue cancelada.',
};

type MobileServiceErrorOptions = Readonly<{
  status?: number;
  traceId?: string;
  retryable?: boolean;
}>;

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

  constructor(
    code: MobileServiceErrorCode,
    options: MobileServiceErrorOptions = {},
  ) {
    super(messages[code]);
    this.name = 'MobileServiceError';
    this.code = code;
    this.status = Number.isInteger(options.status) ? options.status : undefined;
    this.traceId = safeTraceId(options.traceId);
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
    if (error.status === 404) {
      return new MobileServiceError('not_found', {
        status: error.status,
        traceId: error.traceId,
      });
    }
    if (error.status === 409) {
      return new MobileServiceError('conflict', {
        status: error.status,
        traceId: error.traceId,
      });
    }

    return new MobileServiceError('request_failed', {
      status: error.status,
      traceId: error.traceId,
      retryable: error.status >= 500 || error.status === 429,
    });
  }

  return new MobileServiceError('request_failed');
}
