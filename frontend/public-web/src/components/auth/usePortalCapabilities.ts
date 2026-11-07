"use client";

import { useEffect, useState } from "react";
import type { AirlinePortalCapabilitiesData } from "@elevant/api-client";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";

/**
 * What the signed-in portal user may do for its airline (2-N20): representatives and signers sign contracts and
 * submit permits. `unknown` when it cannot be read: the screen keeps its form and the server still decides.
 */
export type PortalCapabilitiesState =
  | { status: "loading" | "unknown"; me: null }
  | { status: "ready"; me: AirlinePortalCapabilitiesData };

/** Reads the capabilities once per screen; a screen whose session cannot read them keeps working. */
export function usePortalCapabilities(): PortalCapabilitiesState {
  const session = useAirlineSession() as Partial<ReturnType<typeof useAirlineSession>>;
  const read = session.getPortalUsers;
  const [state, setState] = useState<PortalCapabilitiesState>({ status: read ? "loading" : "unknown", me: null });
  useEffect(() => {
    if (!read) return;
    let active = true;
    read().then(data => { if (active) setState({ status: "ready", me: data.me }); })
      .catch(() => { if (active) setState({ status: "unknown", me: null }); });
    return () => { active = false; };
  }, [read]);
  return state;
}
