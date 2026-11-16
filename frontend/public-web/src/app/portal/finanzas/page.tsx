import type { Metadata } from "next";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

export const metadata: Metadata = { title: "Facturas" };

export default function FinancePage() {
  return <AirlinePortalPage view="finance" />;
}
