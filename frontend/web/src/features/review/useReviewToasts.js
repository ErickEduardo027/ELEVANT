import { useEffect, useRef, useState } from 'react';

const TOAST_TTL_MS = 5000;

export function useReviewToasts() {
  const idCounterRef = useRef(0);
  const mountedRef = useRef(true);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function pushToast(message, kind = 'success') {
    const id = `review-toast-${idCounterRef.current++}`;
    setToasts(current => [...current, { id, message, kind }]);
    setTimeout(() => {
      if (mountedRef.current) setToasts(current => current.filter(toast => toast.id !== id));
    }, TOAST_TTL_MS);
    return id;
  }

  function dismissToast(id) {
    setToasts(current => current.filter(toast => toast.id !== id));
  }

  return { toasts, pushToast, dismissToast };
}
