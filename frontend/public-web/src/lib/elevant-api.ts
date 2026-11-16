import {
  createElevantApiClient,
  type ElevantApiClientOptions,
} from "@elevant/api-client";

export type PublicWebApiClientOptions = Omit<
  ElevantApiClientOptions,
  "baseUrl"
> & {
  readonly baseUrl?: string;
};

/**
 * Creates an API client without reading or persisting the current mock session.
 * Authentication can be supplied later by the calling remote adapter.
 */
export function createPublicWebApiClient(
  options: PublicWebApiClientOptions = {},
) {
  const baseUrl =
    options.baseUrl ?? process.env.NEXT_PUBLIC_ELEVANT_API_URL;
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    throw new Error(
      "NEXT_PUBLIC_ELEVANT_API_URL is required to create the ELEVANT API client.",
    );
  }

  return createElevantApiClient({
    ...options,
    baseUrl,
  });
}
