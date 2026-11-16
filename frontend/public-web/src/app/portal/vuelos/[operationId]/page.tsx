import type { Metadata } from "next";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

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
  return <AirlinePortalPage view="flightDetail" operationId={operationId} />;
}
