"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";

import styles from "./PortalShell.module.css";

export function PortalGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, status, retry } = useAirlineSession();

  useEffect(() => {
    if (status === "anonymous") {
      const returnTo = encodeURIComponent(pathname || "/portal");
      router.replace(`/login?mode=login&returnTo=${returnTo}`);
    }
  }, [pathname, router, status]);

  if (status === "unavailable") return <main className={styles.guard} role="alert">
    <div><strong>No se pudo verificar tu sesión.</strong>
      <p>Comprueba la conexión con la API y vuelve a intentarlo.</p>
      <button type="button" onClick={() => void retry()}>Reintentar</button>
    </div>
  </main>;

  if (status !== "ready" || !session) {
    return (
      <main className={styles.guard} aria-busy="true">
        <div className={styles.guardMark} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div role="status" aria-live="polite">
          <strong>
            {status === "loading"
              ? "Validando acceso autorizado"
              : "Redirigiendo al acceso"}
          </strong>
          <p>Preparando el contexto operativo de tu aerolínea.</p>
        </div>
      </main>
    );
  }

  return children;
}
