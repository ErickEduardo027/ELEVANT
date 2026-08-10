import type { Metadata } from "next";

import { PortalReports } from "@/components/portal/PortalReports";

export const metadata: Metadata = { title: "Reportes" };

export default function ReportsPage() {
  return <PortalReports />;
}
