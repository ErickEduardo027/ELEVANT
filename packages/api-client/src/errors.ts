export type ElevantApiErrorKind = "http" | "malformed-response";
/** Machine-readable Problem Details codes the clients act on. */
/** Contract validity and drawn-signature codes (ADR-0025) the contract screens explain. */
const CONTRACT_CODES = ["validity_pending", "airline_signature_pending", "signature_image_invalid", "renewal_mode_invalid",
  "valid_to_required", "dates_invalid", "valid_from_past", "renewal_term_required", "renewal_term_invalid",
  "renewal_notice_invalid", "termination_notice_invalid", "termination_terms_too_long", "packages_out_of_range"] as const;
/**
 * Generic command codes, the same in every module: stale rowversion, reused Idempotency-Key, missing
 * key or expected version, missing or invalid reason, and a route resource that does not exist.
 */
const COMMON_COMMAND_CODES = ["version_conflict", "idempotency_conflict", "idempotency_key_required",
  "expected_version_required", "reason_required", "not_found"] as const;
/**
 * Review of public commercial requests (phase 1): inbox, airline verification, representative
 * confirmation, cancellation and decision; the public intake; and the default codes of the
 * provisioning and airline-catalog screens of Superadministración.
 */
const COMMERCIAL_REQUEST_CODES = ["request_closed", "airline_unverified", "representative_unconfirmed",
  "representative_already_confirmed", "airline_already_contracted", "airline_has_portal_account",
  "airline_code_in_use", "airline_profile_conflict", "airline_identity_locked", "airline_already_linked",
  "profile_not_found", "invalid_airline", "stations_invalid", "confirmation_note_required",
  "invalid_commercial_request", "invalid_inbox_query", "invalid_application", "airline_unavailable",
  "service_unavailable", "receipt_not_found", "request_unavailable", "email_in_use", "invalid_provisioning",
  "invitations_unavailable", "invitation_already_accepted", "registry_check_required"] as const;
/**
 * Contract drafts (phase 1, block B): one code per cause that blocks the submission to Finance (the
 * readiness), the scope, the discard and the observations; the Finance approval codes of each blocking
 * cause; and a contract closed before it activated.
 */
const CONTRACT_DRAFT_CODES = ["invalid_draft", "draft_closed", "draft_in_finance_review", "portal_account_missing",
  "terms_missing", "services_missing", "rates_unconfirmed", "stations_missing", "service_retired", "package_not_eligible",
  "valid_from_not_after_current", "finance_reviewer_missing", "service_not_found", "service_in_package", "scope_invalid",
  "comment_required", "ambiguous_package_coverage", "package_service_not_in_contract", "invalid_contract_decision",
  "contract_terminated"] as const;
/**
 * Finance (phase 1, block C): the discard and retirement of packages and a retired package in a draft
 * (1-N27); the contract amendment (1-C); unit codes in the whole cycle (1-E); and the coded failures of
 * the billing units, the service and charge tariffs and the exchange rates.
 */
const FINANCE_COMMAND_CODES = ["package_not_draft", "package_not_published", "package_retired", "billing_unit_unknown",
  "invalid_amendment", "contract_not_amendable", "draft_in_progress", "no_approved_version", "valid_from_after_current_end",
  "invalid_billing_unit", "billing_unit_exists", "billing_unit_code_locked", "billing_unit_required", "invalid_tariff",
  "tariff_draft_exists", "tariff_not_found", "tariff_empty", "tariff_start_not_after_current", "invalid_charge",
  "charge_code_exists", "charge_not_found", "invalid_exchange_rate", "exchange_rate_exists", "invalid_finance_data"] as const;
/**
 * Catalog of services and closures (phase 1, block D): «Dar de baja» refused while a contract uses the service, the
 * form that never retires, a closure that keeps the service hidden until it is reopened, the publication rules of a
 * service, and the closure workflow. A retired service is `service_retired` (CONTRACT_DRAFT_CODES).
 */
const CATALOG_CODES = ["service_in_active_contract", "retirement_command_required", "closure_requires_reopen",
  "service_code_exists", "invalid_service", "media_invalid", "image_required", "description_too_short",
  "placeholder_name", "invalid_closure", "invalid_closure_query", "closure_pending", "closure_not_pending",
  "closure_self_decision", "service_not_published", "service_already_public", "no_approved_closure"] as const;
/**
 * Superadministración (phase 1, block E): the email of a provisioning that already has an account and why it can or
 * cannot be linked (1-N13), the invalid portal user data of Clientes and the invalid outbox filter (1-N22). The
 * provisioning codes it shares with Contratos (`email_in_use`, `request_unavailable`…) live in
 * COMMERCIAL_REQUEST_CODES.
 */
const GOVERNANCE_ACCOUNT_CODES = ["email_has_account", "email_in_use_other_airline", "email_in_use_internal",
  "account_disabled", "account_not_found", "invalid_client_user", "invalid_email_outbox_query"] as const;
/**
 * Contract lifecycle (phase 2, block A): the document, its signatures and their race with the validity step
 * (2-N28), the withdrawal of a version both parties have not signed (2-N10), a renewal or an amendment while an
 * approved version waits for its signatures (2-N01), and the termination with notice or an immediate cause and
 * the versions that cannot start on or after it (2-N14, 2-N15). `contract_terminated` is in CONTRACT_DRAFT_CODES.
 */
const CONTRACT_LIFECYCLE_CODES = ["content_changed", "already_signed", "not_approved", "signature_invalid",
  "invalid_contract_document", "airline_signed_other_content", "version_signed", "version_awaiting_signatures",
  "termination_scheduled", "termination_not_scheduled", "termination_date_required", "termination_notice_not_met",
  "immediate_cause_invalid", "forbidden"] as const;
/**
 * Airline permit dossier (phase 2, block B): only a submitted permit is reviewed and only a verified one is revoked
 * (2-N09), the note a rejection needs, the dates, kind, number and issuer of a submission, and a scan that is not the
 * airline's upload or was uploaded before the media link window and must be uploaded again (2-N37).
 */
const AIRLINE_PERMIT_CODES = ["review_closed", "permit_not_verified", "review_note_required", "invalid_permit",
  "permit_dates_invalid", "permit_expired", "document_invalid", "document_expired"] as const;
export type ElevantApiErrorCode = "password_change_required" | "password_policy" | "invalid_link" | "refresh_rotated" |
  (typeof CONTRACT_CODES)[number] | (typeof COMMON_COMMAND_CODES)[number] | (typeof COMMERCIAL_REQUEST_CODES)[number] |
  (typeof CONTRACT_DRAFT_CODES)[number] | (typeof FINANCE_COMMAND_CODES)[number] | (typeof CATALOG_CODES)[number] |
  (typeof GOVERNANCE_ACCOUNT_CODES)[number] | (typeof CONTRACT_LIFECYCLE_CODES)[number] |
  (typeof AIRLINE_PERMIT_CODES)[number];
export const ELEVANT_API_ERROR_CODES: readonly ElevantApiErrorCode[] = ["password_change_required", "password_policy",
  "invalid_link", "refresh_rotated", ...CONTRACT_CODES, ...COMMON_COMMAND_CODES, ...COMMERCIAL_REQUEST_CODES,
  ...CONTRACT_DRAFT_CODES, ...FINANCE_COMMAND_CODES, ...CATALOG_CODES, ...GOVERNANCE_ACCOUNT_CODES,
  ...CONTRACT_LIFECYCLE_CODES, ...AIRLINE_PERMIT_CODES];

/** Rules a rejected stand coverage or stand placement breaks (ADR-0030); the screens explain each one. */
export const ELEVANT_RULE_REASONS = ["window_invalid", "no_stands", "stand_inactive", "stand_other_terminal",
  "too_many_stands", "driver_license_required", "vehicle_required", "agent_inactive", "airport_permit_required",
  "bridge_qualification_required", "shift_not_covering", "absent", "agent_overlap", "mentor_required",
  "mentor_not_eligible", "stand_taken", "stand_cancelled", "stand_narrowbody_only", "neighbour_widebody",
  // Invoicing from operations (ADR-0035).
  "mixed_airline", "already_invoiced", "operation_not_approved", "nothing_to_invoice",
  // Simulated card payment (ADR-0036).
  "cardholder_invalid", "card_number_invalid", "card_expired", "security_code_invalid", "amount_invalid",
  "amount_mismatch", "invoice_paid", "idempotency_conflict", "concurrent_payment"] as const;
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
