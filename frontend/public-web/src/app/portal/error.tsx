"use client";

import styles from "./route-state.module.css";

export default function PortalError({ reset }: { reset: () => void }) {
  return (
    <div className={styles.error} role="alert">
      <span>Consulta interrumpida</span>
      <h1>No pudimos preparar esta sección.</h1>
      <p>Tu sesión continúa activa. Intenta reconstruir la vista con los datos locales autorizados.</p>
      <button type="button" onClick={reset}>Reintentar consulta</button>
    </div>
  );
}
