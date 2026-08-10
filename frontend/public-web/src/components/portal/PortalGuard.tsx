"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useMockSession } from "@/components/auth/MockSessionProvider";

import styles from "./PortalShell.module.css";

export function PortalGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, status } = useMockSession();

  useEffect(() => {
    if (status === "anonymous" || (status === "authenticated" && !session)) {
      const returnTo = encodeURIComponent(pathname || "/portal");
      router.replace(`/login?mode=login&returnTo=${returnTo}`);
    }
  }, [pathname, router, session, status]);

  if (status !== "authenticated" || !session) {
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
