import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';
import { synchronizePendingWork } from './mobile-sync-center';

let networkSubscription: { remove(): void } | null = null;
let appStateSubscription: { remove(): void } | null = null;
let activeRequest: AbortController | null = null;
let running = false;

async function synchronizeIfOnline() {
  if (running) return;
  const state = await Network.getNetworkStateAsync().catch(() => null);
  if (!state || state.isConnected === false || state.isInternetReachable === false) return;
  running = true;
  activeRequest?.abort();
  activeRequest = new AbortController();
  try {
    await synchronizePendingWork(activeRequest.signal);
  } catch {
    // The durable outbox remains available for the next connectivity event.
  } finally {
    running = false;
  }
}

function onAppStateChange(state: AppStateStatus) {
  if (state === 'active') void synchronizeIfOnline();
}

export function startAutomaticMobileSync() {
  if (networkSubscription || appStateSubscription) return;
  networkSubscription = Network.addNetworkStateListener(state => {
    if (state.isConnected === true && state.isInternetReachable !== false) {
      void synchronizeIfOnline();
    }
  });
  appStateSubscription = AppState.addEventListener('change', onAppStateChange);
  void synchronizeIfOnline();
}

export function stopAutomaticMobileSync() {
  networkSubscription?.remove();
  appStateSubscription?.remove();
  networkSubscription = null;
  appStateSubscription = null;
  activeRequest?.abort();
  activeRequest = null;
  running = false;
}
