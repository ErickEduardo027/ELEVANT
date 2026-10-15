import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const LOCAL_PASSWORD_KEY = 'elevant.mobile.local-development-password.v1';
const LOCAL_PASSWORD_SALT = 'elevant-mobile-local-development-v1';

export const LOCAL_DEVELOPMENT_EMAIL = 'agente.demo@elevant.local';
export const LOCAL_DEVELOPMENT_TEMPORARY_PASSWORD = 'ElevantDemo2026!';
export const LOCAL_DEVELOPMENT_ACCESS_TOKEN = 'local-development-session';

export function isLocalDevelopmentAuthEnabled() {
  return __DEV__ && process.env.EXPO_PUBLIC_ENABLE_LOCAL_AUTH === 'true';
}

async function passwordDigest(password: string) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${LOCAL_PASSWORD_SALT}:${password}`,
  );
}

export async function authenticateLocalDevelopmentAgent(
  email: string,
  password: string,
): Promise<'authenticated' | 'password_change_required' | 'invalid'> {
  if (!isLocalDevelopmentAuthEnabled()) return 'invalid';
  if (email.trim().toLowerCase() !== LOCAL_DEVELOPMENT_EMAIL) return 'invalid';

  const configuredDigest = await SecureStore.getItemAsync(LOCAL_PASSWORD_KEY);
  if (!configuredDigest) {
    return password === LOCAL_DEVELOPMENT_TEMPORARY_PASSWORD
      ? 'password_change_required'
      : 'invalid';
  }

  return configuredDigest === await passwordDigest(password)
    ? 'authenticated'
    : 'invalid';
}

export async function changeLocalDevelopmentPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
) {
  if (newPassword.length < 14 || newPassword === currentPassword) return false;
  const result = await authenticateLocalDevelopmentAgent(email, currentPassword);
  if (result !== 'password_change_required' && result !== 'authenticated') {
    return false;
  }

  await SecureStore.setItemAsync(
    LOCAL_PASSWORD_KEY,
    await passwordDigest(newPassword),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
  return true;
}

export function isLocalDevelopmentAccessToken(accessToken: string) {
  return isLocalDevelopmentAuthEnabled() &&
    accessToken === LOCAL_DEVELOPMENT_ACCESS_TOKEN;
}
