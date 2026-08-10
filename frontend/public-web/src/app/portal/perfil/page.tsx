import type { Metadata } from "next";

import { PortalProfile } from "@/components/portal/PortalProfile";

export const metadata: Metadata = { title: "Perfil" };

export default function ProfilePage() {
  return <PortalProfile />;
}
