import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/geist";

import { MockSessionProvider } from "@/components/auth/MockSessionProvider";
import { AirlineSessionProvider } from "@/components/auth/AirlineSessionProvider";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "ELEVANT · Del vuelo a la evidencia",
    template: "%s · ELEVANT",
  },
  description:
    "ELEVANT conecta la planificación, la ejecución en rampa, la validación y la consulta autorizada de una rotación.",
  applicationName: "ELEVANT",
  keywords: [
    "ground handling",
    "operaciones en tierra",
    "aviación",
    "rampa",
    "Punta Cana",
  ],
  authors: [{ name: "ELEVANT" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_DO",
    title: "ELEVANT · Cada rotación deja una historia verificable",
    description:
      "Un recorrido propuesto para conectar la planificación, la rampa y la consulta autorizada.",
    siteName: "ELEVANT",
    images: [
      {
        url: "/assets/generated/hero-ramp.webp",
        width: 1672,
        height: 939,
        alt: "Operación de asistencia en tierra junto a una aeronave",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ELEVANT · Del vuelo a la evidencia",
    description:
      "Una experiencia demostrable para conectar el recorrido de una rotación.",
    images: ["/assets/generated/hero-ramp.webp"],
  },
  icons: {
    icon: "/favicon-64.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#020712",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" data-scroll-behavior="smooth">
      <body>
        <MockSessionProvider><AirlineSessionProvider>{children}</AirlineSessionProvider></MockSessionProvider>
      </body>
    </html>
  );
}
