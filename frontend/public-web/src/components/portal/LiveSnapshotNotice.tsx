"use client";

import type { LiveSnapshot } from "./useLiveSnapshot";
import styles from "./AirlinePortalPage.module.css";

/**
 * 4-N25: how a portal view that already shows its data tells that it is being read again, or that the last read failed
 * and what is on screen is the previous snapshot. Without data on screen the view shows its own loading and error states.
 */
export function LiveSnapshotNotice({ snapshot }: { snapshot: LiveSnapshot<unknown> }) {
  if (snapshot.data === null) return null;
  if (snapshot.failed) return <div role="alert" className={styles.note}>
    <p>No se pudo actualizar. Mostramos los últimos datos.</p>
    <button type="button" className={styles.loadMore} onClick={snapshot.retry}>Reintentar</button>
  </div>;
  return snapshot.refreshing ? <p role="status" className={styles.note}>Actualizando…</p> : null;
}
