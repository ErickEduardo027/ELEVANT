import type { Metadata } from "next";

import { PortalContracts } from "@/components/portal/PortalContracts";

export const metadata: Metadata = { title: "Contratos" };

export default function ContractsPage() {
  return <PortalContracts />;
}
