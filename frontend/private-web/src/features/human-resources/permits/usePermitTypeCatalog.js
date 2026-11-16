import { useEffect, useState } from 'react';
import { listPermitTypes, permitTypeCatalog } from '../../../services/humanResourcesSettingsService';

/**
 * The permit types of «Configuración» (ADR-0045) for a form or a list: the system ones until the catalog answers, and
 * only them when it cannot be read. `names` maps each code to its name.
 */
export default function usePermitTypeCatalog() {
  const [catalog, setCatalog] = useState(() => ({ ...permitTypeCatalog(null), status: 'loading' }));
  useEffect(() => {
    const controller = new AbortController();
    listPermitTypes({ signal: controller.signal })
      .then(settings => { if (!controller.signal.aborted) setCatalog({ ...permitTypeCatalog(settings), status: 'ready' }); })
      .catch(() => { if (!controller.signal.aborted) setCatalog({ ...permitTypeCatalog(null), status: 'ready' }); });
    return () => controller.abort();
  }, []);
  return catalog;
}
