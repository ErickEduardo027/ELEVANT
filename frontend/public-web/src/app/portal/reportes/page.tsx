import type { Metadata } from "next";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

export const metadata: Metadata = { title: "Reportes" };

export default function ReportsPage() {
  return <AirlinePortalPage view="reports" />;
}
