import type { Metadata } from "next";

import { PortalDataBridge } from "@/components/portal/PortalDataBridge";

export const metadata: Metadata = {
  title: "Detalle de vuelo",
};

type PortalFlightDetailPageProps = {
  params: Promise<{ operationId: string }>;
};

export default async function PortalFlightDetailPage({
  params,
}: PortalFlightDetailPageProps) {
  const { operationId } = await params;
  return <PortalDataBridge view="flightDetail" operationId={operationId} />;
}
