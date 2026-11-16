import { useEffect } from 'react';
import { createPresenceLease } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../../config/elevantApiClient';
import { readSession } from '../auth/authService';

// getRandomValues also works on private HTTP origins where randomUUID is unavailable.
function presenceClientId() {
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Session-bound side effect; it neither publishes auth state nor updates Panorama. */
export function useWebPresence(session, enabled) {
  useEffect(() => {
    if (!enabled || session?.role !== 'ADMIN_OCC' || !session?.token) return undefined;
    const token = session.token;
    let client;
    let clientId;
    try {
      clientId = presenceClientId();
      if (!clientId) return undefined;
      client = createPrivateWebApiClient({ getAccessToken: () => token });
    }
    catch { return undefined; }
    let suspended = false;
    const lease = createPresenceLease({
      clientId,
      getForeground: () => !suspended && document.visibilityState === 'visible' && document.hasFocus(),
      write: async heartbeat => {
        const current = readSession();
        if (heartbeat.mode !== 'closed' && (current?.token !== token || current?.accountId !== session.accountId)) {
          throw Object.assign(new Error('Superseded presence lease'), { status: 401 });
        }
        await client.putOperationalPresence(heartbeat, { keepalive: heartbeat.mode === 'closed' });
      },
    });
    const activity = event => { if (event.isTrusted) lease.activity(); };
    const refresh = () => { void lease.flush(); };
    const hide = event => {
      suspended = true;
      if (event.persisted) { void lease.pause(); } else { void lease.close(); }
    };
    const show = () => { suspended = false; lease.resume(); };
    ['pointerdown', 'keydown', 'wheel'].forEach(type => window.addEventListener(type, activity, { capture: true, passive: true }));
    ['focus', 'blur', 'online'].forEach(type => window.addEventListener(type, refresh));
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    lease.start();
    return () => {
      ['pointerdown', 'keydown', 'wheel'].forEach(type => window.removeEventListener(type, activity, true));
      ['focus', 'blur', 'online'].forEach(type => window.removeEventListener(type, refresh));
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      void lease.close();
    };
  }, [enabled, session?.accountId, session?.role, session?.token]);
}

