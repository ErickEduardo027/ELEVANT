import type { Metadata } from "next";

import { PortalDataBridge } from "@/components/portal/PortalDataBridge";

export const metadata: Metadata = {
  title: "Vuelos",
};

export default function PortalFlightsPage() {
  return <PortalDataBridge view="flights" />;
}
