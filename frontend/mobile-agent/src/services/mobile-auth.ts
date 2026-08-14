import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = 'elevant:mobile-session';

export type MobileAgent = {
  id: string;
  personnelId?: string;
  email: string;
  name: string;
  role: 'AGENTE_RAMPA';
  roleLabel: string;
};

export type MobileSession = {
  token: string;
  user: MobileAgent;
};

export const MOBILE_API_URL = String(
  process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:4310',
).replace(/\/$/, '');

export async function loginMobileAgent(email: string, password: string): Promise<MobileSession> {
  let response: Response;
  try {
    response = await fetch(`${MOBILE_API_URL}/api/mobile/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error('No fue posible conectar con ELEVANT. Verifica la red y la dirección del backend.');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Credenciales inválidas.');
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  return payload as MobileSession;
}

export async function getMobileSession(): Promise<MobileSession | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MobileSession;
  } catch {
    await AsyncStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export async function logoutMobileAgent() {
  const session = await getMobileSession();
  if (session?.token) {
    void fetch(`${MOBILE_API_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
    }).catch(() => undefined);
  }
  await AsyncStorage.removeItem(SESSION_KEY);
}
