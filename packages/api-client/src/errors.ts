export type ElevantApiErrorKind = "http" | "malformed-response";

interface ElevantApiErrorOptions {
  readonly kind: ElevantApiErrorKind;
  readonly status: number;
  readonly title?: string | null | undefined;
  readonly traceId?: string | null | undefined;
}

function safeMetadata(value: string | null | undefined, maximumLength: number) {
  if (typeof value !== "string") return undefined;

  const sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .trim()
    .slice(0, maximumLength);

  return sanitized || undefined;
}

/**
 * Safe API failure metadata. Raw bodies and Problem Details `detail` are never
 * retained, and the message is built exclusively from the HTTP status.
 */
export class ElevantApiError extends Error {
  readonly kind: ElevantApiErrorKind;
  readonly status: number;
  readonly title: string;
  readonly traceId: string | undefined;

  constructor(options: ElevantApiErrorOptions) {
    const message =
      options.kind === "http"
        ? `Elevant API request failed with HTTP status ${options.status}.`
        : `Elevant API returned a malformed response with HTTP status ${options.status}.`;

    super(message);
    this.name = "ElevantApiError";
    this.kind = options.kind;
    this.status = options.status;
    this.title =
      safeMetadata(options.title, 200) ??
      (options.kind === "http" ? "API request failed" : "Malformed API response");
    this.traceId = safeMetadata(options.traceId, 128);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
