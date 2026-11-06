"use client";

import { useEffect } from "react";
import { useAirlineSession, type AirlineStandingState } from "@/components/auth/AirlineSessionProvider";

const LOADING: AirlineStandingState = { status: "loading", data: null };

/**
 * The airline's standing for a screen that shows it (2-N32): asks the session to read it, once per session and
 * again when the airline's contracts change. A screen keeps working while it loads or when it cannot be read.
 */
export function useAirlineStanding(): { standing: AirlineStandingState; retry: () => void } {
  const session = useAirlineSession() as Partial<ReturnType<typeof useAirlineSession>>;
  const request = session.requestStanding;
  useEffect(() => { request?.(); }, [request]);
  return { standing: session.standing ?? LOADING, retry: session.retryStanding ?? (() => {}) };
}
