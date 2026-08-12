import { useEffect, useState } from 'react';

// Mismo comportamiento que el useCountUp de referencia en feat/adminocc
// (KpiCard de Admin/OCC): anima el conteo ascendente salvo que el usuario
// prefiera movimiento reducido. Se ubica en src/hooks porque KpiCard ahora
// es un componente compartido entre entornos (Admin/OCC, Gestión Humana).
export function useCountUp(target, { duration = 900, steps = 30 } = {}) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || typeof target !== 'number') {
      setValue(target ?? 0);
      return undefined;
    }

    let step = 0;
    const stepMs = duration / steps;
    const id = setInterval(() => {
      step += 1;
      const progress = Math.min(step / steps, 1);
      setValue(Math.round(target * progress));
      if (progress >= 1) clearInterval(id);
    }, stepMs);

    return () => clearInterval(id);
  }, [target, duration, steps]);

  return value;
}
