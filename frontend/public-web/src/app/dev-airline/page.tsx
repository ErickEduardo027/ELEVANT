import { notFound } from "next/navigation";
import { DevelopmentAirlinePortal } from "@/components/live/DevelopmentAirlinePortal";

export default function DevelopmentAirlinePage() {
  if (process.env.NODE_ENV !== "development") notFound();

  const baseUrl = process.env.NEXT_PUBLIC_ELEVANT_API_URL;
  if (!baseUrl) {
    return <main style={{ padding: "3rem" }}>
      Configura NEXT_PUBLIC_ELEVANT_API_URL en el entorno local para conectar el portal.
    </main>;
  }

  return <DevelopmentAirlinePortal baseUrl={baseUrl} />;
}
