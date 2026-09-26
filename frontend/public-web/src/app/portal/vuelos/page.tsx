import type { Metadata } from "next";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

export const metadata: Metadata = {
  title: "Vuelos",
};

export default function PortalFlightsPage() {
  return <AirlinePortalPage view="flights" />;
}
