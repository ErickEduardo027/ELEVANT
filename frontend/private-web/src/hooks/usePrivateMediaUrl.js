import { useEffect, useState } from 'react';
import { readSession } from '../features/auth/authService';
import { commercialMediaUrl } from '../services/commercialGovernanceApi';

export function usePrivateMediaUrl(url) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!url) { setSrc(null); return undefined; }
    if (!url.startsWith('/api/v1/media/')) { setSrc(url); return undefined; }
    setSrc(null);
    const controller = new AbortController();
    let objectUrl;
    fetch(commercialMediaUrl(url), {
      headers: { Authorization: `Bearer ${readSession()?.token ?? ''}` },
      signal: controller.signal,
    }).then(response => {
      if (!response.ok) throw new Error('No se pudo cargar el medio.');
      return response.blob();
    }).then(blob => {
      if (!controller.signal.aborted) {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      }
    }).catch(() => { if (!controller.signal.aborted) setSrc(null); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return src;
}
