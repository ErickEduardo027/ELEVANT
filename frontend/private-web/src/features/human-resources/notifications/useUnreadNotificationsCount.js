import { useEffect, useState } from 'react';
import {
  getHumanResourcesUnreadNotificationsCount,
  subscribeHumanResourcesNotifications,
} from '../../../services/humanResourcesNotificationsService';

export function useUnreadNotificationsCount({ enabled = true } = {}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;

    let mounted = true;

    getHumanResourcesUnreadNotificationsCount().then(value => {
      if (mounted) setCount(value);
    });

    const unsubscribe = subscribeHumanResourcesNotifications(() => {
      getHumanResourcesUnreadNotificationsCount().then(value => {
        if (mounted) setCount(value);
      });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [enabled]);

  return count;
}
