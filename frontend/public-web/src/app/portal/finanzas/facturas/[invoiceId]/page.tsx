import type { Metadata } from "next";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

export const metadata: Metadata = { title: "Detalle de factura" };

type InvoiceDetailPageProps = {
  params: Promise<{ invoiceId: string }>;
};

export default async function InvoiceDetailPage({ params }: InvoiceDetailPageProps) {
  const { invoiceId } = await params;
  return <AirlinePortalPage view="invoiceDetail" invoiceId={invoiceId} />;
}