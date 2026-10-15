import * as Network from 'expo-network';
import { useEffect, useState } from 'react';

export type ConnectivityState = 'checking' | 'online' | 'offline';

function normalize(state: Network.NetworkState): ConnectivityState {
  return state.isConnected === false || state.isInternetReachable === false
    ? 'offline'
    : state.isConnected === true ? 'online' : 'checking';
}

export function useConnectivity() {
  const [state, setState] = useState<ConnectivityState>('checking');

  useEffect(() => {
    let mounted = true;
    void Network.getNetworkStateAsync().then(value => {
      if (mounted) setState(normalize(value));
    }).catch(() => {
      if (mounted) setState('checking');
    });
    const subscription = Network.addNetworkStateListener(value => {
      if (mounted) setState(normalize(value));
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return state;
}
