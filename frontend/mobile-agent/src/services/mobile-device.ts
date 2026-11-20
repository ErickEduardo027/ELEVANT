import type { RegisterMobileDeviceResponse } from '@elevant/api-client';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createMobileAgentApiClient } from '../config/elevant-api';
import * as Crypto from 'expo-crypto';
import {
  readMobileInstallationId,
  readOrCreateMobileInstallationId,
} from '../storage/mobile-session';
import {
  asMobileServiceError,
  MobileServiceError,
} from './mobile-service-error';

/**
 * The credential that registers or releases the tablet and the session revision it belongs to. A renewal changes the
 * token and keeps the session (S3, ADR-0046), so what the session confirmed is tied to `sessionId`.
 */
export type MobileDeviceRegistrationContext = Readonly<{
  accessToken: string;
  sessionId: string;
}>;

export type RegisterCurrentMobileDeviceOptions = Readonly<{
  signal?: AbortSignal;
  /**
   * Solo para lecturas periódicas: reutiliza el registro ya confirmado en la
   * misma sesión, también tras renovar su token. Las escrituras siempre vuelven
   * a registrar el dispositivo.
   */
  reuseForSession?: boolean;
}>;

let confirmedForSession: Readonly<{ sessionId: string; device: RegisteredMobileDevice }> | null = null;

/** How long sign-out waits for the release before it clears the session anyway. */
export const MOBILE_RELEASE_TIMEOUT_MS = 5_000;

export type RegisteredMobileDevice = Readonly<{
  installationId: string;
  registration: RegisterMobileDeviceResponse;
}>;

function currentPlatform(): 'Android' | 'Ios' {
  if (Platform.OS === 'android') return 'Android';
  if (Platform.OS === 'ios') return 'Ios';
  throw new MobileServiceError('request_failed');
}

function currentAppVersion() {
  const configured = Constants.expoConfig?.version?.trim();
  return configured && configured.length <= 32 ? configured : '1.0.0';
}

function currentOperatingSystemVersion() {
  const version = String(Platform.Version).trim();
  return version && version.length <= 64 ? version : undefined;
}

/**
 * The newest registration the session confirmed. Registrations of the same session can answer out of order (a write
 * and a periodic read at once), and the release at sign-out names the newest one (2-N02).
 */
function newestOfSession(sessionId: string, device: RegisteredMobileDevice): RegisteredMobileDevice {
  const previous = confirmedForSession?.sessionId === sessionId &&
    confirmedForSession.device.installationId === device.installationId
    ? confirmedForSession.device
    : null;
  return previous &&
    Date.parse(previous.registration.lastSeenAt) > Date.parse(device.registration.lastSeenAt)
    ? previous
    : device;
}

export async function registerCurrentMobileDevice(
  context: MobileDeviceRegistrationContext,
  options: RegisterCurrentMobileDeviceOptions = {},
): Promise<RegisteredMobileDevice> {
  if (options.reuseForSession && confirmedForSession?.sessionId === context.sessionId) {
    return confirmedForSession.device;
  }
  try {
    const installationId = await readOrCreateMobileInstallationId();
    const platform = currentPlatform();
    const registration = await createMobileAgentApiClient({
      getAccessToken: () => context.accessToken,
    }).registerMobileDevice(
      {
        installationId,
        platform,
        appVersion: currentAppVersion(),
        operatingSystemVersion: currentOperatingSystemVersion(),
      },
      { signal: options.signal },
    );

    if (
      registration.installationId.toLowerCase() !== installationId ||
      registration.platform !== platform
    ) {
      throw new MobileServiceError('malformed_response');
    }

    const device = { installationId, registration };
    confirmedForSession = {
      sessionId: context.sessionId,
      device: newestOfSession(context.sessionId, device),
    };
    return device;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    // A tablet held by an agent with an operation in progress or revoked by OCC keeps its own code (2-N02).
    if (normalized.code === 'conflict') {
      throw new MobileServiceError('device_conflict', {
        status: normalized.status,
        traceId: normalized.traceId,
        retryable: false,
      });
    }
    throw normalized;
  }
}

/** Forgets the registration confirmed for the session that ends. */
export function forgetConfirmedMobileDevice() {
  confirmedForSession = null;
}

/**
 * Whether a read of the session reuses the registration it confirmed (`reuseForSession`). «Liberar» in OCC closes that
 * binding and keeps the session, so a read ELEVANT refuses with it registers the tablet again (ADR-0046).
 */
export function hasConfirmedMobileDevice(sessionId: string) {
  return confirmedForSession?.sessionId === sessionId;
}

/**
 * Frees the tablet when the agent signs out (2-N02), so the next agent who signs in on it holds it. It is best
 * effort: it never blocks the sign-out, and a tablet another agent, OCC or the end of the agent's duty already freed
 * answers `device_not_bound`. The release names the newest registration this session confirmed, also after the session
 * renewed its token: a renewal keeps the binding (S3, ADR-0046). Each sign-in opens its own binding, so a release that
 * arrives after the agent signed in on the tablet again answers `version_conflict` and frees nothing, while the
 * session's own writes never refuse it. Answers whether the server released it.
 */
export async function releaseCurrentMobileDevice(
  context: MobileDeviceRegistrationContext,
): Promise<boolean> {
  const confirmed = confirmedForSession?.sessionId === context.sessionId
    ? confirmedForSession.device
    : null;
  forgetConfirmedMobileDevice();
  let installationId: string | null;
  try {
    installationId = await readMobileInstallationId();
  } catch {
    return false;
  }
  if (!installationId) return false;
  // Without a registration confirmed in this run of the app the release sends no version, as before.
  const expectedVersion = confirmed?.installationId === installationId
    ? confirmed.registration.lastSeenAt
    : undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MOBILE_RELEASE_TIMEOUT_MS);
  try {
    await createMobileAgentApiClient({
      getAccessToken: () => context.accessToken,
    }).releaseMobileDevice(
      expectedVersion ? { installationId, expectedVersion } : { installationId },
      Crypto.randomUUID().toLowerCase(),
      { signal: controller.signal },
    );
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
