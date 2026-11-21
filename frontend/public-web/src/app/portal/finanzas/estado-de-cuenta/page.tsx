import type { Metadata } from "next";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

export const metadata: Metadata = { title: "Estado de cuenta" };

export default function StatementPage() {
  return <AirlinePortalPage view="statement" />;
}