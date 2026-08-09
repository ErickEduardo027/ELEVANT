import type { Metadata } from "next";

import {
  AuthExperience,
  type AuthMode,
} from "@/components/auth/AuthExperience";

export const metadata: Metadata = {
  title: "Acceso de aerolíneas",
  description:
    "Experiencia local de demostración para el futuro acceso autorizado de aerolíneas en ELEVANT.",
  robots: {
    index: false,
    follow: false,
  },
};

type LoginPageProps = {
  searchParams: Promise<{ mode?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = await searchParams;
  const requestedMode = Array.isArray(parameters.mode)
    ? parameters.mode[0]
    : parameters.mode;
  const initialMode: AuthMode =
    requestedMode === "register" ? "register" : "login";

  return <AuthExperience initialMode={initialMode} />;
}
