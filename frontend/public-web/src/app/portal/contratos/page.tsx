import type { Metadata } from "next";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

export const metadata: Metadata = { title: "Contratos" };

export default function ContractsPage() {
  return <AirlinePortalPage view="contracts" />;
}
