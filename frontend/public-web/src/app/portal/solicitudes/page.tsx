import type { Metadata } from "next";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

export const metadata: Metadata = { title: "Solicitudes" };

export default function RequestsPage() {
  return <AirlinePortalPage view="requests" />;
}
