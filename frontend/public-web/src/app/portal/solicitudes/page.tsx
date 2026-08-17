import type { Metadata } from "next";

import { PortalRequests } from "@/components/portal/PortalRequests";

export const metadata: Metadata = { title: "Solicitudes" };

export default function RequestsPage() {
  return <PortalRequests />;
}
