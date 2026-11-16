import type { Metadata } from "next";

import { PasswordLinkExperience } from "@/components/auth/PasswordLinkExperience";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type PageProps = { searchParams: Promise<{ token?: string | string[] }> };

export default async function Page({ searchParams }: PageProps) {
  const { token } = await searchParams;
  const value = Array.isArray(token) ? token[0] : token;
  return <PasswordLinkExperience mode="reset" token={value || undefined} />;
}
