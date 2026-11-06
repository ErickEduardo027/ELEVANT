const MAXIMUM_LENGTH = 32;
const SAFE_LABEL = /^[\p{L}\p{N} ._-]+$/u;

/**
 * Optional environment label of the airline portal (1-N24), for example «Pruebas». The portal never
 * claims an environment on its own: without `NEXT_PUBLIC_ELEVANT_ENVIRONMENT_LABEL` no label is shown.
 * The variable is read literally so Next inlines it at build time; it is public, never a secret.
 */
export function environmentLabel(
  value: string | undefined = process.env.NEXT_PUBLIC_ELEVANT_ENVIRONMENT_LABEL,
): string | null {
  const label = typeof value === "string" ? value.trim() : "";
  return label.length > 0 && label.length <= MAXIMUM_LENGTH && SAFE_LABEL.test(label) ? label : null;
}
