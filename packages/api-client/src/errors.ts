export type ElevantApiErrorKind = "http" | "malformed-response";
/** Machine-readable Problem Details codes the clients act on. */
/** Contract validity and drawn-signature codes (ADR-0025) the contract screens explain. */
const CONTRACT_CODES = ["validity_pending", "airline_signature_pending", "signature_image_invalid", "renewal_mode_invalid",
  "valid_to_required", "dates_invalid", "valid_from_past", "renewal_term_required", "renewal_term_invalid",
  "renewal_notice_invalid", "termination_notice_invalid", "termination_terms_too_long", "packages_out_of_range"] as const;
export type ElevantApiErrorCode = "password_change_required" | "password_policy" | "invalid_link" | "refresh_rotated" |
  (typeof CONTRACT_CODES)[number];
export const ELEVANT_API_ERROR_CODES: readonly ElevantApiErrorCode[] = ["password_change_required", "password_policy",
  "invalid_link", "refresh_rotated", ...CONTRACT_CODES];

/** Rules a rejected stand coverage or stand placement breaks (ADR-0030); the screens explain each one. */
export const ELEVANT_RULE_REASONS = ["window_invalid", "no_stands", "stand_inactive", "stand_other_terminal",
  "too_many_stands", "driver_license_required", "vehicle_required", "agent_inactive", "airport_permit_required",
  "bridge_qualification_required", "shift_not_covering", "absent", "agent_overlap", "mentor_required",
  "mentor_not_eligible", "stand_taken", "stand_cancelled", "stand_narrowbody_only", "neighbour_widebody",
  // Invoicing from operations (ADR-0035).
  "mixed_airline", "already_invoiced", "operation_not_approved", "nothing_to_invoice"] as const;
export type ElevantRuleReason = (typeof ELEVANT_RULE_REASONS)[number];

interface ElevantApiErrorOptions {
  readonly kind: ElevantApiErrorKind;
  readonly status: number;
  readonly title?: string | null | undefined;
  readonly traceId?: string | null | undefined;
  readonly code?: ElevantApiErrorCode | undefined;
  readonly reasons?: readonly unknown[] | undefined;
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
  readonly code: ElevantApiErrorCode | undefined;
  /** Known rule codes only; anything else the server sent is dropped. */
  readonly reasons: readonly ElevantRuleReason[];

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
    this.code = options.code;
    this.reasons = [...new Set((options.reasons ?? []).filter((reason): reason is ElevantRuleReason =>
      ELEVANT_RULE_REASONS.includes(reason as ElevantRuleReason)))];
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
