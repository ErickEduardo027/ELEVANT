import { useEffect } from 'react';
import { AppState } from 'react-native';
import { synchronizePendingRecords } from '../services/automatic-sync';

export function useAutomaticSync() {
  useEffect(() => {
    const synchronize = () => { void synchronizePendingRecords().catch(() => undefined); };
    synchronize();
    const timer = setInterval(synchronize, 10_000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') synchronize();
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
}
