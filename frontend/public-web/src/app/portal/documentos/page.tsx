import type { Metadata } from "next";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

export const metadata: Metadata = { title: "Documentos" };

export default function DocumentsPage() {
  return <AirlinePortalPage view="documents" />;
}
