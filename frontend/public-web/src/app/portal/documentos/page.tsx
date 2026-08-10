import type { Metadata } from "next";

import { PortalDocuments } from "@/components/portal/PortalDocuments";

export const metadata: Metadata = { title: "Documentos" };

export default function DocumentsPage() {
  return <PortalDocuments />;
}
