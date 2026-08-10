import type { Metadata } from "next";

import { PortalFinance } from "@/components/portal/PortalFinance";

export const metadata: Metadata = { title: "Finanzas" };

export default function FinancePage() {
  return <PortalFinance />;
}
