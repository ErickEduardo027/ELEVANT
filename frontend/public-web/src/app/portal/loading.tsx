import styles from "./route-state.module.css";

export default function PortalLoading() {
  return (
    <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
      <span>Preparando consulta autorizada</span>
      <div className={styles.titleSkeleton} aria-hidden="true" />
      <div className={styles.cardGrid} aria-hidden="true">
        <i /><i /><i /><i />
      </div>
      <p>Aplicando el alcance de tu aerolínea y estación.</p>
    </div>
  );
}
