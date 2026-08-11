import type { Metadata } from "next";

import {
  AuthExperience,
  type AuthMode,
} from "@/components/auth/AuthExperience";
import { resolveSafeReturnTo } from "@/lib/mock-auth";

export const metadata: Metadata = {
  title: "Acceso de aerolíneas",
  description:
    "Acceso demostrativo y solicitud de afiliación para aerolíneas en ELEVANT.",
  robots: {
    index: false,
    follow: false,
  },
};

type LoginPageProps = {
  searchParams: Promise<{
    mode?: string | string[];
    returnTo?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = await searchParams;
  const requestedMode = Array.isArray(parameters.mode)
    ? parameters.mode[0]
    : parameters.mode;
  const initialMode: AuthMode =
    requestedMode === "register" ? "register" : "login";
  const returnTo = resolveSafeReturnTo(parameters.returnTo);

  return <AuthExperience initialMode={initialMode} returnTo={returnTo} />;
}
