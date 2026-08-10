import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PortalGuard } from "@/components/portal/PortalGuard";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalWorkspaceProvider } from "@/components/portal/PortalWorkspace";

export const metadata: Metadata = {
  title: {
    default: "Portal de aerolíneas",
    template: "%s · Portal ELEVANT",
  },
  description:
    "Consulta autorizada de vuelos, servicios y evidencias operacionales en ELEVANT.",
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <PortalGuard>
      <PortalWorkspaceProvider>
        <PortalShell>{children}</PortalShell>
      </PortalWorkspaceProvider>
    </PortalGuard>
  );
}
