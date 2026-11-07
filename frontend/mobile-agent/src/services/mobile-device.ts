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

export type MobileDeviceRegistrationContext = Readonly<{
  accessToken: string;
}>;

export type RegisterCurrentMobileDeviceOptions = Readonly<{
  signal?: AbortSignal;
  /**
   * Solo para lecturas periódicas: reutiliza el registro ya confirmado con el
   * mismo token. Las escrituras siempre vuelven a registrar el dispositivo.
   */
  reuseForSession?: boolean;
}>;

let confirmedForSession: Readonly<{ accessToken: string; device: RegisteredMobileDevice }> | null = null;

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

export async function registerCurrentMobileDevice(
  context: MobileDeviceRegistrationContext,
  options: RegisterCurrentMobileDeviceOptions = {},
): Promise<RegisteredMobileDevice> {
  if (options.reuseForSession && confirmedForSession?.accessToken === context.accessToken) {
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
    confirmedForSession = { accessToken: context.accessToken, device };
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
 * Frees the tablet when the agent signs out (2-N02), so the next agent who signs in on it holds it. It is best
 * effort: it never blocks the sign-out, and a tablet another agent, OCC or the end of the agent's duty already freed
 * answers `device_not_bound`. Answers whether the server released it.
 */
export async function releaseCurrentMobileDevice(
  context: MobileDeviceRegistrationContext,
): Promise<boolean> {
  forgetConfirmedMobileDevice();
  let installationId: string | null;
  try {
    installationId = await readMobileInstallationId();
  } catch {
    return false;
  }
  if (!installationId) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MOBILE_RELEASE_TIMEOUT_MS);
  try {
    await createMobileAgentApiClient({
      getAccessToken: () => context.accessToken,
    }).releaseMobileDevice(
      { installationId },
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
