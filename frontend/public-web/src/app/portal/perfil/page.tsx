import type { Metadata } from "next";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

export const metadata: Metadata = { title: "Perfil" };

export default function ProfilePage() {
  return <AirlinePortalPage view="profile" />;
}
