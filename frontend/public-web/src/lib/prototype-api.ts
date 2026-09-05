const CONFIGURATION_NAME = "NEXT_PUBLIC_PROTOTYPE_API_URL";

/**
 * Returns the temporary adapter origin without silently selecting a local
 * prototype. Development release builds set this to the real ELEVANT API
 * origin, so endpoints not implemented by that API fail visibly.
 */
export function getPrototypeApiUrl(): string {
  const configuredValue = process.env.NEXT_PUBLIC_PROTOTYPE_API_URL?.trim();
  if (!configuredValue) {
    throw new Error(`${CONFIGURATION_NAME} is required.`);
  }

  let url: URL;
  try {
    url = new URL(configuredValue);
  } catch {
    throw new Error(`${CONFIGURATION_NAME} must be an absolute HTTP(S) origin.`);
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(`${CONFIGURATION_NAME} must be an absolute HTTP(S) origin.`);
  }

  return url.origin;
}
