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
/**
 * Stations of the platform (phase 2, block C, 2-A): the superadministrator creates them with the IATA code of their
 * airport (a new airport needs its data), the code never changes, the time zone only while the station has no history,
 * and a station in use is never deactivated.
 */
const STATION_CODES = ["station_code_taken", "airport_has_station", "airport_icao_taken", "invalid_station",
  "invalid_time_zone", "airport_required", "time_zone_locked", "station_in_use"] as const;
/**
 * OCC master data (phase 2, block C, 2-A): terminals, stands and aircraft types. A code is fixed once something used
 * it, something in use is never deactivated (also from the coverage configuration, as a 422 reason) and a stand
 * needs an active terminal.
 */
const MASTER_DATA_CODES = ["terminal_code_taken", "stand_code_taken", "aircraft_type_code_taken", "invalid_terminal",
  "invalid_stand", "invalid_aircraft_type", "terminal_in_use", "stand_in_use", "aircraft_type_in_use",
  "terminal_code_locked", "stand_code_locked", "terminal_inactive"] as const;
/**
 * Flight feed review (phase 2, block C): the view and the import of a pair, a carrier whose contract at the station
 * is suspended or expired (2-N16), a charter without contract (2-B, ADR-0033) and the restore of a dismissed
 * proposal while its flight has not passed (2-N36).
 */
const FLIGHT_FEED_CODES = ["invalid_flight_feed_query", "invalid_flight_import", "flight_proposals_not_pairable",
  "flight_proposal_closed", "flight_counterpart_unknown", "contract_not_in_force", "contract_ambiguous",
  "charter_has_contract", "charter_required", "airline_inactive", "flight_proposal_not_dismissed",
  "flight_proposal_passed"] as const;
/**
 * Planning a flight with its aircraft type and stand (phase 2, block C): an inactive or unknown aircraft type, and a
 * stand that is inactive, of another station or taken in the window (the rules it breaks come in `reasons`). Phase 3,
 * block A: a flight changes only before its operation starts or while it is open (3-A), its assigned agent must still
 * cover the new window (`reasons`), a recorded arrival and the aircraft type are frozen from the first submission
 * (3-N08, 3-B), the same flight is planned once (3-N07), and the positions map and the charter carrier name their
 * invalid requests (3-N10, 3-N21). Phase 3, block B: OCC releases the agent it saw (`assignment_changed`) of an
 * operation not started yet, hands an operation in progress or returned to another eligible agent (3-F), reads the
 * agent's shift of the flight's day (3-E), and the coverage commands name their invalid requests and broken rules
 * (3-J).
 */
const PLANNING_CODES = ["aircraft_type_unavailable", "stand_unavailable", "operation_started", "turnaround_closed",
  "assigned_agent_unavailable", "invalid_turnaround_change", "arrival_locked", "aircraft_type_locked",
  "flight_already_planned", "invalid_charter_airline", "invalid_position_request", "assignment_changed",
  "handover_not_allowed", "same_agent", "agent_not_eligible", "invalid_handover", "shift_not_found",
  "invalid_coverage_request", "coverage_rejected"] as const;
/**
 * Gestión Humana (phase 2, block D): the one release path of a ramp agent, which an operation in progress or returned
 * refuses (2-N06, 2-N08); the availability requests and the cancellation or shortening of an approved absence
 * (2-N22); the shifts that are past, still worked or on an approved absence (2-N11, 2-N24); and the planning board's
 * readiness query (2-N25). Phase 3, block B: an adjusted shift keeps covering the agent's work and a validated
 * attendance freezes it (3-E).
 */
const HUMAN_RESOURCES_CODES = ["agent_has_operation_in_progress", "invalid_availability_request", "agent_unavailable",
  "availability_overlap", "availability_request_closed", "absence_not_approved", "absence_started", "absence_ended",
  "absence_end_invalid", "invalid_absence_amendment", "invalid_shift", "shift_scope_missing", "shift_day_taken",
  "shift_on_approved_absence", "shift_in_past", "shift_in_use", "invalid_readiness_query", "shift_uncovers_work",
  "attendance_validated"] as const;
/**
 * Access (phase 2, block E): shared tablets that pass between agents, are released at sign-out and that OCC frees or
 * revokes (2-N02); the airline's representatives and signers, the only ones that sign contracts and submit the JAC
 * permit (2-N20); a transferred employee that only its new department brings back (2-N07) and the requests of an
 * administrator that left (2-N33); the retired legacy governance writes (2-N38) and the default codes every governance
 * command answers (2-N39).
 */
const ACCESS_CODES = ["device_revoked", "device_in_use_by_active_agent", "device_platform_mismatch", "device_not_bound",
  "device_conflict", "invalid_mobile_device", "signer_required", "representative_required", "portal_user_protected",
  "last_representative", "invalid_portal_user", "employee_transferred", "requester_no_longer_administrator",
  "legacy_governance_retired", "access_request_closed", "invalid_governance_data", "governance_conflict",
  "protected_user"] as const;
/**
 * Tablet evidence (phase 3, block C): every ramp command answers a code. A tablet time outside the operation's window
 * (from its start, or the recorded arrival, to its close: now, the hand-off under review or the first hand-off of a
 * correction round) or before the service's last transition (3-I, 3-N25, 3-N09), block-on after push-back (3-N25), a
 * command the operation's state does not take and a malformed request. A reused key keeps the common
 * `idempotency_conflict` and a missing operation `not_found`.
 */
const RAMP_EVIDENCE_CODES = ["time_outside_operation_window", "milestone_out_of_order", "service_time_out_of_order",
  "ramp_operation_state_conflict", "invalid_ramp_command"] as const;
/**
 * OCC review (phase 3, block D): a malformed review command; OCC approves only the Service Order the airline and AVIAM
 * signed, or its recorded correction (3-N02); the hand-off was decided already; a reopening needs an approval nothing
 * was invoiced from and a reopened revision is never returned to the ramp (3-H); only a service in exception with an
 * executed quantity is excluded from billing (3-N11); a charge the contract excludes, that does not apply, already
 * marked or already removed (3-N29). A closed review is `review_closed` (AIRLINE_PERMIT_CODES).
 */
const OCC_REVIEW_CODES = ["invalid_review_request", "service_order_unsigned", "service_order_stale",
  "review_already_decided", "review_not_approved", "reopened_review_cannot_return", "already_invoiced",
  "billing_exclusion_not_allowed", "charge_excluded_by_contract", "charge_not_applicable", "charge_already_marked",
  "charge_already_removed"] as const;
/**
 * OCC's incidents (phase 3, block D, 3-G): a state change the incident does not take (a closed one is final), an
 * incomplete report, a time in the future or before the operation's window, and an operation approved or cancelled.
 */
const OCC_INCIDENT_CODES = ["incident_transition_invalid", "incident_report_invalid", "incident_occurred_at_invalid",
  "operation_closed"] as const;
/** Charter (phase 3, block D, 3-N24): no service is added on a confirmed prepayment; only a confirmed one is reopened. */
const CHARTER_CODES = ["charter_prepayment_confirmed", "charter_prepayment_not_confirmed"] as const;
/**
 * OCC and Gestión Humana reports (phase 3, block E, 3-N13): an export over its row limit is refused, never cut; a
 * malformed or out-of-range query; an unknown report; a station outside the caller's scope or no longer active.
 */
const REPORT_CODES = ["report_too_large", "invalid_report_query", "report_not_found", "station_unavailable"] as const;
export type ElevantApiErrorCode = "password_change_required" | "password_policy" | "invalid_link" | "refresh_rotated" |
  (typeof CONTRACT_CODES)[number] | (typeof COMMON_COMMAND_CODES)[number] | (typeof COMMERCIAL_REQUEST_CODES)[number] |
  (typeof CONTRACT_DRAFT_CODES)[number] | (typeof FINANCE_COMMAND_CODES)[number] | (typeof CATALOG_CODES)[number] |
  (typeof GOVERNANCE_ACCOUNT_CODES)[number] | (typeof CONTRACT_LIFECYCLE_CODES)[number] |
  (typeof AIRLINE_PERMIT_CODES)[number] | (typeof STATION_CODES)[number] | (typeof MASTER_DATA_CODES)[number] |
  (typeof FLIGHT_FEED_CODES)[number] | (typeof PLANNING_CODES)[number] | (typeof HUMAN_RESOURCES_CODES)[number] |
  (typeof ACCESS_CODES)[number] | (typeof RAMP_EVIDENCE_CODES)[number] | (typeof OCC_REVIEW_CODES)[number] |
  (typeof OCC_INCIDENT_CODES)[number] | (typeof CHARTER_CODES)[number] | (typeof REPORT_CODES)[number];
export const ELEVANT_API_ERROR_CODES: readonly ElevantApiErrorCode[] = ["password_change_required", "password_policy",
  "invalid_link", "refresh_rotated", ...CONTRACT_CODES, ...COMMON_COMMAND_CODES, ...COMMERCIAL_REQUEST_CODES,
  ...CONTRACT_DRAFT_CODES, ...FINANCE_COMMAND_CODES, ...CATALOG_CODES, ...GOVERNANCE_ACCOUNT_CODES,
  ...CONTRACT_LIFECYCLE_CODES, ...AIRLINE_PERMIT_CODES, ...STATION_CODES, ...MASTER_DATA_CODES, ...FLIGHT_FEED_CODES,
  ...PLANNING_CODES, ...HUMAN_RESOURCES_CODES, ...ACCESS_CODES, ...RAMP_EVIDENCE_CODES, ...OCC_REVIEW_CODES,
  ...OCC_INCIDENT_CODES, ...CHARTER_CODES, ...REPORT_CODES];

/** Rules a rejected stand coverage or stand placement breaks (ADR-0030); the screens explain each one. */
export const ELEVANT_RULE_REASONS = ["window_invalid", "no_stands", "stand_inactive", "stand_other_terminal",
  "too_many_stands", "driver_license_required", "vehicle_required", "agent_inactive", "airport_permit_required",
  "bridge_qualification_required", "shift_not_covering", "absent", "agent_overlap", "mentor_required",
  "mentor_not_eligible", "stand_taken", "stand_cancelled", "stand_narrowbody_only", "neighbour_widebody",
  // Invoicing from operations (ADR-0035).
  "mixed_airline", "already_invoiced", "operation_not_approved", "nothing_to_invoice",
  // Simulated card payment (ADR-0036).
  "cardholder_invalid", "card_number_invalid", "card_expired", "security_code_invalid", "amount_invalid",
  "amount_mismatch", "invoice_paid", "idempotency_conflict", "concurrent_payment",
  // A stand in use is not deactivated, nor one of an inactive terminal reactivated, from the coverage configuration
  // (phase 2, block C, 2-A).
  "stand_in_use", "terminal_inactive",
  // A mentor on an approved absence or without a current airport permit accompanies nobody (phase 2, block D, 2-N23).
  "mentor_absent", "mentor_permit_required",
  // A rescheduled flight's agent would carry a fourth simultaneous operation (phase 3, block A, 3-A).
  "simultaneous_limit",
  // A coverage needs the agent's current scope in its terminal, as the tablet does (phase 3, block B, 3-N05).
  "terminal_scope_missing"] as const;
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
