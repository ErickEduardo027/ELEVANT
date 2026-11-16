import { createPresenceLease } from '@elevant/api-client';
import * as Crypto from 'expo-crypto';
import { AppState, type NativeEventSubscription } from 'react-native';
import { createMobileAgentApiClient } from '../config/elevant-api';
import { getMobileSessionRequestContext } from './mobile-auth';
import { MobileServiceError } from './mobile-service-error';

type Lease = ReturnType<typeof createPresenceLease>;
let running = false;
let revision = 0;
let identity = '';
let checking = false;
let lease: Lease | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let subscription: NativeEventSubscription | undefined;

/** Presence is ephemeral; no heartbeat enters an operational outbox. */
export async function refreshMobilePresenceSession() {
  if (!running) return;
  const request = ++revision;
  checking = true;
  void lease?.pause(false);
  let context: Awaited<ReturnType<typeof getMobileSessionRequestContext>> | null = null;
  try { context = await getMobileSessionRequestContext(); }
  catch (error) {
    if (!(error instanceof MobileServiceError) || !['unauthenticated', 'session_expired'].includes(error.code)) {
      return; // Uncertain storage must not publish activity for a possibly superseded account.
    }
  }
  if (!running || request !== revision) return;
  checking = false;
  const next = context ? context.sessionId + '|' + context.session.actor.accountId + '|' + context.accessToken : '';
  if (next === identity) { if (AppState.currentState === 'active') lease?.resume(); return; }
  void lease?.close();
  lease = undefined;
  identity = next;
  if (!context) return;
  try {
  const token = context.accessToken;
  const client = createMobileAgentApiClient({ getAccessToken: () => token });
  lease = createPresenceLease({ clientId: Crypto.randomUUID(),
    getForeground: () => AppState.currentState === 'active',
    write: async heartbeat => {
      if (heartbeat.mode !== 'closed') {
        if (checking || identity !== next) throw Object.assign(new Error('Presence identity is being checked'), { status: 409 });
        const current = await getMobileSessionRequestContext();
        const currentKey = current.sessionId + '|' + current.session.actor.accountId + '|' + current.accessToken;
        if (checking || identity !== next || currentKey !== next) {
          throw Object.assign(new Error('Superseded presence identity'), { status: 409 });
        }
      }
      await client.putOperationalPresence(heartbeat);
    } });
  lease.start();
  if (AppState.currentState !== 'active') void lease.pause();
  } catch { identity = ''; lease = undefined; }
}

export function recordMobilePresenceActivity() { if (!checking) lease?.activity(); }

function schedule() {
  if (interval !== undefined) clearInterval(interval);
  interval = setInterval(() => { void refreshMobilePresenceSession(); }, 30_000);
}

export function startMobilePresence() {
  if (running) return;
  running = true;
  void refreshMobilePresenceSession();
  if (AppState.currentState === 'active') schedule();
  subscription = AppState.addEventListener('change', state => {
    if (state === 'active') {
      schedule();
      void refreshMobilePresenceSession().then(() => { if (running) lease?.resume(); });
    } else {
      if (interval !== undefined) { clearInterval(interval); interval = undefined; }
      void lease?.pause();
    }
  });
}

export function stopMobilePresence() {
  running = false;
  revision += 1;
  subscription?.remove(); subscription = undefined;
  if (interval !== undefined) clearInterval(interval);
  interval = undefined;
  void lease?.close();
  lease = undefined; identity = '';
}
