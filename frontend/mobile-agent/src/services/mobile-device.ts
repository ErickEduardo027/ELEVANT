import type { RegisterMobileDeviceResponse } from '@elevant/api-client';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createMobileAgentApiClient } from '../config/elevant-api';
import { readOrCreateMobileInstallationId } from '../storage/mobile-session';
import {
  asMobileServiceError,
  MobileServiceError,
} from './mobile-service-error';

export type MobileDeviceRegistrationContext = Readonly<{
  accessToken: string;
}>;

export type RegisterCurrentMobileDeviceOptions = Readonly<{
  signal?: AbortSignal;
}>;

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

    return { installationId, registration };
  } catch (error) {
    const normalized = asMobileServiceError(error);
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
