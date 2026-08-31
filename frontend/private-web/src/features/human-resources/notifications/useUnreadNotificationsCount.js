import { useEffect, useState } from 'react';
import {
  getHumanResourcesUnreadNotificationsCount,
  subscribeHumanResourcesNotifications,
} from '../../../services/humanResourcesNotificationsService';

export function useUnreadNotificationsCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
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
  }, []);

  return count;
}

