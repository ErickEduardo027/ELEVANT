import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { DevelopmentAirlinePortal } from "@/components/live/DevelopmentAirlinePortal";

export default async function DevelopmentAirlinePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const host = (await headers()).get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i.test(host)) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_ELEVANT_API_URL;
  if (!baseUrl) {
    return <main style={{ padding: "3rem" }}>
      Configura NEXT_PUBLIC_ELEVANT_API_URL en el entorno local para conectar el portal.
    </main>;
  }

  return <DevelopmentAirlinePortal baseUrl={baseUrl} />;
}
