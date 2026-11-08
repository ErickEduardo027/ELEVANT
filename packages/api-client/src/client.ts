import { PRESENCE_AVAILABILITIES, PRESENCE_MESSAGE_MAX_LENGTH } from "./presence";
import { isFlightReportMilestoneCode, isIataDelayCode } from "./flightReport";
import {
  isAirlineServiceOrderResponse,
  isOperationDocumentKind,
  isOperationDocumentsResponse,
  isOperationSignatureRole,
  isValidDamageMark,
  normalizedSignature,
  type OperationDocumentKind,
  type OperationSignatureRole,
  type RecordDamageMarkCommand,
  type SignOperationDocumentCommand,
} from "./operationDocuments";
import {
  isFinanceCharterListResponse,
  isFinanceCharterResponse,
  isRampCharterResponse,
  normalizedCharterDetails,
  normalizedCharterService,
  normalizedPrepayment,
  normalizedPrepaymentReopening,
  type AddCharterServiceCommand,
  type CharterDetailsCommand,
  type ConfirmCharterPrepaymentCommand,
  type ReopenCharterPrepaymentCommand,
} from "./charters";
import {
  AIRCRAFT_SIZE_CATEGORIES,
  CHARGE_MARK_SOURCES,
  isFinanceCloseRulesResponse,
  isFinanceHolidayResponse,
  isGroundTimeAllowanceResponse,
  isOccReviewChargeAdjustResponse,
  isOccReviewClose,
  isOccReviewReopenResponse,
  normalizedAddCharge,
  normalizedAllowance,
  normalizedBillingExclusion,
  normalizedHoliday,
  normalizedRemoveCharge,
  normalizedReopenReview,
  SERVICE_ORDER_STATES,
  type AddFinanceHolidayCommand,
  type AddOccReviewChargeCommand,
  type AircraftSizeCategory,
  type RemoveOccReviewChargeCommand,
  type ReopenOccReviewCommand,
  type SetGroundTimeAllowanceCommand,
  type SetOccReviewServiceBillingExclusionCommand,
} from "./operationalClose";
import {
  isOccIncident,
  isOccIncidentList,
  normalizedOccIncidentReport,
  normalizedOccIncidentStatus,
  type ChangeOccIncidentStatusCommand,
  type ReportOccIncidentCommand,
} from "./occIncidents";
import type { OperationalPresenceList, OwnPresence, PresenceHeartbeat, PresenceStatusUpdate } from "./presence";
import {
  isOccCharterAirline,
  isOccTurnaroundAction,
  isRampAircraftTypes,
  isStrongEntityTag,
  normalizedCharterAirline,
  normalizedTurnaroundReason,
  normalizedTurnaroundReschedule,
  normalizedTurnaroundStatusChange,
  validatedPositionHeaders,
  validatedTurnaroundHeaders,
  type ChangeOccTurnaroundStatusCommand,
  type CreateOccCharterAirlineCommand,
  type OccPositionCommandHeaders,
  type OccTurnaroundCommandHeaders,
  type OccTurnaroundWithMetadata,
  type RescheduleOccTurnaroundCommand,
} from "./occTurnarounds";
import {
  isContractDraftReadiness,
  isContractDraftScope,
  normalizedDraftDiscard,
  normalizedDraftMessage,
  normalizedDraftScope,
  normalizedDraftSubmission,
  normalizedDraftUpdate,
  type ContractDraftMessageCommand,
  type DiscardContractDraftCommand,
  type SetContractDraftScopeCommand,
  type SubmitManagedContractDraftCommand,
  type UpdateManagedContractDraftCommand,
} from "./contractDrafts";
import {
  isFinancePackageIdResponse,
  normalizedContractAmendment,
  normalizedPackageLifecycle,
  type CreateContractAmendmentCommand,
  type FinancePackageLifecycleCommand,
} from "./financePackages";
import {
  isManagedService,
  isServiceClosure,
  normalizedClosureDecision,
  normalizedManagedServiceUpdate,
  normalizedServiceReopen,
  normalizedServiceRetirement,
  type DecideServiceClosureCommand,
  type ReopenServiceCommand,
  type RetireManagedServiceCommand,
  type UpdateManagedServiceCommand,
} from "./catalog";
import {
  isContractPricingTerms,
  isContractTimeline,
  isContractWithdrawal,
  normalizedContractWithdrawal,
  type WithdrawContractVersionCommand,
} from "./contractDocuments";
import {
  AIRLINE_PERMIT_KINDS,
  AIRLINE_PERMIT_REVIEWS,
  isAirlinePermit,
  isAirlinePermitDecision,
  isAirlinePortalStanding,
  normalizedPermitReview,
  normalizedPermitRevocation,
  type AirlinePermitReview,
  type ReviewAirlinePermitCommand,
  type RevokeAirlinePermitCommand,
} from "./airlinePermits";
import {
  isOccMobileDevice,
  isOccMobileDevices,
  normalizedReleaseMobileDevice,
  normalizedRevokeOccMobileDevice,
  normalizedUnbindOccMobileDevice,
  type ReleaseMobileDeviceCommand,
  type RevokeOccMobileDeviceCommand,
  type UnbindOccMobileDeviceCommand,
} from "./mobileDevices";
import {
  isAirlinePortalUser,
  isAirlinePortalUsers,
  normalizedAirlinePortalUserSigner,
  normalizedAirlinePortalUserStatus,
  normalizedInviteAirlinePortalUser,
  type InviteAirlinePortalUserCommand,
  type SetAirlinePortalUserSignerCommand,
  type SetAirlinePortalUserStatusCommand,
} from "./airlinePortalUsers";
import {
  isMasterAircraftType,
  isMasterStand,
  isMasterTerminal,
  isOccMasterData,
  isStationCatalog,
  isStationCatalogItem,
  normalizedAircraftTypeCreate,
  normalizedAircraftTypeUpdate,
  normalizedStandCreate,
  normalizedStandUpdate,
  normalizedStationCreate,
  normalizedStationUpdate,
  normalizedTerminalCreate,
  normalizedTerminalUpdate,
} from "./masterData";
import {
  isOccFlightFeedView,
  isRestoredFlightProposal,
  normalizedFlightImport,
  type ImportOccFlightCommand,
  type OccFlightFeedView,
} from "./flightFeedReview";
import {
  SCHEDULE_READINESS_WARNING_KINDS,
  SCHEDULE_WARNING_KINDS,
  isHumanResourcesAvailabilityAmended,
  isOccAssignmentReadiness,
  isRecordVersion,
  normalizedAvailabilityAmendment,
  validatedOccAssignmentReadinessQuery,
  type AmendHumanResourcesAvailabilityCommand,
  type OccAssignmentReadinessQuery,
} from "./humanResourcesCommands";
import {
  isCommercialAccountResponse,
  isEmailOutboxPage,
  isInvoiceEmailStatus,
  isProvisioningTaskList,
  normalizedAccountLink,
  normalizedClientPasswordReset,
  normalizedEmailOutboxQuery,
  normalizedInvitationResend,
  normalizedProvisioning,
  type EmailOutboxQuery,
  type LinkProvisioningAccountCommand,
  type ProvisionAirlineAccountCommand,
  type ResendAirlineInvitationCommand,
  type ResetClientUserPasswordCommand,
} from "./governanceAccounts";
import {
  isCommercialIdResponse,
  isCommercialInboxData,
  normalizedAirlineVerification,
  normalizedCommercialDecision,
  normalizedCommercialInboxQuery,
  normalizedRepresentativeConfirmation,
  normalizedRequestCancellation,
  type CancelCommercialRequestCommand,
  type CommercialInboxQuery,
  type ConfirmCommercialRepresentativeCommand,
  type DecideCommercialRequestCommand,
  type VerifyCommercialRequestAirlineCommand,
} from "./commercialRequests";
import {
  getGetAccountChangesUrl,
  getGetAirlineContractsUrl,
  getGetAirlineOperationsUrl,
  getGetAirlineOperationUrl,
  getGetAirlineApprovedOperationEvidenceUrl,
  getGetAirlineOperationalRequestsUrl,
  getGetAirlinePreinvoiceUrl,
  getGetAirlinePreinvoiceDisputesUrl,
  getAcceptAirlinePreinvoiceUrl,
  getDisputeAirlinePreinvoiceUrl,
  getGetAirlinePreinvoicesUrl,
  getListManagedContractsUrl,
  getGetPublicCommercialCatalogUrl,
  getSubmitCommercialRequestUrl,
  getLookupCommercialRequestReceiptUrl,
  getListCommercialRequestInboxUrl,
  getVerifyCommercialRequestAirlineUrl,
  getConfirmCommercialRepresentativeUrl,
  getCancelCommercialRequestUrl,
  getDecideCommercialRequestUrl,
  getCommentAirlineContractDraftUrl,
  getUpdateManagedContractDraftUrl,
  getActivateManagedContractDraftUrl,
  getGetManagedContractDraftReadinessUrl,
  getGetManagedContractDraftScopeUrl,
  getSetManagedContractDraftScopeUrl,
  getDiscardManagedContractDraftUrl,
  getReplyManagedContractDraftUrl,
  getCreateContractAmendmentUrl,
  getDiscardFinancePackageUrl,
  getRetireFinancePackageUrl,
  getUpdateCommercialServiceUrl,
  getRetireCommercialServiceUrl,
  getDecideServiceClosureUrl,
  getReopenServiceUrl,
  getGetFinanceApprovedServicesUrl,
  getListFinancePreinvoicesUrl,
  getListFinanceTariffsUrl,
  getListHumanResourcesPermitsUrl,
  getRecordHumanResourcesPermitUrl,
  getListHumanResourcesQualificationsUrl,
  getListHumanResourcesQualificationEquipmentTypesUrl,
  getRecordHumanResourcesQualificationUrl,
  getSummarizeHumanResourcesQualificationsUrl,
  getGetHumanResourcesQualificationHistoryUrl,
  getSummarizeHumanResourcesPermitsUrl,
  getGetHumanResourcesPermitHistoryUrl,
  getListHumanResourcesShiftsUrl,
  getListHumanResourcesAvailabilityRequestsUrl,
  getRecordHumanResourcesAvailabilityRequestUrl,
  getResolveHumanResourcesAvailabilityRequestUrl,
  getGetHumanResourcesShiftAssignmentOptionsUrl,
  getRecordHumanResourcesShiftUrl,
  getListFinanceReconciliationUrl,
  getCreatePreinvoiceDraftUrl,
  getGetPreinvoiceDraftUrl,
  getGetFinancePreinvoiceDisputesUrl,
  getResolveFinancePreinvoiceDisputeUrl,
  getIssueFinanceInvoiceUrl,
  getIssueInvoiceFromOperationsUrl,
  getPayAirlineInvoiceByCardUrl,
  getGetAirlineInvoiceCardPaymentsUrl,
  getGetFinanceInvoiceCardPaymentsUrl,
  getGetAirlineCardPaymentReceiptUrl,
  getGetFinanceInvoiceDocumentByIdUrl,
  getGetAirlineInvoiceDocumentByIdUrl,
  getGetFinanceInvoiceByPreinvoiceUrl,
  getGetAirlineInvoiceByPreinvoiceUrl,
  getGetAirlinePaymentByInvoiceUrl,
  getGetAirlineInvoiceStatementUrl,
  type AirlineInvoiceStatementResponse,
  getGetAirlineInvoiceDocumentUrl,
  getGetAirlinePaymentReceiptUrl,
  getGetFinanceInvoiceDocumentUrl,
  getGetFinancePaymentReceiptUrl,
  getGetFinancePaymentByInvoiceUrl,
  getRecordNonFiscalPaymentUrl,
  getSubmitPreinvoiceUrl,
  getGetAirlinePortalBootstrapUrl,
  getAssignOccPlanningOperationUrl,
  getCreateSessionUrl,
  getRefreshSessionUrl,
  getEndSessionUrl,
  getVerifyLoginCodeUrl,
  getResendLoginCodeUrl,
  getActivatePortalAccountUrl,
  getRequestPasswordResetUrl,
  getConfirmPasswordResetUrl,
  getResendAirlineInvitationUrl,
  getSendTestEmailUrl,
  getListEmailDeliveriesUrl,
  getListEmailOutboxUrl,
  getListCommercialProvisioningUrl,
  getProvisionCommercialAirlineUrl,
  getLinkCommercialAirlineAccountUrl,
  getResetGovernanceClientUserPasswordUrl,
  getGetFinanceInvoiceEmailDeliveriesUrl,
  getChangePasswordUrl,
  getGetCurrentSessionUrl,
  getGetOccPlanningOptionsUrl,
  getGetOccPlanningSnapshotUrl,
  getGetOccAircraftTrafficUrl,
  getGetManualTurnaroundOptionsUrl,
  getCreateManualTurnaroundUrl,
  getProgramOccShiftUrl,
  getGetOccReviewQueueUrl,
  getGetOccReviewDetailUrl,
  getGetOccReviewSubmissionDetailUrl,
  getGetOccReviewSubmissionHistoryUrl,
  getGetOperationalConversationsUrl,
  getGetOperationalMessagesUrl,
  getSendOperationalMessageUrl,
  getMarkOperationalConversationReadUrl,
  getGetOperationalNotificationsUrl,
  getGetDepartmentNotificationsUrl,
  getSetDepartmentNotificationReadUrl,
  getSetOperationalNotificationReadUrl,
  getDecideOccReviewUrl,
  getGetRampOperationChecklistUrl,
  getGetRampIncidentsUrl,
  getGetOperationAttendanceDraftUrl,
  getGetOccAttendanceAssignmentsUrl,
  getSaveOccAttendanceDraftUrl,
  getSaveRampAttendanceDraftUrl,
  getGetHumanResourcesAttendanceUrl,
  getListHumanResourcesExpirationsUrl,
  getListHumanResourcesAccountMovementsUrl,
  getListHumanResourcesStaffDistributionUrl,
  getListHumanResourcesQualificationCoverageUrl,
  getListHumanResourcesScheduleWarningsUrl,
  getExportHumanResourcesReportUrl,
  getListOccReportsUrl,
  getGetOccPositionsUrl,
  getGetOccCoverageUrl,
  getCreateOccCoverageUrl,
  getReleaseOccCoverageUrl,
  getUpdateOccStandAttributesUrl,
  getUpdateOccTerminalRulesUrl,
  getAddOccStandConstraintUrl,
  getRemoveOccStandConstraintUrl,
  getReleaseOccOperationAgentUrl,
  getGetOccHandoverOptionsUrl,
  getHandOverOccOperationUrl,
  getGetOccAgentShiftUrl,
  getAdjustHumanResourcesShiftUrl,
  getGetOwnRampCoverageUrl,
  getRecordOccArrivalUrl,
  getGetOccTurnaroundUrl,
  getRescheduleOccTurnaroundUrl,
  getChangeOccTurnaroundStatusUrl,
  getCreateOccCharterAirlineUrl,
  getGetRampAircraftTypesUrl,
  getAssignOccStandUrl,
  getReleaseOccStandUrl,
  getLocateOccStandUrl,
  getListOccReadyContractsUrl,
  getGetOccFlightFeedUrl,
  getRefreshOccFlightFeedUrl,
  getImportOccFlightUrl,
  getDismissOccFlightProposalUrl,
  getRestoreOccFlightProposalUrl,
  getListGovernanceStationsUrl,
  getCreateGovernanceStationUrl,
  getUpdateGovernanceStationUrl,
  getGetOccMasterDataUrl,
  getCreateOccTerminalUrl,
  getUpdateOccTerminalUrl,
  getCreateOccStandUrl,
  getUpdateOccStandUrl,
  getCreateOccAircraftTypeUrl,
  getUpdateOccAircraftTypeUrl,
  getGetContractDocumentUrl,
  getGetAirlinePermitsUrl,
  getSubmitAirlinePermitUrl,
  getGetContractsAirlinePermitsUrl,
  getReviewAirlinePermitUrl,
  getRevokeAirlinePermitUrl,
  getGetAirlinePortalStandingUrl,
  getReleaseMobileDeviceUrl,
  getListOccMobileDevicesUrl,
  getUnbindOccMobileDeviceUrl,
  getRevokeOccMobileDeviceUrl,
  getGetAirlinePortalUsersUrl,
  getInviteAirlinePortalUserUrl,
  getSetAirlinePortalUserStatusUrl,
  getSetAirlinePortalUserSignerUrl,
  type AirlinePortalUserData,
  type AirlinePortalUsersData,
  type OccMobileDeviceData,
  type OccMobileDevicesData,
  getGetContractTimelineUrl,
  getUploadCommercialMediaUrl,
  getDownloadContractDocumentUrl,
  getDownloadContractDraftPdfUrl,
  getSignContractVersionUrl,
  getSetContractValidityUrl,
  getWithdrawContractVersionUrl,
  getGetContractPricingTermsUrl,
  getRemoveHumanResourcesShiftUrl,
  getAmendHumanResourcesAvailabilityRequestUrl,
  getGetOccAssignmentReadinessUrl,
  getListRampAgentReadinessUrl,
  getGetOwnRampScheduleUrl,
  getGetOccReportUrl,
  getExportOccReportUrl,
  getValidateHumanResourcesAttendanceUrl,
  getGetRampAssignedOperationsUrl,
  getGetSystemPingUrl,
  getRegisterMobileDeviceUrl,
  getReopenRampOperationCorrectionUrl,
  getReportRampIncidentUrl,
  getRecordRampMilestoneUrl,
  getGetRampOperationDocumentsUrl,
  getSignRampOperationDocumentUrl,
  getRecordRampDamageMarkUrl,
  getAttachRampDamagePhotoUrl,
  getGetOccOperationDocumentsUrl,
  getGetOccOperationDocumentPdfUrl,
  getGetOccDamagePhotoUrl,
  getGetAirlineServiceOrderUrl,
  getGetAirlineServiceOrderPdfUrl,
  getGetRampCharterUrl,
  getAddOccReviewChargeUrl,
  getRemoveOccReviewChargeUrl,
  getSetOccReviewServiceBillingExclusionUrl,
  getReopenOccReviewUrl,
  getGetOccOperationIncidentsUrl,
  getReportOccIncidentUrl,
  getChangeOccIncidentStatusUrl,
  getReopenFinanceCharterPrepaymentUrl,
  getGetFinanceCloseRulesUrl,
  getSetGroundTimeAllowanceUrl,
  getAddFinanceHolidayUrl,
  getRemoveFinanceHolidayUrl,
  getAddRampCharterServiceUrl,
  getUpdateRampCharterDetailsUrl,
  getGetFinanceChartersUrl,
  getConfirmFinanceCharterPrepaymentUrl,
  getUpdateRampFlightDataUrl,
  getSubmitRampOperationUrl,
  getStartRampOperationUrl,
  getSubmitRampOperationChecklistUrl,
  getTransitionRampOperationServiceUrl,
  getGetRampOperationChargesUrl,
  getApplyRampServiceChargeUrl,
  type AssignOccOperationRequest,
  type AccountChangeListResponse,
  type AirlineContractPageResponse,
  type AirlineOperationPageResponse,
  type AirlinePortalOperationResponse,
  type AirlineApprovedOperationEvidenceResponse,
  type AirlineOperationalRequestPageResponse,
  type AirlinePreinvoiceDetailResponse,
  type AcceptAirlinePreinvoiceRequest,
  type AcceptAirlinePreinvoiceResponse,
  type DisputeAirlinePreinvoiceRequest,
  type DisputeAirlinePreinvoiceResponse,
  type PreinvoiceDisputeListResponse,
  type ResolvePreinvoiceDisputeRequest,
  type ResolvePreinvoiceDisputeResponse,
  type IssueFinanceInvoiceRequest,
  type IssueInvoiceFromOperationsRequest,
  type PayInvoiceByCardBody,
  type CardPaymentAttemptResponse,
  type CardPaymentListResponse,
  type CardPaymentResponse,
  type IssuedInvoiceResponse,
  type IssueFinanceInvoiceResponse,
  type NonFiscalInvoiceResponse,
  type NonFiscalPaymentLookupResponse,
  type RecordNonFiscalPaymentRequest,
  type RecordNonFiscalPaymentResponse,
  type AirlinePreinvoicePageResponse,
  type ManagedContractPageData,
  type ListManagedContractsParams,
  type PublicCommercialCatalog,
  type SubmitCommercialRequestRequest,
  type SubmitCommercialRequestResponse,
  type CommercialIdResponse,
  type FinancePackageIdResponse,
  type ManagedServiceData,
  type ServiceClosureData,
  type CommercialInboxData,
  type ContractDraftReadinessData,
  type ContractDraftScopeData,
  type FinanceApprovedServicesResponse,
  type FinancePreinvoicePageData,
  type ListFinancePreinvoicesParams,
  type FinanceTariffPageData,
  type ListFinanceTariffsParams,
  type HumanResourcesPermitPage,
  type HumanResourcesPermitRecorded,
  type ListHumanResourcesPermitsParams,
  type RecordHumanResourcesPermitInput,
  type HumanResourcesQualificationPage,
  type HumanResourcesQualificationEquipmentType,
  type HumanResourcesQualificationRecorded,
  type RecordHumanResourcesQualificationInput,
  type ListHumanResourcesQualificationsParams,
  type SummarizeHumanResourcesQualificationsParams,
  type SummarizeHumanResourcesPermitsParams,
  type HumanResourcesDocumentSummary,
  type HumanResourcesQualificationHistory,
  type HumanResourcesPermitHistory,
  type HumanResourcesShiftPage,
  type HumanResourcesScheduleWarningPageResponse,
  type ListHumanResourcesScheduleWarningsParams,
  type HumanResourcesAvailabilityRequestPage,
  type HumanResourcesAvailabilityWritten,
  type RecordHumanResourcesAvailabilityInput,
  type ResolveHumanResourcesAvailabilityInput,
  type HumanResourcesAvailabilityAmended,
  type OccAssignmentReadinessResponse,
  type ListHumanResourcesAvailabilityRequestsParams,
  type HumanResourcesShiftAssignmentOptions,
  type GetHumanResourcesShiftAssignmentOptionsParams,
  type ListHumanResourcesShiftsParams,
  type HumanResourcesShiftRecorded,
  type RecordHumanResourcesShiftInput,
  type FinanceReconciliationPageData,
  type ListFinanceReconciliationParams,
  type CreatePreinvoiceDraftRequest,
  type CreatePreinvoiceDraftResponse,
  type PreinvoiceDraftResponse,
  type SubmitPreinvoiceRequest,
  type SubmitPreinvoiceResponse,
  type GetAirlineContractsParams,
  type GetAirlineOperationsParams,
  type GetAirlineOperationalRequestsParams,
  type GetAirlinePreinvoicesParams,
  type GetAccountChangesParams,
  type AirlinePortalBootstrapResponse,
  type CreateSessionRequest,
  type ChangePasswordRequest,
  type CurrentSessionResponse,
  type GetRampOperationChecklistResponse,
  type GetRampIncidentsResponse,
  type AttendanceDraftContributionResponse,
  type AttendanceDraftSnapshotResponse,
  type AttendanceDraftWriteResponse,
  type OccAttendanceAssignmentsResponse,
  type SaveAttendanceDraftRequest,
  type HumanResourcesAttendancePageResponse,
  type HumanResourcesAttendanceRowResponse,
  type AttendanceValidationDecisionResponse,
  type AttendanceValidationWriteResponse,
  type ValidateAttendanceRequest,
  type GetHumanResourcesAttendanceParams,
  type HumanResourcesExpirationResponseHumanResourcesReportPageResponse,
  type OccReportCatalogResponse,
  type OccPositionBoardResponse,
  type OccCharterAirlineResponse,
  type OccTurnaroundDetailResponse,
  type RampAircraftTypesResponse,
  type OccCoverageBoardResponse,
  type OccHandoverOptionsResponse,
  type OccOperationHandoverResponse,
  type OccAgentShiftResponse,
  type HumanResourcesShiftAdjusted,
  type RampOwnCoverageListResponse,
  type OccReadyContractsResponse,
  type OccFlightFeedResponse,
  type RefreshOccFlightFeedResponse,
  type ImportOccFlightResponse,
  type RestoreOccFlightProposalResponse,
  type StationCatalogData,
  type StationCatalogItemData,
  type CreateStationInput,
  type UpdateStationInput,
  type OccMasterData,
  type MasterTerminalData,
  type MasterStandData,
  type MasterAircraftTypeData,
  type CreateTerminalInput,
  type UpdateTerminalInput,
  type CreateStandInput,
  type UpdateStandInput,
  type CreateAircraftTypeInput,
  type UpdateAircraftTypeInput,
  type ContractDocumentResponse,
  type AirlinePermitData,
  type AirlinePermitDecisionData,
  type AirlinePortalStandingResponse,
  type SubmitAirlinePermitInput,
  type ContractTimelineData,
  type SignContractRequest,
  type SetContractValidityRequest,
  type ContractValidityResponse,
  type ContractWithdrawalResponse,
  type ContractPricingTermsResponse,
  type RampAgentReadinessData,
  type RampAgentReadinessItem,
  type RampAgentScheduleData,
  type RampAgentShiftData,
  type RampAgentDocumentData,
  type OccReportPageResponse,
  type HumanResourcesAccountMovementResponseHumanResourcesReportPageResponse,
  type HumanResourcesStaffDistributionResponseHumanResourcesReportPageResponse,
  type HumanResourcesQualificationCoverageResponseHumanResourcesReportPageResponse,
  type GetOccPlanningOptionsParams,
  type GetOccPlanningSnapshotParams,
  type GetOccAircraftTrafficParams,
  type OccAircraftTrafficResponse,
  type GetManualTurnaroundOptionsParams,
  type CreateManualTurnaroundRequest,
  type ManualTurnaroundOptionsResponse,
  type ManualTurnaroundResponse,
  type ProgramOccShiftRequest,
  type ProgramOccShiftResponse,
  type GetOccReviewQueueParams,
  type OccReviewQueueResponse,
  type OccReviewDetailResponse,
  type OccReviewSubmissionHistoryResponse,
  type OperationConversationListResponse,
  type OperationMessageListResponse,
  type OperationMessageResponse,
  type OperationalNotificationListResponse,
  type DepartmentNotificationListResponse,
  type DepartmentNotificationResponse,
  type OperationalNotificationResponse,
  type SendOperationMessageRequest,
  type DecideOccReviewRequest,
  type DecideOccReviewResponse,
  type OccPlanningOptionsResponse,
  type OccPlanningSnapshotResponse,
  type OccAssignmentResponse,
  type RampGroundOperationResponse,
  type RampChecklistSubmissionResponse,
  type RampIncidentReceiptResponse,
  type RampOperationSubmissionResponse,
  type RampOperationCorrectionResponse,
  type ReportRampIncidentRequest,
  type RampExecutionResponse,
  type OperationDocumentsResponse,
  type AirlineServiceOrderResponse,
  type RampCharterResponse,
  type OccReviewChargeAdjustResponse,
  type OccReviewReopenResponse,
  type OccIncidentListResponse,
  type OccIncidentResponse,
  type FinanceCloseRulesResponse,
  type GroundTimeAllowanceResponse,
  type FinanceHolidayResponse,
  type FinanceCharterListResponse,
  type FinanceCharterResponse,
  type SubmitRampOperationRequest,
  type RampOperationServiceTransitionResponse,
  type RampOperationChargesResponse,
  type RampServiceChargesResponse,
  type RampServiceChargeCommandResponse,
  type ApplyRampServiceChargeRequest,
  type RampOperationStartResponse,
  type RampAssignedOperationsResponse,
  type RegisterMobileDeviceRequest,
  type RegisterMobileDeviceResponse,
  type SessionActorResponse,
  type SessionResponse,
  type LoginChallengeResponse,
  type EmailDeliveryResponse,
  type EmailDeliveriesResponse,
  type EmailOutboxPageResponse,
  type InvoiceEmailStatusResponse,
  type ProvisioningTaskData,
  type CommercialAccountResponse,
  type SubmitRampOperationChecklistRequest,
  type StartRampOperationRequest,
  type SystemPingResponse,
  type TransitionRampOperationServiceRequest,
} from "../generated/elevant-api";
import { ELEVANT_API_ERROR_CODES, ElevantApiError, type ElevantApiErrorCode } from "./errors";
import { normalizeIdentityDocument, normalizePhone } from "./validation";

type AccessToken = string | null | undefined;
type FetchImplementation = typeof globalThis.fetch;

export interface ElevantApiClientOptions {
  /** Absolute HTTP(S) origin, without a path, query string, or fragment. */
  readonly baseUrl: string;
  /** Invoked immediately before each authenticated request. The token is not retained. */
  readonly getAccessToken?: () => AccessToken | Promise<AccessToken>;
  /** Request-scoped fetch implementation for SSR, Expo, and tests. */
  readonly fetch?: FetchImplementation;
  /** Headers copied at creation. Authorization is deliberately rejected. */
  readonly defaultHeaders?: HeadersInit;
}

export type ElevantRequestInit = Omit<RequestInit, "headers"> & {
  readonly headers?: HeadersInit;
};

export type GetSystemPingOptions = Omit<ElevantRequestInit, "body" | "method">;
export type CreateSessionOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ChangePasswordOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetCurrentSessionOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlinePortalBootstrapOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlineContractsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlineOperationsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlineOperationOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlineApprovedOperationEvidenceOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlinePreinvoiceOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetPreinvoiceDisputesOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ResolvePreinvoiceDisputeOptions = Omit<ElevantRequestInit, "body" | "method">;
export type IssueFinanceInvoiceOptions = Omit<ElevantRequestInit, "body" | "method">;
export type IssueInvoiceFromOperationsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type PayInvoiceByCardOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetNonFiscalInvoiceOptions = Omit<ElevantRequestInit, "body" | "method">;
export type RecordNonFiscalPaymentOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetNonFiscalPaymentOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetFinancialDocumentOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetHumanResourcesReportOptions = Omit<ElevantRequestInit, "body" | "method">;

/** A stand coverage OCC hands an agent (ADR-0030); both times null take the agent's shift. */
export interface OccCoverageCommand {
  stationId: string;
  date: string;
  agentId: string;
  terminalId: string;
  standIds: string[];
  startsAt?: string | null;
  endsAt?: string | null;
  mentorAgentId?: string | null;
  vehicleCode?: string | null;
  isReinforcement: boolean;
}

/**
 * A coverage command with the intent's Idempotency-Key (3-J): optional while older clients exist (expand); the same
 * key and body answer the board again instead of a second coverage.
 */
export type OccCoverageCommandOptions = GetHumanResourcesReportOptions & { readonly idempotencyKey?: string | null };

/**
 * «Liberar agente» (3-J): the assignment OCC saw and the intent's Idempotency-Key, both optional while older clients
 * exist; a key needs the assignment, as the server asks (`expected_version_required`).
 */
export type ReleaseOccOperationAgentOptions = GetHumanResourcesReportOptions & {
  readonly expectedAssignmentId?: string | null;
  readonly idempotencyKey?: string | null;
};

/** «Relevar agente» (3-F): who takes the operation, the assignment OCC saw and the reason (5 to 500 characters). */
export interface HandOverOccOperationCommand {
  readonly agentId: string;
  readonly expectedAssignmentId: string;
  readonly reason: string;
}

/**
 * «Ajustar horario» (3-E): the new local hours of the shift (HH:mm:ss; an end at or before the start crosses
 * midnight, at most 16 hours), the reason (5 to 500 characters) and the shift's `version` on screen.
 */
export interface AdjustHumanResourcesShiftCommand {
  readonly startsAtLocal: string;
  readonly endsAtLocal: string;
  readonly reason: string;
  readonly expectedVersion: string;
}

export interface OccStandAttributesCommand {
  date: string;
  hasBoardingBridge: boolean;
  isRemote: boolean;
  maxAircraftSize: "Narrowbody" | "Widebody" | null;
  isActive: boolean;
}
export type HumanResourcesReportKind = "expirations" | "account-movements" |
  "staff-distribution" | "qualification-coverage";
export type HumanResourcesReportQuery = {
    stationId: string; from: string; to: string; page?: number; limit?: number;
    documentKind?: "Qualification" | "Permit";
    validity?: "Current" | "Expired";
};
export type OccReportKey = "operations" | "turnaround-times" | "services-by-airline" | "reviews" | "agent-productivity" |
  "daily-close";
export type OccReportQuery = { stationId: string; from: string; to: string; page?: number; limit?: number };
export type OccReportFormat = "csv" | "xlsx" | "pdf";
export type HumanResourcesReportPage =
  HumanResourcesExpirationResponseHumanResourcesReportPageResponse |
  HumanResourcesAccountMovementResponseHumanResourcesReportPageResponse |
  HumanResourcesStaffDistributionResponseHumanResourcesReportPageResponse |
  HumanResourcesQualificationCoverageResponseHumanResourcesReportPageResponse;
/**
 * The station and range of a schedule warning read. `includeReadiness` also asks for the shifts on an approved
 * absence and outside a current airport document (`ApprovedAbsence`, `DocumentExpired`, 2-N24).
 */
export type HumanResourcesScheduleWarningsQuery =
  Required<Pick<ListHumanResourcesScheduleWarningsParams,
    "stationId" | "from" | "to">> &
  Pick<ListHumanResourcesScheduleWarningsParams, "page" | "limit" | "includeReadiness">;
export type AcceptAirlinePreinvoiceOptions = Omit<ElevantRequestInit, "body" | "method">;
export type DisputeAirlinePreinvoiceOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlineOperationalRequestsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlinePreinvoicesOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetManagedContractsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetPublicCommercialCatalogOptions = Omit<ElevantRequestInit, "body" | "method">;
export type SubmitCommercialRequestOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetFinanceApprovedServicesOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetFinancePreinvoicesOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetFinanceTariffsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetHumanResourcesPermitsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type RecordHumanResourcesPermitOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetHumanResourcesQualificationsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetHumanResourcesQualificationEquipmentTypesOptions = Omit<ElevantRequestInit, "body" | "method">;
export type RecordHumanResourcesQualificationOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetHumanResourcesDocumentSummaryOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetHumanResourcesDocumentHistoryOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetHumanResourcesShiftsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetHumanResourcesScheduleWarningsOptions =
  Omit<ElevantRequestInit, "body" | "method">;
export type GetHumanResourcesAvailabilityRequestsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type RecordHumanResourcesAvailabilityOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ResolveHumanResourcesAvailabilityOptions = Omit<ElevantRequestInit, "body" | "method">;
export type HumanResourcesAvailabilityQuery = Omit<ListHumanResourcesAvailabilityRequestsParams,
  "from" | "to"> & { readonly from: string; readonly to: string };
export type GetHumanResourcesShiftAssignmentOptionsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type HumanResourcesShiftAssignmentQuery = Required<GetHumanResourcesShiftAssignmentOptionsParams>;
export type RecordHumanResourcesShiftOptions = Omit<ElevantRequestInit, "body" | "method">;
export type HumanResourcesShiftsQuery = Omit<ListHumanResourcesShiftsParams, "from" | "to"> & {
  readonly from: string;
  readonly to: string;
};
export type GetFinanceReconciliationOptions = Omit<ElevantRequestInit, "body" | "method">;
export type CreatePreinvoiceDraftOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetPreinvoiceDraftOptions = Omit<ElevantRequestInit, "body" | "method">;
export type SubmitPreinvoiceOptions = Omit<ElevantRequestInit, "body" | "method">;
export interface FinanceApprovedServicesQuery {
  readonly stationId: string;
  readonly from: string;
  readonly to: string;
}
export type GetOccPlanningSnapshotOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetOccAircraftTrafficOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetOccPlanningOptionsOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetManualTurnaroundOptionsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type CreateManualTurnaroundOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ProgramOccShiftOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetOccReviewOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetOperationalChatOptions = GetOperationalCommunicationOptions & { offset?: number };

function validatedChatOffset(value: number | undefined): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 2_147_483_647))
    throw new RangeError("offset must be a non-negative 32-bit integer.");
  return value;
}

export type GetOperationalCommunicationOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAccountChangesOptions = Omit<ElevantRequestInit, "body" | "method"> & {
  installationId?: string;
};
/**
 * The decision and the charge adjustments of the OCC review. The intent's Idempotency-Key is optional while older
 * callers exist (phase 3, block D, expand); private-web always sends it.
 */
export type DecideOccReviewOptions = Omit<ElevantRequestInit, "body" | "method"> & { readonly idempotencyKey?: string | null };
export type AssignOccPlanningOperationOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetRampAssignedOperationsOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type RegisterMobileDeviceOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type StartRampOperationOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetRampOperationChecklistOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetRampIncidentsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetOperationAttendanceDraftOptions = Omit<ElevantRequestInit, "body" | "method"> & {
  readonly installationId?: string;
};
export type SaveAttendanceDraftOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetHumanResourcesAttendanceOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ValidateHumanResourcesAttendanceOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ReportRampIncidentOptions = Omit<ElevantRequestInit, "body" | "method">;

export interface RampFlightDataCommand {
  passengersIn: number | null;
  passengersOut: number | null;
  mtowKg: number | null;
  aircraftRegistration: string | null;
  /** 3-B: the aircraft type seen on the ramp; omitted or null keeps the current one (and the receipt hash). */
  aircraftTypeId?: string | null;
}
export type SubmitRampOperationOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ReopenRampOperationCorrectionOptions = Omit<ElevantRequestInit, "body" | "method">;
export type SubmitRampOperationChecklistOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type TransitionRampOperationServiceOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetRampOperationChargesOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ApplyRampServiceChargeOptions = Omit<ElevantRequestInit, "body" | "method">;

export interface OccPlanningOptionsWithMetadata {
  readonly options: OccPlanningOptionsResponse;
  readonly etag: string;
}

export interface OccAssignmentWithMetadata {
  readonly assignment: OccAssignmentResponse;
  readonly etag: string;
}

export interface ElevantApiClient {
  getAccountChanges(
    parameters?: GetAccountChangesParams,
    options?: GetAccountChangesOptions,
  ): Promise<AccountChangeListResponse>;
  createSession(
    request: CreateSessionRequest,
    options?: CreateSessionOptions,
  ): Promise<SessionResponse>;
  changePassword(
    request: ChangePasswordRequest,
    options?: ChangePasswordOptions,
  ): Promise<void>;
  /**
   * Portal login (ADR-0022): returns the session, or the email-code challenge that
   * {@link ElevantApiClient.verifyLoginCode} completes.
   */
  startSession(request: CreateSessionRequest, options?: CreateSessionOptions): Promise<SessionStart>;
  verifyLoginCode(challengeId: string, code: string, options?: CreateSessionOptions): Promise<SessionResponse>;
  resendLoginCode(challengeId: string, options?: CreateSessionOptions): Promise<LoginChallengeResponse>;
  /** Sets the first password from the invitation link; Problem Details code invalid_link or password_policy. */
  activateAccount(token: string, newPassword: string, options?: CreateSessionOptions): Promise<void>;
  /** Always resolves when the request is well formed, whether or not the email has an account. */
  requestPasswordReset(email: string, options?: CreateSessionOptions): Promise<void>;
  resetPassword(token: string, newPassword: string, options?: CreateSessionOptions): Promise<void>;
  /**
   * Queues a new activation link for an account that has not activated yet; the earlier links stop working and
   * their queued emails are discarded (ADR-0022, 1-N09). `expectedVersion` is the account version on screen.
   */
  resendAirlineInvitation(accountId: string, command: ResendAirlineInvitationCommand, idempotencyKey: string,
    options?: CreateSessionOptions): Promise<CommercialAccountResponse>;
  sendTestEmail(to: string, options?: CreateSessionOptions): Promise<EmailDeliveryResponse>;
  listEmailDeliveries(options?: CreateSessionOptions): Promise<EmailDeliveriesResponse>;
  /** The superadmin outbox: status filter, paging, the reason of each email and what it is about (1-N22). */
  getEmailOutbox(query?: EmailOutboxQuery, options?: CreateSessionOptions): Promise<EmailOutboxPageResponse>;
  /** Approved requests waiting for their portal account, each with the request version (1-N13). */
  listProvisioningTasks(options?: CreateSessionOptions): Promise<ProvisioningTaskData[]>;
  /**
   * Creates the airline's portal account: an emailed invitation, or the temporary password chosen instead. An email
   * that already has an account fails with `email_has_account` when it can be linked instead.
   */
  provisionAirlineAccount(requestId: string, command: ProvisionAirlineAccountCommand, idempotencyKey: string,
    options?: CreateSessionOptions): Promise<CommercialAccountResponse>;
  /** Links the existing portal account of the email to the request; its credentials do not change (1-N13). */
  linkProvisioningAccount(requestId: string, command: LinkProvisioningAccountCommand, idempotencyKey: string,
    options?: CreateSessionOptions): Promise<CommercialAccountResponse>;
  /**
   * Sets a temporary password the user must change at the next sign-in; on a pending invitation it accepts the
   * invitation, retires its links and discards its queued email (1-N12).
   */
  resetClientUserPassword(organizationId: string, userId: string, command: ResetClientUserPasswordCommand,
    idempotencyKey: string, options?: CreateSessionOptions): Promise<CommercialIdResponse>;
  /** The «Factura emitida» emails of an invoice and their delivery state; none when nobody could receive it (1-N08). */
  getInvoiceEmailDeliveries(invoiceId: string, options?: CreateSessionOptions): Promise<InvoiceEmailStatusResponse>;
  /** Renews the session; a 409 with code refresh_rotated means another tab already did (ADR-0021). */
  refreshSession(refreshToken: string, options?: CreateSessionOptions): Promise<SessionResponse>;
  /** Ends the session: the refresh token and every renewal of it stop working. */
  endSession(refreshToken: string, options?: CreateSessionOptions): Promise<void>;
  getCurrentSession(options?: GetCurrentSessionOptions): Promise<CurrentSessionResponse>;
  getAirlinePortalBootstrap(
    options?: GetAirlinePortalBootstrapOptions,
  ): Promise<AirlinePortalBootstrapResponse>;
  getAirlineContracts(
    parameters?: GetAirlineContractsParams,
    options?: GetAirlineContractsOptions,
  ): Promise<AirlineContractPageResponse>;
  getAirlineOperations(
    parameters?: GetAirlineOperationsParams,
    options?: GetAirlineOperationsOptions,
  ): Promise<AirlineOperationPageResponse>;
  getAirlineOperation(
    operationId: string,
    options?: GetAirlineOperationOptions,
  ): Promise<AirlinePortalOperationResponse>;
  getAirlineApprovedOperationEvidence(
    operationId: string,
    options?: GetAirlineApprovedOperationEvidenceOptions,
  ): Promise<AirlineApprovedOperationEvidenceResponse>;
  getAirlineOperationalRequests(
    parameters?: GetAirlineOperationalRequestsParams,
    options?: GetAirlineOperationalRequestsOptions,
  ): Promise<AirlineOperationalRequestPageResponse>;
  getAirlinePreinvoices(
    parameters?: GetAirlinePreinvoicesParams,
    options?: GetAirlinePreinvoicesOptions,
  ): Promise<AirlinePreinvoicePageResponse>;
  getAirlinePreinvoice(
    preinvoiceId: string,
    options?: GetAirlinePreinvoiceOptions,
  ): Promise<AirlinePreinvoiceDetailResponse>;
  getAirlinePreinvoiceDisputes(
    preinvoiceId: string,
    options?: GetPreinvoiceDisputesOptions,
  ): Promise<PreinvoiceDisputeListResponse>;
  acceptAirlinePreinvoice(
    preinvoiceId: string, request: AcceptAirlinePreinvoiceRequest,
    options?: AcceptAirlinePreinvoiceOptions,
  ): Promise<AcceptAirlinePreinvoiceResponse>;
  disputeAirlinePreinvoice(
    preinvoiceId: string, request: DisputeAirlinePreinvoiceRequest,
    options?: DisputeAirlinePreinvoiceOptions,
  ): Promise<DisputeAirlinePreinvoiceResponse>;
  getManagedContracts(
    parameters?: ListManagedContractsParams,
    options?: GetManagedContractsOptions,
  ): Promise<ManagedContractPageData>;
  getPublicCommercialCatalog(
    options?: GetPublicCommercialCatalogOptions,
  ): Promise<PublicCommercialCatalog>;
  submitCommercialRequest(
    request: SubmitCommercialRequestRequest,
    options?: SubmitCommercialRequestOptions,
  ): Promise<SubmitCommercialRequestResponse>;
  lookupCommercialRequestReceipt(
    request: SubmitCommercialRequestRequest,
    options?: SubmitCommercialRequestOptions,
  ): Promise<SubmitCommercialRequestResponse>;
  getFinanceApprovedServices(
    query: FinanceApprovedServicesQuery,
    options?: GetFinanceApprovedServicesOptions,
  ): Promise<FinanceApprovedServicesResponse>;
  getFinancePreinvoices(
    query: ListFinancePreinvoicesParams,
    options?: GetFinancePreinvoicesOptions,
  ): Promise<FinancePreinvoicePageData>;
  getFinanceTariffs(
    query: ListFinanceTariffsParams,
    options?: GetFinanceTariffsOptions,
  ): Promise<FinanceTariffPageData>;
  getHumanResourcesPermits(
    query?: ListHumanResourcesPermitsParams,
    options?: GetHumanResourcesPermitsOptions,
  ): Promise<HumanResourcesPermitPage>;
  recordHumanResourcesPermit(
    id: string,
    request: RecordHumanResourcesPermitInput,
    options?: RecordHumanResourcesPermitOptions,
  ): Promise<HumanResourcesPermitRecorded>;
  getHumanResourcesQualifications(
    query?: ListHumanResourcesQualificationsParams,
    options?: GetHumanResourcesQualificationsOptions,
  ): Promise<HumanResourcesQualificationPage>;
  getHumanResourcesQualificationEquipmentTypes(
    options?: GetHumanResourcesQualificationEquipmentTypesOptions,
  ): Promise<HumanResourcesQualificationEquipmentType[]>;
  getHumanResourcesQualificationSummary(
    query?: SummarizeHumanResourcesQualificationsParams,
    options?: GetHumanResourcesDocumentSummaryOptions,
  ): Promise<HumanResourcesDocumentSummary>;
  getHumanResourcesQualificationHistory(
    id: string,
    options?: GetHumanResourcesDocumentHistoryOptions,
  ): Promise<HumanResourcesQualificationHistory>;
  getHumanResourcesPermitSummary(
    query?: SummarizeHumanResourcesPermitsParams,
    options?: GetHumanResourcesDocumentSummaryOptions,
  ): Promise<HumanResourcesDocumentSummary>;
  getHumanResourcesPermitHistory(
    id: string,
    options?: GetHumanResourcesDocumentHistoryOptions,
  ): Promise<HumanResourcesPermitHistory>;
  recordHumanResourcesQualification(
    id: string,
    request: RecordHumanResourcesQualificationInput,
    options?: RecordHumanResourcesQualificationOptions,
  ): Promise<HumanResourcesQualificationRecorded>;
  getHumanResourcesShifts(
    query: HumanResourcesShiftsQuery,
    options?: GetHumanResourcesShiftsOptions,
  ): Promise<HumanResourcesShiftPage>;
  getHumanResourcesScheduleWarnings(
    query: HumanResourcesScheduleWarningsQuery,
    options?: GetHumanResourcesScheduleWarningsOptions,
  ): Promise<HumanResourcesScheduleWarningPageResponse>;
  getHumanResourcesAvailabilityRequests(
    query: HumanResourcesAvailabilityQuery,
    options?: GetHumanResourcesAvailabilityRequestsOptions,
  ): Promise<HumanResourcesAvailabilityRequestPage>;
  recordHumanResourcesAvailabilityRequest(
    id: string,
    request: RecordHumanResourcesAvailabilityInput,
    options?: RecordHumanResourcesAvailabilityOptions,
  ): Promise<HumanResourcesAvailabilityWritten>;
  /**
   * Approves, rejects or cancels a pending request with the `version` on screen and the intent's Idempotency-Key
   * (both optional while older clients exist; a key needs the version). Approving a day off or a restriction releases
   * the agent's coverages, unstarted operations and shifts of those days, or fails with
   * `agent_has_operation_in_progress` (2-N08).
   */
  resolveHumanResourcesAvailabilityRequest(
    id: string,
    request: ResolveHumanResourcesAvailabilityInput,
    idempotencyKey?: string | null,
    options?: ResolveHumanResourcesAvailabilityOptions,
  ): Promise<HumanResourcesAvailabilityWritten>;
  /**
   * Cancels an approved absence that has not started, or shortens one that has not ended (2-N22), with a reason, the
   * `version` on screen and an Idempotency-Key. Answers the request's status, last day and new version.
   */
  amendHumanResourcesAvailabilityRequest(
    id: string,
    command: AmendHumanResourcesAvailabilityCommand,
    idempotencyKey: string,
    options?: ResolveHumanResourcesAvailabilityOptions,
  ): Promise<HumanResourcesAvailabilityAmended>;
  getHumanResourcesShiftAssignmentOptions(
    query: HumanResourcesShiftAssignmentQuery,
    options?: GetHumanResourcesShiftAssignmentOptionsOptions,
  ): Promise<HumanResourcesShiftAssignmentOptions>;
  recordHumanResourcesShift(
    id: string,
    request: RecordHumanResourcesShiftInput,
    options?: RecordHumanResourcesShiftOptions,
  ): Promise<HumanResourcesShiftRecorded>;
  /**
   * Removes a shift of today or later in its station's calendar (ADR-0026, 2-N31); removing twice answers the same.
   * With the shift's `version` and the intent's Idempotency-Key (optional while older clients exist; a key needs the
   * version). A past shift is `shift_in_past`; one whose agent covers stands or carries operations in it,
   * `shift_in_use` (2-N11).
   */
  removeHumanResourcesShift(id: string, expectedVersion?: string | null, idempotencyKey?: string | null,
    options?: GetHumanResourcesReportOptions): Promise<void>;
  /**
   * «Ajustar horario» (3-E): Gestión Humana and OCC change the hours of a shift of today or later with its version, a
   * reason and the intent's key (required). It keeps covering the agent's work (`shift_uncovers_work`); a past shift
   * (`shift_in_past`) or one with a validated attendance (`attendance_validated`) stays.
   */
  adjustHumanResourcesShift(id: string, command: AdjustHumanResourcesShiftCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<HumanResourcesShiftAdjusted>;
  /**
   * The planning board's marks (2-N25): the assignments of the station's operations on the date whose agent is
   * inactive, on an approved absence or without a current airport permit or ramp licence. Nothing is released.
   */
  getOccAssignmentReadiness(query: OccAssignmentReadinessQuery,
    options?: GetHumanResourcesReportOptions): Promise<OccAssignmentReadinessResponse>;
  /** «¿Puede operar?» of every active ramp agent, for Gestión Humana (ADR-0026). */
  listRampAgentReadiness(options?: GetHumanResourcesReportOptions): Promise<RampAgentReadinessData[]>;
  /** The signed-in ramp agent's shifts (up to 31 days) and current documents. */
  getOwnRampSchedule(from: string, to: string, options?: GetHumanResourcesReportOptions): Promise<RampAgentScheduleData>;
  getFinanceReconciliation(
    query: ListFinanceReconciliationParams,
    options?: GetFinanceReconciliationOptions,
  ): Promise<FinanceReconciliationPageData>;
  createPreinvoiceDraft(
    request: CreatePreinvoiceDraftRequest,
    options?: CreatePreinvoiceDraftOptions,
  ): Promise<CreatePreinvoiceDraftResponse>;
  getPreinvoiceDraft(
    draftId: string, expectedStationId: string,
    options?: GetPreinvoiceDraftOptions,
  ): Promise<PreinvoiceDraftResponse>;
  getFinancePreinvoiceDisputes(
    draftId: string,
    options?: GetPreinvoiceDisputesOptions,
  ): Promise<PreinvoiceDisputeListResponse>;
  resolveFinancePreinvoiceDispute(
    preinvoiceId: string, request: ResolvePreinvoiceDisputeRequest,
    options?: ResolvePreinvoiceDisputeOptions,
  ): Promise<ResolvePreinvoiceDisputeResponse>;
  issueFinanceInvoice(
    request: IssueFinanceInvoiceRequest,
    options?: IssueFinanceInvoiceOptions,
  ): Promise<IssueFinanceInvoiceResponse>;
  /** ADR-0035: one simulated e-CF invoice for one or several approved operations of one airline. */
  issueInvoiceFromOperations(
    request: IssueInvoiceFromOperationsRequest,
    options?: IssueInvoiceFromOperationsOptions,
  ): Promise<IssuedInvoiceResponse>;
  getFinanceInvoiceDocumentById(
    invoiceId: string, options?: GetFinancialDocumentOptions,
  ): Promise<Blob>;
  getAirlineInvoiceDocumentById(
    invoiceId: string, options?: GetFinancialDocumentOptions,
  ): Promise<Blob>;
  /** ADR-0036: pays the whole balance with a simulated card; the same key and body replay the attempt. */
  payAirlineInvoiceByCard(
    invoiceId: string, request: PayInvoiceByCardBody, idempotencyKey: string,
    options?: PayInvoiceByCardOptions,
  ): Promise<CardPaymentResponse>;
  getAirlineInvoiceCardPayments(invoiceId: string, options?: GetFinancialDocumentOptions): Promise<CardPaymentListResponse>;
  getFinanceInvoiceCardPayments(invoiceId: string, options?: GetFinancialDocumentOptions): Promise<CardPaymentListResponse>;
  getAirlineCardPaymentReceipt(attemptId: string, options?: GetFinancialDocumentOptions): Promise<Blob>;
  getFinanceInvoiceByPreinvoice(
    preinvoiceId: string,
    options?: GetNonFiscalInvoiceOptions,
  ): Promise<NonFiscalInvoiceResponse>;
  getAirlineInvoiceByPreinvoice(
    preinvoiceId: string,
    options?: GetNonFiscalInvoiceOptions,
  ): Promise<NonFiscalInvoiceResponse>;
  recordNonFiscalPayment(
    request: RecordNonFiscalPaymentRequest,
    options?: RecordNonFiscalPaymentOptions,
  ): Promise<RecordNonFiscalPaymentResponse>;
  getFinancePaymentByInvoice(
    invoiceId: string,
    options?: GetNonFiscalPaymentOptions,
  ): Promise<NonFiscalPaymentLookupResponse>;
  getAirlinePaymentByInvoice(
    invoiceId: string,
    options?: GetNonFiscalPaymentOptions,
  ): Promise<NonFiscalPaymentLookupResponse>;
  getAirlineInvoiceStatement(
    invoiceId: string,
    options?: GetNonFiscalPaymentOptions,
  ): Promise<AirlineInvoiceStatementResponse>;
  getAirlineInvoiceDocument(
    preinvoiceId: string, options?: GetFinancialDocumentOptions,
  ): Promise<Blob>;
  getAirlinePaymentReceipt(
    invoiceId: string, options?: GetFinancialDocumentOptions,
  ): Promise<Blob>;
  getFinanceInvoiceDocument(
    preinvoiceId: string, options?: GetFinancialDocumentOptions,
  ): Promise<Blob>;
  getFinancePaymentReceipt(
    invoiceId: string, options?: GetFinancialDocumentOptions,
  ): Promise<Blob>;
  submitPreinvoice(
    draftId: string, request: SubmitPreinvoiceRequest,
    options?: SubmitPreinvoiceOptions,
  ): Promise<SubmitPreinvoiceResponse>;
  getOccPlanningSnapshot(
    parameters?: GetOccPlanningSnapshotParams,
    options?: GetOccPlanningSnapshotOptions,
  ): Promise<OccPlanningSnapshotResponse>;
  getOccAircraftTraffic(
    parameters: GetOccAircraftTrafficParams,
    options?: GetOccAircraftTrafficOptions,
  ): Promise<OccAircraftTrafficResponse>;
  getOccPlanningOptions(
    turnaroundId: string,
    options?: GetOccPlanningOptionsOptions,
  ): Promise<OccPlanningOptionsResponse>;
  getOccPlanningOptionsWithMetadata(
    turnaroundId: string,
    options?: GetOccPlanningOptionsOptions,
  ): Promise<OccPlanningOptionsWithMetadata>;
  getManualTurnaroundOptions(
    parameters: GetManualTurnaroundOptionsParams,
    options?: GetManualTurnaroundOptionsOptions,
  ): Promise<ManualTurnaroundOptionsResponse>;
  createManualTurnaround(
    request: CreateManualTurnaroundRequest,
    options?: CreateManualTurnaroundOptions,
  ): Promise<ManualTurnaroundResponse>;
  programOccShift(
    turnaroundId: string,
    request: ProgramOccShiftRequest,
    options?: ProgramOccShiftOptions,
  ): Promise<ProgramOccShiftResponse>;
  getOccReviewQueue(
    stationId: string,
    options?: GetOccReviewOptions,
  ): Promise<OccReviewQueueResponse>;
  getOccReviewDetail(
    operationId: string,
    options?: GetOccReviewOptions,
  ): Promise<OccReviewDetailResponse>;
  getOccReviewSubmissionDetail(
    operationId: string,
    submissionId: string,
    options?: GetOccReviewOptions,
  ): Promise<OccReviewDetailResponse>;
  getOccReviewSubmissionHistory(
    operationId: string,
    options?: GetOccReviewOptions,
  ): Promise<OccReviewSubmissionHistoryResponse>;
  /** OCC adds a charge to a service while reviewing (ADR-0034); returns the new review version. */
  addOccReviewCharge(operationId: string, command: AddOccReviewChargeCommand, etag: string,
    options?: DecideOccReviewOptions): Promise<OccReviewChargeAdjustResponse>;
  removeOccReviewCharge(operationId: string, markId: string, command: RemoveOccReviewChargeCommand, etag: string,
    options?: DecideOccReviewOptions): Promise<OccReviewChargeAdjustResponse>;
  /** 3-N11: OCC excludes a service in exception from billing, or includes it again; returns the new review version. */
  setOccReviewServiceBillingExclusion(operationId: string, serviceId: string,
    command: SetOccReviewServiceBillingExclusionCommand, etag: string, idempotencyKey: string,
    options?: GetOccReviewOptions): Promise<OccReviewChargeAdjustResponse>;
  /** 3-H: OCC reopens an approval nothing was invoiced from yet as a new pending revision (its ETag is the answer's). */
  reopenOccReview(operationId: string, command: ReopenOccReviewCommand, etag: string, idempotencyKey: string,
    options?: GetOccReviewOptions): Promise<OccReviewReopenResponse>;
  /** 3-G: the live incidents of an operation of OCC's stations, with their history. */
  getOccOperationIncidents(operationId: string, options?: GetOccReviewOptions): Promise<OccIncidentListResponse>;
  /** 3-G: OCC reports an incident of an operation still open; the same key replays it. */
  reportOccIncident(operationId: string, command: ReportOccIncidentCommand, idempotencyKey: string,
    options?: GetOccReviewOptions): Promise<OccIncidentResponse>;
  /** 3-G: OCC moves an incident with a note, against the version it saw. */
  changeOccIncidentStatus(incidentId: string, command: ChangeOccIncidentStatusCommand, version: string,
    idempotencyKey: string, options?: GetOccReviewOptions): Promise<OccIncidentResponse>;
  /** Finance's ground time allowances and holiday calendar (ADR-0034). */
  getFinanceCloseRules(options?: GetHumanResourcesReportOptions): Promise<FinanceCloseRulesResponse>;
  setGroundTimeAllowance(category: AircraftSizeCategory, command: SetGroundTimeAllowanceCommand,
    options?: GetHumanResourcesReportOptions): Promise<GroundTimeAllowanceResponse>;
  addFinanceHoliday(command: AddFinanceHolidayCommand, options?: GetHumanResourcesReportOptions):
    Promise<FinanceHolidayResponse>;
  removeFinanceHoliday(holidayId: string, options?: GetHumanResourcesReportOptions): Promise<void>;
  getOperationalPresence(operationIds: string[], options?: GetOperationalCommunicationOptions): Promise<OperationalPresenceList>;
  putOperationalPresence(heartbeat: PresenceHeartbeat, options?: GetOperationalCommunicationOptions): Promise<void>;
  getOwnOperationalPresence(options?: GetOperationalCommunicationOptions): Promise<OwnPresence>;
  putOwnOperationalPresenceStatus(status: PresenceStatusUpdate, options?: GetOperationalCommunicationOptions): Promise<OwnPresence>;
  getOperationalConversations(
    stationId?: string,
    options?: GetOperationalChatOptions,
  ): Promise<OperationConversationListResponse>;
  getOperationalMessages(
    operationId: string,
    options?: GetOperationalChatOptions,
  ): Promise<OperationMessageListResponse>;
  sendOperationalMessage(
    operationId: string,
    request: SendOperationMessageRequest,
    idempotencyKey: string,
    installationId?: string,
    options?: GetOperationalCommunicationOptions,
  ): Promise<OperationMessageResponse>;
  /** Moves the caller's read cursor forward to that message (ADR-0029); never backwards. */
  markOperationalConversationRead(
    operationId: string,
    messageId: string,
    options?: GetOperationalCommunicationOptions,
  ): Promise<void>;
  getOperationalNotifications(
    options?: GetOperationalCommunicationOptions,
  ): Promise<OperationalNotificationListResponse>;
  setOperationalNotificationRead(
    notificationId: string,
    read: boolean,
    options?: GetOperationalCommunicationOptions,
  ): Promise<OperationalNotificationResponse>;
  getDepartmentNotifications(
    options?: GetOperationalCommunicationOptions,
  ): Promise<DepartmentNotificationListResponse>;
  setDepartmentNotificationRead(
    notificationId: string,
    read: boolean,
    options?: GetOperationalCommunicationOptions,
  ): Promise<DepartmentNotificationResponse>;
  decideOccReview(
    operationId: string,
    request: DecideOccReviewRequest,
    etag: string,
    options?: DecideOccReviewOptions,
  ): Promise<DecideOccReviewResponse>;
  assignOccPlanningOperation(
    turnaroundId: string,
    request: AssignOccOperationRequest,
    etag: string,
    options?: AssignOccPlanningOperationOptions,
  ): Promise<OccAssignmentResponse>;
  assignOccPlanningOperationWithMetadata(
    turnaroundId: string,
    request: AssignOccOperationRequest,
    etag: string,
    options?: AssignOccPlanningOperationOptions,
  ): Promise<OccAssignmentWithMetadata>;
  getRampAssignedOperations(
    options?: GetRampAssignedOperationsOptions,
  ): Promise<RampAssignedOperationsResponse>;
  registerMobileDevice(
    request: RegisterMobileDeviceRequest,
    options?: RegisterMobileDeviceOptions,
  ): Promise<RegisterMobileDeviceResponse>;
  /**
   * «Iniciar». Without `request` the command is the first version's (no body); with it, the tablet sends the
   * moment the agent tapped it, possibly from its offline queue (3-I).
   */
  startRampOperation(
    operationId: string,
    installationId: string,
    idempotencyKey: string,
    options?: StartRampOperationOptions,
    request?: StartRampOperationRequest,
  ): Promise<RampOperationStartResponse>;
  getRampOperationChecklist(
    operationId: string,
    options?: GetRampOperationChecklistOptions,
  ): Promise<GetRampOperationChecklistResponse>;
  getRampIncidents(
    operationId: string,
    options?: GetRampIncidentsOptions,
  ): Promise<GetRampIncidentsResponse>;
  getOperationAttendanceDraft(
    operationId: string,
    assignmentId: string,
    options?: GetOperationAttendanceDraftOptions,
  ): Promise<AttendanceDraftSnapshotResponse>;
  saveOccAttendanceDraft(
    operationId: string,
    assignmentId: string,
    request: SaveAttendanceDraftRequest,
    idempotencyKey: string,
    options?: SaveAttendanceDraftOptions,
  ): Promise<AttendanceDraftWriteResponse>;
  saveRampAttendanceDraft(
    operationId: string,
    assignmentId: string,
    request: SaveAttendanceDraftRequest,
    idempotencyKey: string,
    installationId: string,
    options?: SaveAttendanceDraftOptions,
  ): Promise<AttendanceDraftWriteResponse>;
  /**
   * 3-F: the assignments of the turnaround's operation whose attendance OCC records, oldest first: the open ones and
   * the ones a handover released after the start (`releasedAt`), which the planning board no longer lists. Web only.
   */
  getOccAttendanceAssignments(turnaroundId: string,
    options?: GetHumanResourcesReportOptions): Promise<OccAttendanceAssignmentsResponse>;
  getHumanResourcesAttendance(
    query: GetHumanResourcesAttendanceParams,
    options?: GetHumanResourcesAttendanceOptions,
  ): Promise<HumanResourcesAttendancePageResponse>;
  getHumanResourcesReport(kind: HumanResourcesReportKind,
    query: HumanResourcesReportQuery,
    options?: GetHumanResourcesReportOptions): Promise<HumanResourcesReportPage>;
  exportHumanResourcesReport(kind: HumanResourcesReportKind,
    query: HumanResourcesReportQuery, format: "pdf" | "xlsx",
    options?: GetHumanResourcesReportOptions): Promise<Blob>;
  listOccReports(options?: GetHumanResourcesReportOptions): Promise<OccReportCatalogResponse>;
  getOccPositions(stationId: string, date: string, options?: GetHumanResourcesReportOptions): Promise<OccPositionBoardResponse>;
  /**
   * Records the arrival (3-N08): the registration, the actual time (now when omitted), the aircraft type (3-B) and, to
   * correct a recorded one, the reason. `options.idempotencyKey` and `options.ifMatch` are optional (3-N10); a key needs
   * the turnaround's ETag.
   */
  recordOccArrival(turnaroundId: string,
    request: { aircraftRegistration: string; arrivedAt?: string | null; aircraftTypeId?: string | null; reason?: string | null },
    options?: GetHumanResourcesReportOptions & OccPositionCommandHeaders): Promise<OccPositionBoardResponse>;
  assignOccStand(turnaroundId: string, request: { standId: string; reason?: string | null },
    options?: GetHumanResourcesReportOptions & OccPositionCommandHeaders): Promise<OccPositionBoardResponse>;
  releaseOccStand(turnaroundId: string,
    options?: GetHumanResourcesReportOptions & OccPositionCommandHeaders): Promise<OccPositionBoardResponse>;
  /** One turnaround with its ETag and the changes its state allows (3-A). */
  getOccTurnaround(turnaroundId: string, options?: GetHumanResourcesReportOptions): Promise<OccTurnaroundWithMetadata>;
  /** «Editar vuelo» before the operation starts, with the intent's key and the ETag on screen (3-A). */
  rescheduleOccTurnaround(turnaroundId: string, command: RescheduleOccTurnaroundCommand, headers: OccTurnaroundCommandHeaders,
    options?: GetHumanResourcesReportOptions): Promise<OccTurnaroundWithMetadata>;
  /** «Cancelar vuelo» or «Marcar desviado» before the operation starts (3-A). */
  changeOccTurnaroundStatus(turnaroundId: string, command: ChangeOccTurnaroundStatusCommand,
    headers: OccTurnaroundCommandHeaders, options?: GetHumanResourcesReportOptions): Promise<OccTurnaroundWithMetadata>;
  /** The minimal carrier of a charter (3-N21); 201 the first time, 200 when the key replays it. */
  createOccCharterAirline(command: CreateOccCharterAirlineCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<OccCharterAirlineResponse>;
  /** The active aircraft types the tablet offers in «Datos del vuelo» (3-B). */
  getRampAircraftTypes(options?: GetHumanResourcesReportOptions): Promise<RampAircraftTypesResponse>;
  /** Position coverage per shift (ADR-0030). A rejected coverage throws 422 with `reasons`. */
  getOccCoverage(stationId: string, date: string, options?: GetHumanResourcesReportOptions): Promise<OccCoverageBoardResponse>;
  /** With `options.idempotencyKey` a repeated attempt answers the board instead of a second coverage (3-J). */
  createOccCoverage(request: OccCoverageCommand, options?: OccCoverageCommandOptions): Promise<OccCoverageBoardResponse>;
  /** Releasing twice answers the board; `options.idempotencyKey` replays the release (3-J). */
  releaseOccCoverage(coverageId: string, date: string, options?: OccCoverageCommandOptions): Promise<OccCoverageBoardResponse>;
  updateOccStandAttributes(standId: string, request: OccStandAttributesCommand,
    options?: GetHumanResourcesReportOptions): Promise<OccCoverageBoardResponse>;
  updateOccTerminalRules(terminalId: string, request: { date: string; maxStandsPerAgent: number | null; requiresBridgeQualification: boolean },
    options?: GetHumanResourcesReportOptions): Promise<OccCoverageBoardResponse>;
  addOccStandConstraint(request: { date: string; standId: string; affectedStandId: string; kind: "Cancels" | "NarrowbodyOnly" },
    options?: GetHumanResourcesReportOptions): Promise<OccCoverageBoardResponse>;
  removeOccStandConstraint(constraintId: string, date: string,
    options?: GetHumanResourcesReportOptions): Promise<OccCoverageBoardResponse>;
  /**
   * Releases the agent of an operation not yet started so OCC can assign another. With the assignment OCC saw
   * (`assignment_changed` otherwise) and the intent's key (3-J); a started operation is `operation_started`.
   */
  releaseOccOperationAgent(turnaroundId: string, options?: ReleaseOccOperationAgentOptions): Promise<void>;
  /**
   * «Relevar agente» (3-F): who works an operation in progress or returned now and the agents of the station that may
   * take what is left of it (`handover_not_allowed` in any other status).
   */
  getOccHandoverOptions(turnaroundId: string, options?: GetHumanResourcesReportOptions): Promise<OccHandoverOptionsResponse>;
  /** «Relevar agente» (3-F): hands the operation to another eligible agent with the intent's key (required). */
  handOverOccOperation(turnaroundId: string, command: HandOverOccOperationCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<OccOperationHandoverResponse>;
  /** The agent's shift of the flight's day with its version (3-E); `shift_not_found` (404) when there is none. */
  getOccAgentShift(turnaroundId: string, agentId: string,
    options?: GetHumanResourcesReportOptions): Promise<OccAgentShiftResponse>;
  /** «Mis posiciones de hoy» of the signed-in ramp agent. */
  getOwnRampCoverage(options?: GetOperationalCommunicationOptions): Promise<RampOwnCoverageListResponse>;
  /** Places a stand on the map (WGS84) or clears it with both coordinates null (ADR-0027). */
  locateOccStand(standId: string, request: { latitude: number | null; longitude: number | null; operationDate: string },
    options?: GetHumanResourcesReportOptions): Promise<OccPositionBoardResponse>;
  /**
   * Flights the feed proposed and the unit budget (ADR-0028). `options.view` is Contracted (default), Charter
   * (carriers without contract, 2-B) or Dismissed (2-N36); suspended or expired contracts appear in none (2-N16).
   */
  getOccFlightFeed(stationId: string, date: string,
    options?: GetHumanResourcesReportOptions & { readonly view?: OccFlightFeedView }): Promise<OccFlightFeedResponse>;
  /** «Actualizar ahora»: one provider read, at most every ten minutes per station. */
  refreshOccFlightFeed(stationId: string, options?: GetHumanResourcesReportOptions): Promise<RefreshOccFlightFeedResponse>;
  /** Creates the turnaround of a proposed arrival and its departure; repeating it returns the same one. */
  importOccFlight(arrivalProposalId: string, departureProposalId: string,
    options?: GetHumanResourcesReportOptions): Promise<ImportOccFlightResponse>;
  dismissOccFlightProposal(proposalId: string, options?: GetHumanResourcesReportOptions): Promise<void>;
  /**
   * «Importar escala» with the intent's Idempotency-Key and the versions on screen (2-B): optionally the aircraft type
   * (suggested from the provider's model), the stand and the charter mode of a carrier without contract (ADR-0033).
   * A taken or forbidden stand answers `stand_unavailable` with its rules in `reasons`.
   */
  importOccFlightProposals(command: ImportOccFlightCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<ImportOccFlightResponse>;
  /** Brings a dismissed proposal back while its flight has not passed (2-N36), with the version on screen. */
  restoreOccFlightProposal(proposalId: string, expectedVersion: string, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<RestoreOccFlightProposalResponse>;
  /** Every station and the known airports without one; only the superadministrator (2-A). */
  listGovernanceStations(options?: GetHumanResourcesReportOptions): Promise<StationCatalogData>;
  /** A new station with the IATA code of its airport; 201 the first time, 200 when the key replays it. */
  createGovernanceStation(input: CreateStationInput, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<StationCatalogItemData>;
  /** Renames, changes the time zone while it has no history, deactivates or reactivates a station. */
  updateGovernanceStation(stationId: string, input: UpdateStationInput, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<StationCatalogItemData>;
  /** Terminals, stands and aircraft types of a station in scope (`operations.master_data.read`). */
  getOccMasterData(stationId: string, options?: GetHumanResourcesReportOptions): Promise<OccMasterData>;
  createOccTerminal(input: CreateTerminalInput, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<MasterTerminalData>;
  updateOccTerminal(terminalId: string, input: UpdateTerminalInput, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<MasterTerminalData>;
  createOccStand(input: CreateStandInput, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<MasterStandData>;
  updateOccStand(standId: string, input: UpdateStandInput, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<MasterStandData>;
  createOccAircraftType(input: CreateAircraftTypeInput, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<MasterAircraftTypeData>;
  updateOccAircraftType(aircraftTypeId: string, input: UpdateAircraftTypeInput, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<MasterAircraftTypeData>;
  /** Contracts OCC can plan flights for at a station on a date (ADR-0027). */
  listOccReadyContracts(stationId: string, date: string,
    options?: GetHumanResourcesReportOptions): Promise<OccReadyContractsResponse>;
  getContractDocument(versionId: string, options?: GetHumanResourcesReportOptions): Promise<ContractDocumentResponse>;
  downloadContractDocument(versionId: string, options?: GetHumanResourcesReportOptions): Promise<Blob>;
  /** Watermarked review PDF of a draft version (never signable). */
  downloadContractDraftPdf(versionId: string, options?: GetHumanResourcesReportOptions): Promise<Blob>;
  /** Permit dossier of the portal user's airline (ADR-0024). */
  getAirlinePermits(options?: GetHumanResourcesReportOptions): Promise<AirlinePermitData[]>;
  /**
   * The airline submits a permit with the intent's Idempotency-Key (optional while older portals exist, 2-N09): a
   * retry with the same key and body answers the permit the first attempt created. A scan uploaded before the media
   * link window answers `document_expired` (2-N37).
   */
  submitAirlinePermit(input: SubmitAirlinePermitInput, idempotencyKey?: string | null,
    options?: GetHumanResourcesReportOptions): Promise<AirlinePermitData>;
  /** Every permit for Contratos (`contracts.permits.read`), optionally of one review state. */
  getContractsAirlinePermits(review?: AirlinePermitReview | null,
    options?: GetHumanResourcesReportOptions): Promise<AirlinePermitData[]>;
  /**
   * Contratos verifies or rejects a submitted permit with the version on screen (`review_closed` otherwise). Answers
   * the permit and the contracts the review activated or resumed (2-N30).
   */
  reviewAirlinePermit(permitId: string, command: ReviewAirlinePermitCommand, idempotencyKey?: string | null,
    options?: GetHumanResourcesReportOptions): Promise<AirlinePermitDecisionData>;
  /**
   * Contratos revokes a verified permit with a reason (2-N09): the active contracts left without a usable operating
   * permit are suspended at once and named in the answer.
   */
  revokeAirlinePermit(permitId: string, command: RevokeAirlinePermitCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<AirlinePermitDecisionData>;
  /** Where the session's airline stands: historical stations, read-only and what each contract waits for (2-N32). */
  getAirlinePortalStanding(options?: GetHumanResourcesReportOptions): Promise<AirlinePortalStandingResponse>;
  /**
   * The tablet frees its binding when the agent signs out (2-N02). The Idempotency-Key is scoped to the installation;
   * `device_not_bound` means another agent, OCC or the end of the agent's duty already freed it.
   */
  releaseMobileDevice(command: ReleaseMobileDeviceCommand, idempotencyKey: string,
    options?: RegisterMobileDeviceOptions): Promise<void>;
  /** OCC: the tablets last used by agents of the station, who holds each one and what the actor may do (2-N02). */
  getOccMobileDevices(stationId: string, options?: GetHumanResourcesReportOptions): Promise<OccMobileDevicesData>;
  /** OCC frees a tablet with the binding token on screen (`version`); answers the tablet as it is now. */
  unbindOccMobileDevice(deviceId: string, command: UnbindOccMobileDeviceCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<OccMobileDeviceData>;
  /** OCC revokes a lost tablet with a reason: it never registers again and its holder's sessions end. */
  revokeOccMobileDevice(deviceId: string, command: RevokeOccMobileDeviceCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<OccMobileDeviceData>;
  /** The portal users of the session's airline and what the session may do with them (2-N20). */
  getAirlinePortalUsers(options?: GetHumanResourcesReportOptions): Promise<AirlinePortalUsersData>;
  /** A representative invites a user by email; the activation email is queued. Answers the new user. */
  inviteAirlinePortalUser(command: InviteAirlinePortalUserCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<AirlinePortalUserData>;
  /** A representative deactivates or reactivates another user with the version on screen. */
  setAirlinePortalUserStatus(userId: string, command: SetAirlinePortalUserStatusCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<AirlinePortalUserData>;
  /** A representative lets another user sign contracts and submit the JAC permit, or takes it back. */
  setAirlinePortalUserSigner(userId: string, command: SetAirlinePortalUserSignerCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<AirlinePortalUserData>;
  /** Uploads the scanned permit (PDF, JPG or PNG, up to 8 MB) and returns its private media URL. */
  uploadAirlinePermitDocument(file: Blob, options?: GetHumanResourcesReportOptions): Promise<string>;
  /** History of the contract of a version, oldest first (request, Finance, signatures, permits, status). */
  getContractTimeline(versionId: string, options?: GetHumanResourcesReportOptions): Promise<ContractTimelineData>;
  signContractVersion(versionId: string, request: SignContractRequest, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<ContractDocumentResponse>;
  /** Contratos inbox of public requests: server filter, search, paging and counters per status. */
  getCommercialRequestInbox(query?: CommercialInboxQuery,
    options?: GetHumanResourcesReportOptions): Promise<CommercialInboxData>;
  /** Verifies the request's airline, or links the proposed one to an existing profile. */
  verifyCommercialRequestAirline(requestId: string, command: VerifyCommercialRequestAirlineCommand,
    idempotencyKey: string, options?: GetHumanResourcesReportOptions): Promise<CommercialIdResponse>;
  /** Records who confirmed the representative, when and how; approval requires it. */
  confirmCommercialRepresentative(requestId: string, command: ConfirmCommercialRepresentativeCommand,
    idempotencyKey: string, options?: GetHumanResourcesReportOptions): Promise<CommercialIdResponse>;
  cancelCommercialRequest(requestId: string, command: CancelCommercialRequestCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<CommercialIdResponse>;
  /** Approves (returns the draft contract) or rejects with a reason. */
  decideCommercialRequest(requestId: string, command: DecideCommercialRequestCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<CommercialIdResponse>;
  /**
   * Contratos confirms validity, renewal and termination before signatures (ADR-0025), with the intent's
   * Idempotency-Key (optional while older callers exist): a retry with the same key and body replays it.
   */
  setContractValidity(versionId: string, request: SetContractValidityRequest, idempotencyKey?: string | null,
    options?: GetHumanResourcesReportOptions): Promise<ContractDocumentResponse>;
  /**
   * Contratos withdraws an approved version both parties have not signed (2-N10): it becomes Rejected and a
   * one-party signature is voided in the audit trail. Answers the version, its contract and, for a contract
   * that never activated, the new draft with the same content.
   */
  withdrawContractVersion(versionId: string, command: WithdrawContractVersionCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<ContractWithdrawalResponse>;
  /** Surcharges and packages that apply to an approved or superseded version and whether they are signed (2-N04). */
  getContractPricingTerms(versionId: string,
    options?: GetHumanResourcesReportOptions): Promise<ContractPricingTermsResponse>;
  /** Whether a draft can go to Finance, each blocking cause and the airline's portal account (phase 1, B). */
  getContractDraftReadiness(versionId: string,
    options?: GetHumanResourcesReportOptions): Promise<ContractDraftReadinessData>;
  /** The services and stations of a draft and the active ones that can be added. */
  getContractDraftScope(versionId: string, options?: GetHumanResourcesReportOptions): Promise<ContractDraftScopeData>;
  /** Sets the services and stations of a draft; new services start from the base tariff, unconfirmed. */
  setContractDraftScope(versionId: string, command: SetContractDraftScopeCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<CommercialIdResponse>;
  /** Saves terms, validity, currency, rates and charges of a draft. */
  updateManagedContractDraft(versionId: string, command: UpdateManagedContractDraftCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<CommercialIdResponse>;
  /** «Enviar a Finanzas»; answers the contract of the draft. */
  submitManagedContractDraft(versionId: string, command: SubmitManagedContractDraftCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<CommercialIdResponse>;
  /** Discards a draft or a version awaiting Finance with a reason; nothing is deleted. */
  discardContractDraft(versionId: string, command: DiscardContractDraftCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<CommercialIdResponse>;
  /** Contratos answers the airline on its draft; answers the new comment. */
  replyContractDraft(versionId: string, command: ContractDraftMessageCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<CommercialIdResponse>;
  /** The airline's observation on its draft, also while Finance reviews it; answers the new comment. */
  commentAirlineContractDraft(versionId: string, command: ContractDraftMessageCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<CommercialIdResponse>;
  /**
   * Contratos amends an active or suspended contract from any of its versions (1-C): a new draft from the
   * latest approved version, starting on `validFrom`; answers the new draft version.
   */
  createContractAmendment(versionId: string, command: CreateContractAmendmentCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<FinancePackageIdResponse>;
  /** Finance discards a package draft with a reason (1-N27); it is kept as Discarded. */
  discardFinancePackage(packageId: string, command: FinancePackageLifecycleCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<FinancePackageIdResponse>;
  /** Finance retires a published package with a reason (1-N27); approved contracts keep it. */
  retireFinancePackage(packageId: string, command: FinancePackageLifecycleCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<FinancePackageIdResponse>;
  /**
   * Contratos edits a catalog service: hides it from the public catalog, shows it or reactivates it, never
   * retires it (1-N03). Answers the service as stored.
   */
  updateManagedService(serviceId: string, command: UpdateManagedServiceCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<ManagedServiceData>;
  /** «Dar de baja» with a reason; refused while a contract in force or in approval uses the service (1-N03). */
  retireManagedService(serviceId: string, command: RetireManagedServiceCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<ManagedServiceData>;
  /** Contratos approves or denies an OCC closure request, also of a hidden or retired service (1-N11). */
  decideServiceClosure(closureId: string, command: DecideServiceClosureCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<ServiceClosureData>;
  /** Republishes the service its approved closure hid; a retired service is reactivated first (1-N11). */
  reopenService(serviceId: string, command: ReopenServiceCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<ServiceClosureData>;
  getOccReport(key: OccReportKey, query: OccReportQuery,
    options?: GetHumanResourcesReportOptions): Promise<OccReportPageResponse>;
  exportOccReport(key: OccReportKey, query: OccReportQuery, format: OccReportFormat,
    options?: GetHumanResourcesReportOptions): Promise<Blob>;
  validateHumanResourcesAttendance(
    assignmentId: string,
    stationId: string,
    request: ValidateAttendanceRequest,
    idempotencyKey: string,
    options?: ValidateHumanResourcesAttendanceOptions,
  ): Promise<AttendanceValidationWriteResponse>;
  reportRampIncident(
    operationId: string,
    request: ReportRampIncidentRequest,
    installationId: string,
    idempotencyKey: string,
    options?: ReportRampIncidentOptions,
  ): Promise<RampIncidentReceiptResponse>;
  /** Records the time of one Flight Report milestone (ADR-0031); idempotent per device. */
  recordRampMilestone(
    operationId: string,
    code: string,
    occurredAt: string,
    installationId: string,
    idempotencyKey: string,
    options?: ReportRampIncidentOptions,
  ): Promise<RampExecutionResponse>;
  /** AVIAM forms of the operation with what each still needs signed (ADR-0032). */
  getRampOperationDocuments(operationId: string, options?: ReportRampIncidentOptions): Promise<OperationDocumentsResponse>;
  /** Records a drawn signature against the content hash the signer saw; a 409 means the form changed. */
  signRampOperationDocument(
    operationId: string,
    kind: OperationDocumentKind,
    role: OperationSignatureRole,
    command: SignOperationDocumentCommand,
    installationId: string,
    idempotencyKey: string,
    options?: ReportRampIncidentOptions,
  ): Promise<OperationDocumentsResponse>;
  /** Marks a damage of the 360° walk-around on the silhouette; the id comes from the tablet. */
  recordRampDamageMark(
    operationId: string,
    markId: string,
    command: RecordDamageMarkCommand,
    installationId: string,
    idempotencyKey: string,
    options?: ReportRampIncidentOptions,
  ): Promise<OperationDocumentsResponse>;
  /** Attaches the JPEG or PNG photo of a marked damage; the same bytes again are a retry. */
  attachRampDamagePhoto(
    operationId: string,
    markId: string,
    photo: Blob,
    contentType: "image/jpeg" | "image/png",
    installationId: string,
    options?: ReportRampIncidentOptions,
  ): Promise<OperationDocumentsResponse>;
  /** OCC: forms of an operation of its stations. */
  getOccOperationDocuments(operationId: string, options?: GetHumanResourcesReportOptions): Promise<OperationDocumentsResponse>;
  /** OCC: the current form as PDF, signatures and walk-around photos included. */
  downloadOccOperationDocument(operationId: string, kind: OperationDocumentKind,
    options?: GetHumanResourcesReportOptions): Promise<Blob>;
  /**
   * OCC: the photo of one walk-around damage mark (3-K), JPEG or PNG only, read on demand when OCC opens it. Anything
   * else the server answers is a malformed response.
   */
  getOccDamagePhoto(operationId: string, markId: string, options?: GetHumanResourcesReportOptions): Promise<Blob>;
  /** Airline portal: the latest Service Order its representative signed. */
  getAirlineServiceOrder(operationId: string, options?: GetHumanResourcesReportOptions): Promise<AirlineServiceOrderResponse>;
  downloadAirlineServiceOrder(operationId: string, options?: GetHumanResourcesReportOptions): Promise<Blob>;
  /** A charter on the tablet (ADR-0033): carrier data and the services it can add at the base tariff. */
  getRampCharter(operationId: string, options?: ReportRampIncidentOptions): Promise<RampCharterResponse>;
  addRampCharterService(operationId: string, command: AddCharterServiceCommand, installationId: string,
    idempotencyKey: string, options?: ReportRampIncidentOptions): Promise<RampCharterResponse>;
  updateRampCharterDetails(operationId: string, command: CharterDetailsCommand, installationId: string,
    idempotencyKey: string, options?: ReportRampIncidentOptions): Promise<RampCharterResponse>;
  /** Finance: charters of its stations and their prepayment. */
  getFinanceCharters(options?: GetHumanResourcesReportOptions): Promise<FinanceCharterListResponse>;
  confirmFinanceCharterPrepayment(charterId: string, command: ConfirmCharterPrepaymentCommand,
    options?: GetHumanResourcesReportOptions): Promise<FinanceCharterResponse>;
  /** 3-N24: Finance reopens a confirmed prepayment as a new quotation, with its reason and the version it saw. */
  reopenFinanceCharterPrepayment(charterId: string, command: ReopenCharterPrepaymentCommand, idempotencyKey: string,
    options?: GetHumanResourcesReportOptions): Promise<FinanceCharterResponse>;
  /** Saves passengers, MTOW and the registration correction typed once on the ramp. */
  updateRampFlightData(
    operationId: string,
    request: RampFlightDataCommand,
    installationId: string,
    idempotencyKey: string,
    options?: ReportRampIncidentOptions,
  ): Promise<RampExecutionResponse>;
  submitRampOperation(
    operationId: string,
    request: SubmitRampOperationRequest,
    installationId: string,
    idempotencyKey: string,
    options?: SubmitRampOperationOptions,
  ): Promise<RampOperationSubmissionResponse>;
  reopenRampOperationCorrection(
    operationId: string,
    installationId: string,
    idempotencyKey: string,
    options?: ReopenRampOperationCorrectionOptions,
  ): Promise<RampOperationCorrectionResponse>;
  submitRampOperationChecklist(
    operationId: string,
    request: SubmitRampOperationChecklistRequest,
    installationId: string,
    idempotencyKey: string,
    options?: SubmitRampOperationChecklistOptions,
  ): Promise<RampChecklistSubmissionResponse>;
  transitionRampOperationService(
    operationId: string,
    serviceId: string,
    request: TransitionRampOperationServiceRequest,
    installationId: string,
    idempotencyKey: string,
    options?: TransitionRampOperationServiceOptions,
  ): Promise<RampOperationServiceTransitionResponse>;
  getRampOperationCharges(
    operationId: string,
    installationId: string,
    options?: GetRampOperationChargesOptions,
  ): Promise<RampOperationChargesResponse>;
  applyRampServiceCharge(
    operationId: string,
    serviceId: string,
    request: ApplyRampServiceChargeRequest,
    installationId: string,
    idempotencyKey: string,
    options?: ApplyRampServiceChargeOptions,
  ): Promise<RampServiceChargeCommandResponse>;
  getSystemPing(options?: GetSystemPingOptions): Promise<SystemPingResponse>;
}

interface ApiResult {
  readonly status: number;
  readonly data: unknown | undefined;
  readonly etag: string | null;
}

interface ProblemMetadata {
  readonly title?: string;
  readonly traceId?: string;
  readonly code?: ElevantApiErrorCode;
  readonly reasons?: readonly unknown[];
}

function validatedBaseUrl(input: string) {
  if (typeof input !== "string" || input.length === 0 || input.trim() !== input) {
    throw new TypeError("baseUrl must be a non-empty absolute HTTP(S) origin.");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError("baseUrl must be a non-empty absolute HTTP(S) origin.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("baseUrl must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new TypeError("baseUrl must not contain credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("baseUrl must be an origin without a path, query, or fragment.");
  }

  return url.origin;
}

function validatedRequestUrl(baseUrl: string, path: string) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("API request paths must start with one forward slash.");
  }

  const url = new URL(path, `${baseUrl}/`);
  if (url.origin !== baseUrl || url.hash) {
    throw new TypeError("API request paths must stay on the configured API origin.");
  }
  return url;
}

function headersFrom(input: HeadersInit | undefined, label: string) {
  try {
    return new Headers(input);
  } catch {
    throw new TypeError(`${label} contains an invalid HTTP header.`);
  }
}

function mergeHeaders(defaultHeaders: Headers, requestHeaders?: HeadersInit) {
  const merged = new Headers(defaultHeaders);
  headersFrom(requestHeaders, "Request headers").forEach((value, name) =>
    merged.set(name, value),
  );
  return merged;
}

function isAbortError(error: unknown): error is Error {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function validResponse(value: unknown): value is Response {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "status" in value &&
    typeof value.status === "number" &&
    "headers" in value &&
    typeof value.headers === "object" &&
    value.headers !== null &&
    "get" in value.headers &&
    typeof value.headers.get === "function" &&
    "text" in value &&
    typeof value.text === "function"
  );
}

function jsonPost(options: CreateSessionOptions | undefined, body: unknown): RequestInit {
  return {
    ...options,
    method: "POST",
    headers: { ...Object.fromEntries(headersFrom(options?.headers, "Request headers")), "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function malformedResponse(status: number) {
  return new ElevantApiError({
    kind: "malformed-response",
    status,
    title: "Malformed API response",
  });
}

function problemMetadata(value: unknown): ProblemMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.traceId === "string" ? { traceId: record.traceId } : {}),
    ...(ELEVANT_API_ERROR_CODES.includes(record.code as ElevantApiErrorCode) ? { code: record.code as ElevantApiErrorCode } : {}),
    ...(Array.isArray(record.reasons) ? { reasons: record.reasons.slice(0, 32) } : {}),
  };
}

async function readProblemMetadata(response: Response) {
  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {};
  }

  if (body.trim().length === 0) return {};
  try {
    return problemMetadata(JSON.parse(body));
  } catch {
    return {};
  }
}

async function readSuccessBody(response: Response) {
  if (response.status === 204 || response.status === 205) return undefined;

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw malformedResponse(response.status);
  }

  if (body.trim().length === 0) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw malformedResponse(response.status);
  }
}

function isSystemPingResponse(value: unknown): value is SystemPingResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.application === "string" &&
    typeof response.status === "string" &&
    typeof response.environment === "string" &&
    typeof response.timestampUtc === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ) &&
    value.toLowerCase() !== "00000000-0000-0000-0000-000000000000"
  );
}

function isDateOnly(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000-")
  ) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isDateTimeOffset(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const match = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?([zZ]|[+-](\d{2}):(\d{2}))$/.exec(
    value,
  );
  if (!match || !isDateOnly(match[1])) return false;

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return false;

  if (match[5]?.toLowerCase() !== "z") {
    const offsetHour = Number(match[6]);
    const offsetMinute = Number(match[7]);
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      return false;
    }
  }

  return !Number.isNaN(Date.parse(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInt32(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= -2_147_483_648 &&
    value <= 2_147_483_647
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

// Missing availability/message fields are tolerated so a server without chosen status stays readable.
function isPresenceStatus(value: Record<string, unknown>) {
  return ["active", "away", "offline", "unknown"].includes(String(value.state)) &&
    (value.availability === undefined || value.availability === null ||
      (PRESENCE_AVAILABILITIES as readonly unknown[]).includes(value.availability)) &&
    (value.message === undefined || value.message === null ||
      (typeof value.message === "string" && value.message.length <= PRESENCE_MESSAGE_MAX_LENGTH));
}

function isOwnPresence(value: unknown): value is OwnPresence {
  return isRecord(value) && hasOnlyKeys(value, ["state", "availability", "message"]) && isPresenceStatus(value);
}

function isOptionalNullable(
  value: unknown,
  predicate: (candidate: unknown) => boolean,
) {
  return value === undefined || value === null || predicate(value);
}

function isChangeCursor(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function isAccountChangeListResponse(
  value: unknown, after: string | undefined, limit: number,
): value is AccountChangeListResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["changes", "nextCursor", "hasMore"]) ||
      !Array.isArray(value.changes) || value.changes.length > limit ||
      typeof value.hasMore !== "boolean" ||
      (value.hasMore && value.changes.length === 0)) return false;
  if (!value.changes.every((item: unknown) =>
    isRecord(item) &&
    hasOnlyKeys(item, ["eventId", "cursor", "resource", "resourceId", "occurredAt"]) &&
    isUuid(item.eventId) && isChangeCursor(item.cursor) &&
    isNonEmptyString(item.resource) && item.resource.length <= 64 &&
    /^[a-z0-9_-]+$/.test(item.resource) && isUuid(item.resourceId) &&
    isDateTimeOffset(item.occurredAt))) return false;
  const last = value.changes.at(-1) as { cursor: string } | undefined;
  return last ? value.nextCursor === last.cursor :
    (after === undefined ? value.nextCursor === null || value.nextCursor === undefined
      : value.nextCursor === after);
}

function isOccStationResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "code", "name", "ianaTimeZone"]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.name) &&
    isString(value.ianaTimeZone)
  );
}

function isOccTerminalResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "code", "name"]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.name)
  );
}

function isOccStandResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "code", "terminal"]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isOptionalNullable(value.terminal, isOccTerminalResponse)
  );
}

function isOccAirlineResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "iataCode", "icaoCode", "name"]) &&
    isUuid(value.id) &&
    isString(value.iataCode) &&
    isString(value.icaoCode) &&
    isString(value.name)
  );
}

function isOccAircraftResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "icaoCode",
      "iataCode",
      "manufacturer",
      "model",
      "registration",
    ]) &&
    isUuid(value.id) &&
    isString(value.icaoCode) &&
    isOptionalNullable(value.iataCode, isString) &&
    isString(value.manufacturer) &&
    isString(value.model) &&
    isOptionalNullable(value.registration, isString)
  );
}

function isOccAirportResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "iataCode", "icaoCode", "name"]) &&
    isUuid(value.id) &&
    isString(value.iataCode) &&
    isString(value.icaoCode) &&
    isString(value.name)
  );
}

function isOccFlightLegResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "flightNumber",
      "origin",
      "destination",
      "scheduledAt",
      "estimatedAt",
      "actualAt",
    ]) &&
    isUuid(value.id) &&
    isString(value.flightNumber) &&
    isOccAirportResponse(value.origin) &&
    isOccAirportResponse(value.destination) &&
    isDateTimeOffset(value.scheduledAt) &&
    isOptionalNullable(value.estimatedAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualAt, isDateTimeOffset)
  );
}

function isOccGroundOperationResponse(
  value: unknown,
): value is RampGroundOperationResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "status",
      "plannedStartAt",
      "plannedEndAt",
      "actualStartAt",
      "actualEndAt",
      "passengersIn",
      "passengersOut",
      "mtowKg",
    ]) &&
    isUuid(value.id) &&
    isString(value.status) &&
    isOptionalNullable(value.plannedStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.plannedEndAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualEndAt, isDateTimeOffset) &&
    isOptionalNullable(value.passengersIn, isPassengerCount) &&
    isOptionalNullable(value.passengersOut, isPassengerCount) &&
    isOptionalNullable(value.mtowKg, isMtow)
  );
}

function isOccAssignedAgentResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "assignmentId",
      "agentId",
      "displayName",
      "employeeNumber",
      "positionId",
      "positionCode",
      "positionName",
      "assignmentRole",
      "assignedAt",
    ]) &&
    isUuid(value.assignmentId) &&
    isUuid(value.agentId) &&
    isString(value.displayName) &&
    isString(value.employeeNumber) &&
    isOptionalNullable(value.positionId, isUuid) &&
    isOptionalNullable(value.positionCode, isString) &&
    isOptionalNullable(value.positionName, isString) &&
    isString(value.assignmentRole) &&
    isDateTimeOffset(value.assignedAt)
  );
}

function isOccAssignedEquipmentResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "assignmentId",
      "equipmentId",
      "assetCode",
      "equipmentTypeId",
      "equipmentTypeCode",
      "equipmentTypeName",
      "status",
      "assignedAt",
    ]) &&
    isUuid(value.assignmentId) &&
    isUuid(value.equipmentId) &&
    isString(value.assetCode) &&
    isUuid(value.equipmentTypeId) &&
    isString(value.equipmentTypeCode) &&
    isString(value.equipmentTypeName) &&
    isString(value.status) &&
    isDateTimeOffset(value.assignedAt)
  );
}

function isOccOperationServiceResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "lineNumber",
      "serviceDefinitionId",
      "code",
      "name",
      "contractedQuantity",
      "executedQuantity",
      "billingUnit",
      "status",
    ]) &&
    isUuid(value.id) &&
    isInt32(value.lineNumber) &&
    isUuid(value.serviceDefinitionId) &&
    isString(value.code) &&
    isString(value.name) &&
    isFiniteNumber(value.contractedQuantity) &&
    isFiniteNumber(value.executedQuantity) &&
    isString(value.billingUnit) &&
    isString(value.status)
  );
}

function isOccTurnaroundResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "operationCode",
      "operationDate",
      "status",
      "airline",
      "aircraft",
      "stand",
      "arrival",
      "departure",
      "operation",
      "agents",
      "equipment",
      "services",
    ]) &&
    isUuid(value.id) &&
    isString(value.operationCode) &&
    isDateOnly(value.operationDate) &&
    isString(value.status) &&
    isOccAirlineResponse(value.airline) &&
    isOptionalNullable(value.aircraft, isOccAircraftResponse) &&
    isOptionalNullable(value.stand, isOccStandResponse) &&
    isOptionalNullable(value.arrival, isOccFlightLegResponse) &&
    isOptionalNullable(value.departure, isOccFlightLegResponse) &&
    isOptionalNullable(value.operation, isOccGroundOperationResponse) &&
    Array.isArray(value.agents) &&
    value.agents.every(isOccAssignedAgentResponse) &&
    Array.isArray(value.equipment) &&
    value.equipment.every(isOccAssignedEquipmentResponse) &&
    Array.isArray(value.services) &&
    value.services.every(isOccOperationServiceResponse)
  );
}

/** One turnaround as OCC edits it (3-A): the snapshot's turnaround, its station, version and allowed changes. */
function isOccTurnaroundDetail(value: unknown, turnaroundId: string): value is OccTurnaroundDetailResponse {
  return isRecord(value) && hasOnlyKeys(value, ["station", "turnaround", "version", "isCharter", "allowedActions"]) &&
    isOccStationResponse(value.station) && isOccTurnaroundResponse(value.turnaround) &&
    isRecord(value.turnaround) && typeof value.turnaround.id === "string" &&
    value.turnaround.id.toLowerCase() === turnaroundId.toLowerCase() &&
    isNonEmptyString(value.version) && value.version.length <= 64 && typeof value.isCharter === "boolean" &&
    Array.isArray(value.allowedActions) && value.allowedActions.every(isOccTurnaroundAction);
}

/** The imported pair's turnaround; `linked` (3-N07) is optional so an older server keeps answering. */
function isImportedFlight(value: unknown): value is ImportOccFlightResponse {
  return isRecord(value) && hasOnlyKeys(value, ["turnaroundId", "operationCode", "replayed", "linked"]) &&
    isUuid(value.turnaroundId) && isNonEmptyString(value.operationCode) && typeof value.replayed === "boolean" &&
    (value.linked === undefined || typeof value.linked === "boolean");
}

function isOccPlanningSnapshotResponse(
  value: unknown,
): value is OccPlanningSnapshotResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["station", "date", "turnarounds"]) &&
    isOccStationResponse(value.station) &&
    isDateOnly(value.date) &&
    Array.isArray(value.turnarounds) &&
    value.turnarounds.every(isOccTurnaroundResponse)
  );
}

function isOccAircraftTrafficResponse(value: unknown): value is OccAircraftTrafficResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["source", "providerTime", "retrievedAt", "stale", "aircraft"]) &&
    isString(value.source) && isDateTimeOffset(value.providerTime) &&
    isDateTimeOffset(value.retrievedAt) && typeof value.stale === "boolean" &&
    Array.isArray(value.aircraft) && value.aircraft.every(item => isRecord(item) &&
      hasOnlyKeys(item, ["icao24", "callsign", "originCountry", "latitude", "longitude",
        "lastPositionAt", "lastContactAt", "barometricAltitudeMeters",
        "geometricAltitudeMeters", "groundSpeedMetersPerSecond", "trueTrackDegrees",
        "verticalRateMetersPerSecond", "onGround", "squawk", "positionSource", "category"]) &&
      typeof item.icao24 === "string" && /^[0-9a-f]{6}$/.test(item.icao24) &&
      isOptionalNullable(item.callsign, isString) &&
      isOptionalNullable(item.originCountry, isString) &&
      isFiniteNumber(item.latitude) && item.latitude >= 17 && item.latitude <= 21 &&
      isFiniteNumber(item.longitude) && item.longitude >= -73 && item.longitude <= -67 &&
      isOptionalNullable(item.lastPositionAt, isDateTimeOffset) &&
      isOptionalNullable(item.lastContactAt, isDateTimeOffset) &&
      isOptionalNullable(item.barometricAltitudeMeters, isFiniteNumber) &&
      isOptionalNullable(item.geometricAltitudeMeters, isFiniteNumber) &&
      isOptionalNullable(item.groundSpeedMetersPerSecond, isFiniteNumber) &&
      isOptionalNullable(item.trueTrackDegrees, isFiniteNumber) &&
      isOptionalNullable(item.verticalRateMetersPerSecond, isFiniteNumber) &&
      typeof item.onGround === "boolean" &&
      isOptionalNullable(item.squawk, isString) &&
      isOptionalNullable(item.positionSource, isInt32) &&
      isOptionalNullable(item.category, isInt32));
}

const isManualAirline = (airline: unknown) =>
  isRecord(airline) && hasOnlyKeys(airline, ["id", "iataCode", "name"]) &&
  isUuid(airline.id) && isString(airline.iataCode) && isString(airline.name);

/** An active aircraft type a new flight can carry («type once», 2-A). */
const isManualAircraftType = (type: unknown) =>
  isRecord(type) && hasOnlyKeys(type, ["id", "icaoCode", "iataCode", "manufacturer", "model", "sizeCategory"]) &&
  isUuid(type.id) && isNonEmptyString(type.icaoCode) && isOptionalNullable(type.iataCode, isNonEmptyString) &&
  isNonEmptyString(type.manufacturer) && isNonEmptyString(type.model) &&
  (type.sizeCategory === undefined || type.sizeCategory === null || type.sizeCategory === "Narrowbody" ||
    type.sizeCategory === "Widebody");

function isManualTurnaroundOptionsResponse(
  value: unknown,
): value is ManualTurnaroundOptionsResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["station", "date", "stationAirport", "airlines", "airports", "stands", "charterAirlines",
      "aircraftTypes"]) &&
    (value.aircraftTypes === undefined || value.aircraftTypes === null ||
      (Array.isArray(value.aircraftTypes) && value.aircraftTypes.every(isManualAircraftType))) &&
    isOccStationResponse(value.station) && isDateOnly(value.date) &&
    isOccAirportResponse(value.stationAirport) &&
    Array.isArray(value.airlines) && value.airlines.every(isManualAirline) &&
    // Carriers without a contract that day, enterable only as charters (ADR-0033).
    (value.charterAirlines === undefined || value.charterAirlines === null ||
      (Array.isArray(value.charterAirlines) && value.charterAirlines.every(isManualAirline))) &&
    Array.isArray(value.airports) && value.airports.every(isOccAirportResponse) &&
    Array.isArray(value.stands) && value.stands.every(isOccStandResponse);
}

function isManualTurnaroundResponse(value: unknown): value is ManualTurnaroundResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["turnaroundId", "operationCode", "replayed"]) &&
    isUuid(value.turnaroundId) && isNonEmptyString(value.operationCode) &&
    typeof value.replayed === "boolean";
}

function isProgramOccShiftResponse(value: unknown): value is ProgramOccShiftResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["turnaroundId", "shiftId", "replayed"]) &&
    isUuid(value.turnaroundId) && isUuid(value.shiftId) &&
    typeof value.replayed === "boolean";
}

function isOccContractOptionResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "code",
      "version",
      "validFrom",
      "validTo",
      "currencyCode",
    ]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isInt32(value.version) &&
    isDateOnly(value.validFrom) &&
    isOptionalNullable(value.validTo, isDateOnly) &&
    isString(value.currencyCode)
  );
}

function isOccServiceOptionResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "serviceDefinitionId",
      "code",
      "name",
      "billingUnit",
      "minimumQuantity",
      "unitPrice",
      "currencyCode",
    ]) &&
    isUuid(value.id) &&
    isUuid(value.serviceDefinitionId) &&
    isString(value.code) &&
    isString(value.name) &&
    isString(value.billingUnit) &&
    isFiniteNumber(value.minimumQuantity) &&
    isFiniteNumber(value.unitPrice) &&
    isString(value.currencyCode)
  );
}

function isOccAgentOptionResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "displayName",
      "employeeNumber",
      "eligible",
      "eligibilityReasons",
    ]) &&
    isUuid(value.id) &&
    isString(value.displayName) &&
    isString(value.employeeNumber) &&
    typeof value.eligible === "boolean" &&
    Array.isArray(value.eligibilityReasons) &&
    value.eligibilityReasons.every(isString)
  );
}

/** A local clock the API answers (HH:mm:ss). */
const LOCAL_CLOCK = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
/** A local clock a shift adjustment sends: whole minutes, as the server requires (3-E). */
const LOCAL_MINUTE = /^([01]\d|2[0-3]):[0-5]\d:00$/;
/** The statuses OCC hands an operation over in (3-F). */
const HANDOVER_STATUSES: readonly string[] = ["InProgress", "Returned"];

/**
 * «Relevar agente» (3-F): the route's operation in progress or returned, the agent and assignment that work it now,
 * the window left (it ends after it starts) and the agents evaluated for it; the current agent is never offered.
 */
function isOccHandoverOptions(value: unknown, turnaroundId: string): value is OccHandoverOptionsResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["turnaroundId", "operationId", "operationStatus", "currentAssignmentId",
      "currentAgentId", "currentAgentName", "remainingFrom", "remainingUntil", "agents"]) ||
      !isUuid(value.turnaroundId) || value.turnaroundId.toLowerCase() !== turnaroundId || !isUuid(value.operationId) ||
      !isString(value.operationStatus) || !HANDOVER_STATUSES.includes(value.operationStatus) ||
      !isUuid(value.currentAssignmentId) || !isUuid(value.currentAgentId) || !isNonEmptyString(value.currentAgentName) ||
      !isDateTimeOffset(value.remainingFrom) || !isDateTimeOffset(value.remainingUntil) ||
      Date.parse(value.remainingUntil) <= Date.parse(value.remainingFrom) ||
      !Array.isArray(value.agents) || value.agents.length > 1000 || !value.agents.every(isOccAgentOptionResponse))
    return false;
  const current = value.currentAgentId.toLowerCase();
  return value.agents.every(agent => String((agent as { id: string }).id).toLowerCase() !== current);
}

/** The handed-over operation (3-F): the route's turnaround and the new assignment of the agent OCC chose. */
function isOccOperationHandover(value: unknown, turnaroundId: string, agentId: string):
  value is OccOperationHandoverResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["turnaroundId", "assignmentId", "agentId", "previousAgentId", "replayed"]) &&
    isUuid(value.turnaroundId) && value.turnaroundId.toLowerCase() === turnaroundId && isUuid(value.assignmentId) &&
    isUuid(value.agentId) && value.agentId.toLowerCase() === agentId && isUuid(value.previousAgentId) &&
    value.previousAgentId.toLowerCase() !== agentId && typeof value.replayed === "boolean";
}

/** The route agent's shift of the flight's day (3-E), with the version «Ajustar turno» sends back. */
function isOccAgentShift(value: unknown, agentId: string): value is OccAgentShiftResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["shiftId", "agentId", "workDate", "startsAtLocal", "endsAtLocal", "terminalCode", "version"]) &&
    isUuid(value.shiftId) && isUuid(value.agentId) && value.agentId.toLowerCase() === agentId &&
    isDateOnly(value.workDate) && isString(value.startsAtLocal) && LOCAL_CLOCK.test(value.startsAtLocal) &&
    isString(value.endsAtLocal) && LOCAL_CLOCK.test(value.endsAtLocal) && isNonEmptyString(value.terminalCode) &&
    isRecordVersion(value.version);
}

/** The route's adjusted shift (3-E) with its new version. */
function isHumanResourcesShiftAdjusted(value: unknown, shiftId: string): value is HumanResourcesShiftAdjusted {
  return isRecord(value) && hasOnlyKeys(value, ["id", "startsAtLocal", "endsAtLocal", "version"]) &&
    isUuid(value.id) && value.id.toLowerCase() === shiftId && isString(value.startsAtLocal) &&
    LOCAL_CLOCK.test(value.startsAtLocal) && isString(value.endsAtLocal) && LOCAL_CLOCK.test(value.endsAtLocal) &&
    isRecordVersion(value.version);
}

/** A reason the audit keeps: trimmed, from 5 to 500 characters. */
function validatedAgentReason(reason: unknown) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length < 5 || trimmed.length > 500) throw new TypeError("reason must have 5 to 500 characters.");
  return trimmed;
}

/** «Relevar agente» (3-F): the agent, the assignment OCC saw and the reason. */
function validatedHandoverCommand(command: HandOverOccOperationCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["agentId", "expectedAssignmentId", "reason"]))
    throw new TypeError("The handover is invalid.");
  return { agentId: validatedUuid(command.agentId, "agentId"),
    expectedAssignmentId: validatedUuid(command.expectedAssignmentId, "expectedAssignmentId"),
    reason: validatedAgentReason(command.reason) };
}

/** «Ajustar horario» (3-E): distinct whole-minute local times at most 16 hours apart, the reason and the version. */
function validatedShiftAdjustment(command: AdjustHumanResourcesShiftCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["startsAtLocal", "endsAtLocal", "reason", "expectedVersion"]) ||
      !isString(command.startsAtLocal) || !isString(command.endsAtLocal) || !LOCAL_MINUTE.test(command.startsAtLocal) ||
      !LOCAL_MINUTE.test(command.endsAtLocal) || command.startsAtLocal === command.endsAtLocal ||
      !isRecordVersion(command.expectedVersion))
    throw new TypeError("The shift adjustment needs distinct local HH:mm:00 times and the shift's version.");
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const start = minutes(command.startsAtLocal);
  const end = minutes(command.endsAtLocal);
  if ((end > start ? end - start : end + 1440 - start) > 16 * 60)
    throw new TypeError("A shift cannot exceed sixteen hours.");
  return { startsAtLocal: command.startsAtLocal, endsAtLocal: command.endsAtLocal,
    reason: validatedAgentReason(command.reason), expectedVersion: command.expectedVersion };
}

function isOccPlanningTurnaroundContextResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "operationCode",
      "operationDate",
      "station",
      "stand",
      "referenceTime",
    ]) &&
    isUuid(value.id) &&
    isString(value.operationCode) &&
    isDateOnly(value.operationDate) &&
    isOccStationResponse(value.station) &&
    isOptionalNullable(value.stand, isOccStandResponse) &&
    isDateTimeOffset(value.referenceTime)
  );
}

function isOccPlanningOptionsResponse(
  value: unknown,
): value is OccPlanningOptionsResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["turnaround", "contract", "services", "agents", "isCharter"]) &&
    (value.isCharter === undefined || typeof value.isCharter === "boolean") &&
    isOccPlanningTurnaroundContextResponse(value.turnaround) &&
    isOptionalNullable(value.contract, isOccContractOptionResponse) &&
    Array.isArray(value.services) &&
    value.services.every(isOccServiceOptionResponse) &&
    Array.isArray(value.agents) &&
    value.agents.every(isOccAgentOptionResponse)
  );
}

function isOccAssignmentResponse(value: unknown): value is OccAssignmentResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["turnaroundId", "operation", "assignment", "services"]) &&
    isUuid(value.turnaroundId) &&
    isOccGroundOperationResponse(value.operation) &&
    isOccAssignedAgentResponse(value.assignment) &&
    Array.isArray(value.services) &&
    value.services.every(isOccOperationServiceResponse)
  );
}

function isRampOperationalPositionResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "code", "name"]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.name)
  );
}

function isRampAgentAssignmentResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "agentId",
      "position",
      "assignmentRole",
      "assignedAt",
    ]) &&
    isUuid(value.id) &&
    isUuid(value.agentId) &&
    isOptionalNullable(value.position, isRampOperationalPositionResponse) &&
    isString(value.assignmentRole) &&
    isDateTimeOffset(value.assignedAt)
  );
}

function isRampTurnaroundResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "operationCode",
      "operationDate",
      "status",
      "station",
      "airline",
      "aircraft",
      "stand",
      "arrival",
      "departure",
    ]) &&
    isUuid(value.id) &&
    isString(value.operationCode) &&
    isDateOnly(value.operationDate) &&
    isString(value.status) &&
    isOccStationResponse(value.station) &&
    isOccAirlineResponse(value.airline) &&
    isOptionalNullable(value.aircraft, isOccAircraftResponse) &&
    isOptionalNullable(value.stand, isOccStandResponse) &&
    isOptionalNullable(value.arrival, isOccFlightLegResponse) &&
    isOptionalNullable(value.departure, isOccFlightLegResponse)
  );
}

const isPassengerCount = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 999;
const isMtow = (value: unknown) => Number.isInteger(value) && (value as number) >= 1_000 && (value as number) <= 700_000;
const isMilestoneList = (value: unknown) => Array.isArray(value) && value.length <= 50 && value.every(item =>
  isRecord(item) && hasOnlyKeys(item, ["code", "actualAt"]) && isFlightReportMilestoneCode(item.code) &&
  isDateTimeOffset(item.actualAt));

function isRampExecutionResponse(value: unknown, operationId: string): value is RampExecutionResponse {
  return isRecord(value) && hasOnlyKeys(value, ["receiptId", "operationId", "milestones", "passengersIn", "passengersOut",
      "mtowKg", "aircraftRegistration"]) &&
    isUuid(value.receiptId) && isUuid(value.operationId) && value.operationId.toLowerCase() === operationId &&
    isMilestoneList(value.milestones) && isOptionalNullable(value.passengersIn, isPassengerCount) &&
    isOptionalNullable(value.passengersOut, isPassengerCount) && isOptionalNullable(value.mtowKg, isMtow) &&
    isOptionalNullable(value.aircraftRegistration, isNonEmptyString);
}

function isRampAssignedOperationResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["assignment", "operation", "turnaround", "services", "review", "milestones"]) &&
    (value.milestones === undefined || isMilestoneList(value.milestones)) &&
    isRampAgentAssignmentResponse(value.assignment) &&
    isOccGroundOperationResponse(value.operation) &&
    isRampTurnaroundResponse(value.turnaround) &&
    Array.isArray(value.services) &&
    value.services.every(isOccOperationServiceResponse) &&
    isOptionalNullable(value.review, (review) =>
      isRecord(review) &&
      hasOnlyKeys(review, ["submissionId", "revisionNumber", "status", "returnReason"]) &&
      isUuid(review.submissionId) &&
      isInt32(review.revisionNumber) && review.revisionNumber > 0 &&
      isOneOf(review.status, ["PendingReview", "InReview", "Approved", "Returned"] as const) &&
      isOptionalNullable(review.returnReason, (reason) =>
        typeof reason === "string" && reason.length >= 8 && reason.length <= 2000) &&
      (review.status !== "Returned" || typeof review.returnReason === "string"))
  );
}

function isRampAssignedOperationsResponse(
  value: unknown,
): value is RampAssignedOperationsResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["operations"]) &&
    Array.isArray(value.operations) &&
    value.operations.every(isRampAssignedOperationResponse)
  );
}

function isRegisterMobileDeviceResponse(
  value: unknown,
): value is RegisterMobileDeviceResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["installationId", "platform", "appVersion", "lastSeenAt"]) &&
    isUuid(value.installationId) &&
    (value.platform === "Android" || value.platform === "Ios") &&
    isNonEmptyString(value.appVersion) &&
    isDateTimeOffset(value.lastSeenAt)
  );
}

function isRampOperationStartResponse(
  value: unknown,
): value is RampOperationStartResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "operation"]) &&
    isUuid(value.receiptId) &&
    isOccGroundOperationResponse(value.operation) &&
    value.operation.status === "InProgress" &&
    isDateTimeOffset(value.operation.actualStartAt) &&
    value.operation.actualEndAt === null
  );
}

const rampChecklistStatuses = ["NotStarted", "InProgress", "Submitted"] as const;
const rampIncidentTypes = ["Operational", "Safety", "Equipment", "Documentation", "Deviation"] as const;
const rampIncidentSeverities = ["Low", "Medium", "High", "Critical"] as const;
const rampIncidentStatuses = ["Open", "InReview", "Resolved", "Closed"] as const;
const rampChecklistAnswerValues = ["Ok", "NotApplicable", "NotOk"] as const;
const rampServiceTargetStatuses = [
  "InProgress",
  "Completed",
  "NotPerformed",
  "Exception",
] as const;
const maximumExecutedQuantityExclusive = 100_000_000_000_000;
/** A walk-around photo is at most 6 MiB, the limit the server takes on upload (OperationDocumentRules.MaxPhotoBytes). */
const MAXIMUM_DAMAGE_PHOTO_BYTES = 6 * 1024 * 1024;

function isOneOf<const TValue extends readonly string[]>(
  value: unknown,
  values: TValue,
): value is TValue[number] {
  return typeof value === "string" && values.includes(value);
}

function isRampChecklistAnswerResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["value", "note", "answeredAt"]) &&
    isOneOf(value.value, rampChecklistAnswerValues) &&
    isOptionalNullable(value.note, isString) &&
    isDateTimeOffset(value.answeredAt)
  );
}

function isRampChecklistItemResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "code",
      "label",
      "sortOrder",
      "isRequired",
      "requiresNoteWhenNotOk",
      "answer",
    ]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.label) &&
    isInt32(value.sortOrder) &&
    value.sortOrder >= 0 &&
    typeof value.isRequired === "boolean" &&
    typeof value.requiresNoteWhenNotOk === "boolean" &&
    isOptionalNullable(value.answer, isRampChecklistAnswerResponse)
  );
}

function isRampChecklistResponse(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "status",
      "startedAt",
      "submittedAt",
      "template",
      "sections",
    ]) ||
    !isUuid(value.id) ||
    !isOneOf(value.status, rampChecklistStatuses) ||
    !isOptionalNullable(value.startedAt, isDateTimeOffset) ||
    !isOptionalNullable(value.submittedAt, isDateTimeOffset) ||
    !isRecord(value.template) ||
    !hasOnlyKeys(value.template, ["code", "name", "version"]) ||
    !isString(value.template.code) ||
    !isString(value.template.name) ||
    !isInt32(value.template.version) ||
    value.template.version < 1 ||
    !Array.isArray(value.sections)
  ) {
    return false;
  }

  if (
    value.status === "Submitted" &&
    (!isDateTimeOffset(value.startedAt) || !isDateTimeOffset(value.submittedAt))
  ) {
    return false;
  }

  const itemIds = new Set<string>();
  for (const section of value.sections) {
    if (
      !isRecord(section) ||
      !hasOnlyKeys(section, ["name", "items"]) ||
      !isString(section.name) ||
      !Array.isArray(section.items) ||
      !section.items.every(isRampChecklistItemResponse)
    ) {
      return false;
    }

    for (const item of section.items) {
      const itemId = (item as Record<string, unknown>).id as string;
      if (itemIds.has(itemId.toLowerCase())) return false;
      itemIds.add(itemId.toLowerCase());
    }
  }

  return true;
}

function isGetRampOperationChecklistResponse(
  value: unknown,
  operationId: string,
): value is GetRampOperationChecklistResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["operationId", "checklist"]) &&
    isUuid(value.operationId) &&
    value.operationId.toLowerCase() === operationId &&
    isRampChecklistResponse(value.checklist)
  );
}

function isRampChecklistSubmissionResponse(
  value: unknown,
  checklistId: string,
  answerCount: number,
): value is RampChecklistSubmissionResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "checklist"]) &&
    isUuid(value.receiptId) &&
    isRecord(value.checklist) &&
    hasOnlyKeys(value.checklist, [
      "id",
      "status",
      "startedAt",
      "submittedAt",
      "answerCount",
    ]) &&
    isUuid(value.checklist.id) &&
    value.checklist.id.toLowerCase() === checklistId &&
    value.checklist.status === "Submitted" &&
    isDateTimeOffset(value.checklist.startedAt) &&
    isDateTimeOffset(value.checklist.submittedAt) &&
    isInt32(value.checklist.answerCount) &&
    value.checklist.answerCount === answerCount
  );
}

function isRampOperationServiceTransitionResponse(
  value: unknown,
  serviceId: string,
  targetStatus: string,
): value is RampOperationServiceTransitionResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "service"]) &&
    isUuid(value.receiptId) &&
    isRecord(value.service) &&
    hasOnlyKeys(value.service, [
      "id",
      "status",
      "contractedQuantity",
      "executedQuantity",
      "billingUnit",
    ]) &&
    isUuid(value.service.id) &&
    value.service.id.toLowerCase() === serviceId &&
    value.service.status === targetStatus &&
    isFiniteNumber(value.service.contractedQuantity) &&
    value.service.contractedQuantity >= 0 &&
    isFiniteNumber(value.service.executedQuantity) &&
    value.service.executedQuantity >= 0 &&
    isString(value.service.billingUnit)
  );
}

function isRampChargeName(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function isRampServiceChargesResponse(value: unknown): value is RampServiceChargesResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["serviceId", "canEdit", "available", "applied"]) &&
    isUuid(value.serviceId) &&
    typeof value.canEdit === "boolean" &&
    Array.isArray(value.available) &&
    value.available.length <= 200 &&
    value.available.every(option =>
      isRecord(option) &&
      hasOnlyKeys(option, ["id", "code", "name", "description", "category", "allowMultiple"]) &&
      isUuid(option.id) &&
      isRampChargeName(option.code, 32) &&
      isRampChargeName(option.name, 120) &&
      (option.description === undefined || option.description === null ||
        (typeof option.description === "string" && option.description.length <= 500)) &&
      isRampChargeName(option.category, 32) &&
      typeof option.allowMultiple === "boolean") &&
    Array.isArray(value.applied) &&
    value.applied.length <= 200 &&
    value.applied.every(applied =>
      isRecord(applied) &&
      hasOnlyKeys(applied, ["id", "chargeId", "code", "name", "appliedAt", "source"]) &&
      (applied.source === undefined || isOneOf(applied.source, CHARGE_MARK_SOURCES)) &&
      isUuid(applied.id) &&
      isUuid(applied.chargeId) &&
      isRampChargeName(applied.code, 32) &&
      isRampChargeName(applied.name, 120) &&
      isDateTimeOffset(applied.appliedAt))
  );
}

function isRampOperationChargesResponse(
  value: unknown,
  operationId: string,
): value is RampOperationChargesResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["operationId", "services"]) &&
    isUuid(value.operationId) &&
    value.operationId.toLowerCase() === operationId &&
    Array.isArray(value.services) &&
    value.services.length <= 100 &&
    value.services.every(isRampServiceChargesResponse)
  );
}

function isRampServiceChargeCommandResponse(
  value: unknown,
  serviceId: string,
): value is RampServiceChargeCommandResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "service"]) &&
    isUuid(value.receiptId) &&
    isRampServiceChargesResponse(value.service) &&
    value.service.serviceId.toLowerCase() === serviceId
  );
}

function isRampIncidentResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id", "incidentType", "severity", "status", "description", "occurredAt", "reportedAt", "delayCode",
    ]) &&
    isOptionalNullable(value.delayCode, isIataDelayCode) &&
    isUuid(value.id) &&
    typeof value.incidentType === "string" &&
    value.incidentType.length > 0 &&
    value.incidentType.length <= 80 &&
    isOneOf(value.severity, rampIncidentSeverities) &&
    isOneOf(value.status, rampIncidentStatuses) &&
    typeof value.description === "string" &&
    value.description.length > 0 &&
    value.description.length <= 4_000 &&
    isDateTimeOffset(value.occurredAt) &&
    isDateTimeOffset(value.reportedAt)
  );
}

function isGetRampIncidentsResponse(
  value: unknown,
  operationId: string,
): value is GetRampIncidentsResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["operationId", "incidents"]) ||
    !isUuid(value.operationId) ||
    value.operationId.toLowerCase() !== operationId ||
    !Array.isArray(value.incidents) ||
    !value.incidents.every(isRampIncidentResponse)
  ) return false;
  const ids = value.incidents.map(item => item.id.toLowerCase());
  return new Set(ids).size === ids.length;
}

function isAttendanceContribution(
  value: unknown,
): value is AttendanceDraftContributionResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "revision", "authorAccountId", "recordedAt",
    "observedStartAt", "observedEndAt", "incidentNote",
  ]) || !["revision", "authorAccountId", "recordedAt",
    "observedStartAt", "observedEndAt", "incidentNote"]
    .every(key => Object.hasOwn(value, key))) return false;
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
    !isUuid(value.authorAccountId) || !isDateTimeOffset(value.recordedAt) ||
    (value.observedStartAt !== null && !isDateTimeOffset(value.observedStartAt)) ||
    (value.observedEndAt !== null && !isDateTimeOffset(value.observedEndAt)) ||
    (value.incidentNote !== null &&
      (typeof value.incidentNote !== "string" ||
        value.incidentNote.trim() !== value.incidentNote ||
        value.incidentNote.length < 1 || value.incidentNote.length > 2_000))) return false;
  return (value.observedStartAt !== null || value.observedEndAt !== null ||
      value.incidentNote !== null) &&
    (value.observedStartAt === null || value.observedEndAt === null ||
      Date.parse(value.observedEndAt as string) >= Date.parse(value.observedStartAt as string));
}

function isAttendanceSnapshot(
  value: unknown, operationId: string, assignmentId: string,
): value is AttendanceDraftSnapshotResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["operationId", "assignmentId", "stationId", "occ", "rampAgent"]) &&
    ["operationId", "assignmentId", "stationId", "occ", "rampAgent"]
      .every(key => Object.hasOwn(value, key)) &&
    isUuid(value.operationId) && value.operationId.toLowerCase() === operationId &&
    isUuid(value.assignmentId) && value.assignmentId.toLowerCase() === assignmentId &&
    isUuid(value.stationId) &&
    (value.occ === null || isAttendanceContribution(value.occ)) &&
    (value.rampAgent === null || isAttendanceContribution(value.rampAgent));
}

/** An operation hands its agents over, it does not pile them up: more assignments than this is not an answer (3-F). */
const MAX_OCC_ATTENDANCE_ASSIGNMENTS = 100;

/** An assignment whose attendance OCC records (3-F): open (`releasedAt` null) or released after it was assigned. */
function isOccAttendanceAssignment(value: unknown) {
  return isRecord(value) &&
    hasOnlyKeys(value, ["assignmentId", "agentId", "displayName", "employeeNumber", "assignedAt", "releasedAt"]) &&
    isUuid(value.assignmentId) && isUuid(value.agentId) && isNonEmptyString(value.displayName) &&
    isString(value.employeeNumber) && isDateTimeOffset(value.assignedAt) &&
    (value.releasedAt === null ||
      isDateTimeOffset(value.releasedAt) && Date.parse(value.releasedAt) >= Date.parse(value.assignedAt));
}

/** The route turnaround's assignments whose attendance OCC records (3-F), each one once. */
function isOccAttendanceAssignments(value: unknown, turnaroundId: string): value is OccAttendanceAssignmentsResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["turnaroundId", "operationId", "assignments"]) ||
      !isUuid(value.turnaroundId) || value.turnaroundId.toLowerCase() !== turnaroundId || !isUuid(value.operationId) ||
      !Array.isArray(value.assignments) || value.assignments.length > MAX_OCC_ATTENDANCE_ASSIGNMENTS ||
      !value.assignments.every(isOccAttendanceAssignment))
    return false;
  const ids = value.assignments.map(item => String((item as { assignmentId: string }).assignmentId).toLowerCase());
  return new Set(ids).size === ids.length;
}

function isAttendanceWriteResult(
  value: unknown, request: SaveAttendanceDraftRequest,
): value is AttendanceDraftWriteResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["contribution", "replayed"]) &&
    isAttendanceContribution(value.contribution) &&
    value.contribution.revision === request.expectedRevision + 1 &&
    (request.observedStartAt == null
      ? value.contribution.observedStartAt === null
      : value.contribution.observedStartAt !== null &&
        Date.parse(value.contribution.observedStartAt as string) ===
          Date.parse(request.observedStartAt)) &&
    (request.observedEndAt == null
      ? value.contribution.observedEndAt === null
      : value.contribution.observedEndAt !== null &&
        Date.parse(value.contribution.observedEndAt as string) ===
          Date.parse(request.observedEndAt)) &&
    value.contribution.incidentNote === (request.incidentNote?.trim() || null) &&
    typeof value.replayed === "boolean";
}

function isAttendanceValidationDecision(
  value: unknown, assignmentId: string,
): value is AttendanceValidationDecisionResponse {
  return isRecord(value) && hasOnlyKeys(value, [
    "id", "assignmentId", "occRevision", "rampAgentRevision",
    "startSource", "endSource", "startAt", "endAt", "reason",
    "validatedByAccountId", "validatedAt",
  ]) &&
    isUuid(value.id) && value.assignmentId === assignmentId &&
    isInt32(value.occRevision) && value.occRevision > 0 &&
    isInt32(value.rampAgentRevision) && value.rampAgentRevision > 0 &&
    ["Occ", "RampAgent"].includes(value.startSource as string) &&
    ["Occ", "RampAgent"].includes(value.endSource as string) &&
    isDateTimeOffset(value.startAt) && isDateTimeOffset(value.endAt) &&
    Date.parse(value.endAt) >= Date.parse(value.startAt) &&
    (value.reason == null || (typeof value.reason === "string" &&
      value.reason.trim() === value.reason && value.reason.length > 0 &&
      value.reason.length <= 1_000)) &&
    isUuid(value.validatedByAccountId) && isDateTimeOffset(value.validatedAt);
}

function isHumanResourcesAttendanceRow(
  value: unknown, stationId: string, from: string, to: string,
): value is HumanResourcesAttendanceRowResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "operationId", "assignmentId", "stationId", "operationDate",
    "operationCode", "agentName", "occ", "rampAgent",
    "latestDecision", "isDecisionCurrent",
  ]) || !isUuid(value.operationId) || !isUuid(value.assignmentId) ||
    value.stationId !== stationId || !isDateOnly(value.operationDate) ||
    value.operationDate < from || value.operationDate > to ||
    !isNonEmptyString(value.operationCode) || !isNonEmptyString(value.agentName) ||
    (value.occ !== null && !isAttendanceContribution(value.occ)) ||
    (value.rampAgent !== null && !isAttendanceContribution(value.rampAgent)) ||
    (value.latestDecision !== null &&
      !isAttendanceValidationDecision(value.latestDecision, value.assignmentId)) ||
    typeof value.isDecisionCurrent !== "boolean") return false;
  if (!value.isDecisionCurrent) return true;
  return isRecord(value.latestDecision) && isRecord(value.occ) &&
    isRecord(value.rampAgent) &&
    value.latestDecision.occRevision === value.occ.revision &&
    value.latestDecision.rampAgentRevision === value.rampAgent.revision;
}

function isHumanResourcesAttendancePage(
  value: unknown, query: GetHumanResourcesAttendanceParams,
): value is HumanResourcesAttendancePageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "stationId", "from", "to", "page", "limit", "hasMore", "items",
  ]) || value.stationId !== query.stationId || value.from !== query.from ||
    value.to !== query.to || value.page !== (query.page ?? 1) ||
    value.limit !== (query.limit ?? 20) ||
    typeof value.hasMore !== "boolean" || !Array.isArray(value.items) ||
    value.items.length > value.limit ||
    (value.hasMore && value.items.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.items.every(item => {
    if (!isHumanResourcesAttendanceRow(item, query.stationId,
      query.from, query.to) || ids.has(item.assignmentId)) return false;
    ids.add(item.assignmentId);
    return true;
  });
}

function isAttendanceValidationWriteResult(
  value: unknown, assignmentId: string, request: ValidateAttendanceRequest,
): value is AttendanceValidationWriteResponse {
  return isRecord(value) && hasOnlyKeys(value, ["decision", "replayed"]) &&
    typeof value.replayed === "boolean" &&
    isAttendanceValidationDecision(value.decision, assignmentId) &&
    value.decision.occRevision === request.expectedOccRevision &&
    value.decision.rampAgentRevision === request.expectedRampAgentRevision &&
    value.decision.startSource === request.startSource &&
    value.decision.endSource === request.endSource &&
    value.decision.reason === (request.reason?.trim() || null);
}

function isRampIncidentReceiptResponse(
  value: unknown,
  operationId: string,
  idempotencyKey: string,
  occurredAt: string,
): value is RampIncidentReceiptResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "operationId", "incidentId", "status", "occurredAt", "reportedAt"]) &&
    isUuid(value.receiptId) &&
    isUuid(value.operationId) &&
    value.operationId.toLowerCase() === operationId &&
    isUuid(value.incidentId) &&
    value.incidentId.toLowerCase() === idempotencyKey &&
    isOneOf(value.status, rampIncidentStatuses) &&
    isDateTimeOffset(value.occurredAt) &&
    Date.parse(value.occurredAt) === Date.parse(occurredAt) &&
    isDateTimeOffset(value.reportedAt)
  );
}

function isRampOperationSubmissionResponse(
  value: unknown,
  operationId: string,
  idempotencyKey: string,
  agentNote: string | null,
): value is RampOperationSubmissionResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "receiptId", "operationId", "submissionId", "checklistId", "revisionNumber",
      "status", "submittedAt", "actualEndAt", "agentNote",
    ]) &&
    isUuid(value.receiptId) &&
    isUuid(value.operationId) &&
    value.operationId.toLowerCase() === operationId &&
    isUuid(value.submissionId) &&
    value.submissionId.toLowerCase() === idempotencyKey &&
    isUuid(value.checklistId) &&
    Number.isInteger(value.revisionNumber) &&
    (value.revisionNumber as number) > 0 &&
    isOneOf(value.status, ["PendingReview", "InReview", "Approved", "Returned"] as const) &&
    isDateTimeOffset(value.submittedAt) &&
    isDateTimeOffset(value.actualEndAt) &&
    (value.agentNote ?? null) === agentNote
  );
}

function isRampOperationCorrectionResponse(
  value: unknown, operationId: string, checklistId: string,
): value is RampOperationCorrectionResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "operationId", "previousSubmissionId",
      "checklistId", "revisionNumber", "status", "returnReason"]) &&
    isUuid(value.receiptId) && isUuid(value.operationId) &&
    value.operationId.toLowerCase() === operationId &&
    isUuid(value.previousSubmissionId) && isUuid(value.checklistId) &&
    value.checklistId.toLowerCase() === checklistId &&
    isInt32(value.revisionNumber) && value.revisionNumber > 1 &&
    value.status === "InProgress" &&
    typeof value.returnReason === "string" &&
    value.returnReason.length >= 8 && value.returnReason.length <= 2000;
}

const occReviewStatuses = ["PendingReview", "InReview", "Approved", "Returned"] as const;

function isOperationMessageResponse(value: unknown, operationId?: string): value is OperationMessageResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "operationId", "senderAccountId", "senderRole", "senderName", "content", "sentAt"]) &&
    isUuid(value.id) && isUuid(value.operationId) &&
    (operationId === undefined || value.operationId.toLowerCase() === operationId) &&
    isUuid(value.senderAccountId) &&
    isOneOf(value.senderRole, ["occ", "agent"] as const) &&
    isNonEmptyString(value.senderName) &&
    isNonEmptyString(value.content) && value.content.length <= 2_000 &&
    isDateTimeOffset(value.sentAt);
}

function isOperationConversationListResponse(value: unknown): value is OperationConversationListResponse {
  return isRecord(value) && hasOnlyKeys(value, ["conversations", "hasMore"]) &&
    typeof value.hasMore === "boolean" && Array.isArray(value.conversations) &&
    value.conversations.length <= 100 && value.conversations.every((item: unknown) =>
      isRecord(item) && hasOnlyKeys(item, ["operationId", "operationCode", "operationDate",
        "stationCode", "airlineName", "agentName", "status", "lastMessage", "unreadCount", "othersReadUpTo"]) &&
      isUuid(item.operationId) && isNonEmptyString(item.operationCode) &&
      isDateOnly(item.operationDate) && isNonEmptyString(item.stationCode) &&
      isNonEmptyString(item.airlineName) &&
      isOptionalNullable(item.agentName, isString) && isNonEmptyString(item.status) &&
      Number.isInteger(item.unreadCount) && (item.unreadCount as number) >= 0 &&
      isOptionalNullable(item.othersReadUpTo, isDateTimeOffset) &&
      isOptionalNullable(item.lastMessage, candidate =>
        isOperationMessageResponse(candidate, (item.operationId as string).toLowerCase())));
}

function isOperationMessageListResponse(value: unknown, operationId: string): value is OperationMessageListResponse {
  return isRecord(value) && hasOnlyKeys(value, ["operationId", "messages", "hasMore", "othersReadUpTo"]) &&
    isUuid(value.operationId) && value.operationId.toLowerCase() === operationId &&
    isOptionalNullable(value.othersReadUpTo, isDateTimeOffset) &&
    typeof value.hasMore === "boolean" && Array.isArray(value.messages) &&
    value.messages.length <= 200 && value.messages.every((item: unknown) =>
      isOperationMessageResponse(item, operationId));
}

function isOperationalNotificationResponse(value: unknown): value is OperationalNotificationResponse {
  return isRecord(value) && hasOnlyKeys(value, ["id", "operationId", "operationCode",
    "stationCode", "kind", "sourceId", "occurredAt", "readAt"]) &&
    isUuid(value.id) && isUuid(value.operationId) &&
    isNonEmptyString(value.operationCode) && isNonEmptyString(value.stationCode) &&
    isNonEmptyString(value.kind) && isUuid(value.sourceId) &&
    isDateTimeOffset(value.occurredAt) && isOptionalNullable(value.readAt, isDateTimeOffset);
}

const DEPARTMENT_NOTIFICATION_DEPARTMENTS = new Set(["HumanResources", "Contracts", "Operations", "Finance"]);

function isDepartmentNotificationResponse(value: unknown): value is DepartmentNotificationResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "department", "kind", "sourceId", "subject", "stationCode", "occurredAt", "readAt"]) &&
    isUuid(value.id) && typeof value.department === "string" && DEPARTMENT_NOTIFICATION_DEPARTMENTS.has(value.department) &&
    isNonEmptyString(value.kind) && isUuid(value.sourceId) &&
    isOptionalNullable(value.subject, isNonEmptyString) && isOptionalNullable(value.stationCode, isNonEmptyString) &&
    isDateTimeOffset(value.occurredAt) && isOptionalNullable(value.readAt, isDateTimeOffset);
}

function isDepartmentNotificationListResponse(value: unknown): value is DepartmentNotificationListResponse {
  return isRecord(value) && hasOnlyKeys(value, ["notifications", "unreadCount", "hasMore"]) &&
    typeof value.hasMore === "boolean" && Number.isInteger(value.unreadCount) && (value.unreadCount as number) >= 0 &&
    Array.isArray(value.notifications) && value.notifications.length <= 50 &&
    value.notifications.every(isDepartmentNotificationResponse);
}

const OCC_POSITION_STATUSES = new Set<string>(["available", "planned", "occupied"]);

function isOccPositionTurnaround(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["turnaroundId", "operationCode", "airlineName", "aircraftRegistration",
      "arrivalFlightNumber", "departureFlightNumber", "arrivalScheduledAt", "arrivedAt", "departureScheduledAt",
      "assignedFrom", "status"]) &&
    isUuid(value.turnaroundId) && isNonEmptyString(value.operationCode) && isNonEmptyString(value.airlineName) &&
    isOptionalNullable(value.aircraftRegistration, isNonEmptyString) && isOptionalNullable(value.arrivalFlightNumber, isNonEmptyString) &&
    isOptionalNullable(value.departureFlightNumber, isNonEmptyString) && isOptionalNullable(value.arrivalScheduledAt, isDateTimeOffset) &&
    isOptionalNullable(value.arrivedAt, isDateTimeOffset) && isOptionalNullable(value.departureScheduledAt, isDateTimeOffset) &&
    isOptionalNullable(value.assignedFrom, isDateTimeOffset) && isNonEmptyString(value.status);
}

function isOccPositionBoard(value: unknown, stationId?: string): value is OccPositionBoardResponse {
  return isRecord(value) && hasOnlyKeys(value, ["stationId", "stationCode", "operationDate", "asOf", "positions", "unassigned", "canAssign"]) &&
    isUuid(value.stationId) && (stationId === undefined || value.stationId.toLowerCase() === stationId) &&
    isNonEmptyString(value.stationCode) && isDateOnly(value.operationDate) && isDateTimeOffset(value.asOf) &&
    typeof value.canAssign === "boolean" && Array.isArray(value.unassigned) && value.unassigned.every(isOccPositionTurnaround) &&
    Array.isArray(value.positions) && value.positions.every(position => isRecord(position) &&
      hasOnlyKeys(position, ["standId", "code", "terminalCode", "standType", "status", "turnarounds", "latitude", "longitude",
        "hasBoardingBridge", "isRemote", "maxAircraftSize", "cancelledBy", "narrowbodyOnly", "coveredBy"]) &&
      typeof position.hasBoardingBridge === "boolean" && typeof position.isRemote === "boolean" &&
      (position.maxAircraftSize == null || AIRCRAFT_SIZES.has(position.maxAircraftSize as string)) &&
      isOptionalNullable(position.cancelledBy, isNonEmptyString) && typeof position.narrowbodyOnly === "boolean" &&
      isStringList(position.coveredBy) &&
      isOptionalNullable(position.latitude, isLatitude) && isOptionalNullable(position.longitude, isLongitude) &&
      (position.latitude == null) === (position.longitude == null) &&
      isUuid(position.standId) && isNonEmptyString(position.code) && isOptionalNullable(position.terminalCode, isNonEmptyString) &&
      isOptionalNullable(position.standType, isNonEmptyString) && typeof position.status === "string" &&
      OCC_POSITION_STATUSES.has(position.status) && Array.isArray(position.turnarounds) && position.turnarounds.every(isOccPositionTurnaround));
}

const AIRCRAFT_SIZES = new Set<string>(["Narrowbody", "Widebody"]);
const STAND_CONSTRAINT_KINDS = new Set<string>(["Cancels", "NarrowbodyOnly"]);
const isStringList = (value: unknown) => Array.isArray(value) && value.length <= 50 && value.every(isNonEmptyString);

function isOccCoverageBoard(value: unknown, stationId?: string): value is OccCoverageBoardResponse {
  return isRecord(value) && hasOnlyKeys(value, ["stationId", "stationCode", "date", "terminals", "stands", "constraints",
      "agents", "coverages", "canAssign", "canConfigure"]) &&
    isUuid(value.stationId) && (stationId === undefined || value.stationId.toLowerCase() === stationId) &&
    isNonEmptyString(value.stationCode) && isDateOnly(value.date) &&
    typeof value.canAssign === "boolean" && typeof value.canConfigure === "boolean" &&
    Array.isArray(value.terminals) && value.terminals.every(item => isRecord(item) &&
      hasOnlyKeys(item, ["terminalId", "code", "name", "maxStandsPerAgent", "requiresBridgeQualification"]) &&
      isUuid(item.terminalId) && isNonEmptyString(item.code) && isNonEmptyString(item.name) &&
      Number.isInteger(item.maxStandsPerAgent) && typeof item.requiresBridgeQualification === "boolean") &&
    Array.isArray(value.stands) && value.stands.every(item => isRecord(item) &&
      hasOnlyKeys(item, ["standId", "code", "terminalId", "isActive", "hasBoardingBridge", "isRemote", "maxAircraftSize", "coveredBy"]) &&
      isUuid(item.standId) && isNonEmptyString(item.code) && isOptionalNullable(item.terminalId, isUuid) &&
      typeof item.isActive === "boolean" && typeof item.hasBoardingBridge === "boolean" && typeof item.isRemote === "boolean" &&
      (item.maxAircraftSize == null || AIRCRAFT_SIZES.has(item.maxAircraftSize as string)) && isStringList(item.coveredBy)) &&
    Array.isArray(value.constraints) && value.constraints.every(item => isRecord(item) &&
      hasOnlyKeys(item, ["id", "standId", "standCode", "affectedStandId", "affectedStandCode", "kind"]) &&
      isUuid(item.id) && isUuid(item.standId) && isNonEmptyString(item.standCode) && isUuid(item.affectedStandId) &&
      isNonEmptyString(item.affectedStandCode) && STAND_CONSTRAINT_KINDS.has(item.kind as string)) &&
    Array.isArray(value.agents) && value.agents.every(item => isRecord(item) &&
      hasOnlyKeys(item, ["agentId", "name", "employeeNumber", "terminalId", "terminalCode", "shiftStartsAt", "shiftEndsAt",
        "isJunior", "hasAirportPermit", "hasDriverLicense", "hasBridgeQualification", "isAbsent"]) &&
      isUuid(item.agentId) && isNonEmptyString(item.name) && isNonEmptyString(item.employeeNumber) && isUuid(item.terminalId) &&
      isNonEmptyString(item.terminalCode) && isDateTimeOffset(item.shiftStartsAt) && isDateTimeOffset(item.shiftEndsAt) &&
      ["isJunior", "hasAirportPermit", "hasDriverLicense", "hasBridgeQualification", "isAbsent"]
        .every(key => typeof item[key] === "boolean")) &&
    Array.isArray(value.coverages) && value.coverages.every(item => isRecord(item) &&
      hasOnlyKeys(item, ["id", "agentId", "agentName", "terminalId", "terminalCode", "stands", "startsAt", "endsAt",
        "mentorAgentId", "mentorName", "vehicleCode", "isReinforcement"]) &&
      isUuid(item.id) && isUuid(item.agentId) && isNonEmptyString(item.agentName) && isUuid(item.terminalId) &&
      isNonEmptyString(item.terminalCode) && Array.isArray(item.stands) && item.stands.every(stand => isRecord(stand) &&
        hasOnlyKeys(stand, ["standId", "code"]) && isUuid(stand.standId) && isNonEmptyString(stand.code)) &&
      isDateTimeOffset(item.startsAt) && isDateTimeOffset(item.endsAt) && isOptionalNullable(item.mentorAgentId, isUuid) &&
      isOptionalNullable(item.mentorName, isNonEmptyString) && isOptionalNullable(item.vehicleCode, isNonEmptyString) &&
      typeof item.isReinforcement === "boolean");
}

function isOwnRampCoverage(value: unknown): value is RampOwnCoverageListResponse {
  return isRecord(value) && hasOnlyKeys(value, ["coverages"]) && Array.isArray(value.coverages) &&
    value.coverages.length <= 20 && value.coverages.every(item => isRecord(item) &&
      hasOnlyKeys(item, ["id", "stationCode", "terminalCode", "stands", "startsAt", "endsAt", "partner", "vehicleCode",
        "isReinforcement"]) &&
      isUuid(item.id) && isNonEmptyString(item.stationCode) && isNonEmptyString(item.terminalCode) && isStringList(item.stands) &&
      isDateTimeOffset(item.startsAt) && isDateTimeOffset(item.endsAt) && isOptionalNullable(item.partner, isNonEmptyString) &&
      isOptionalNullable(item.vehicleCode, isNonEmptyString) && typeof item.isReinforcement === "boolean");
}

function isLatitude(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -90 && value <= 90;
}

function isLongitude(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -180 && value <= 180;
}

function isOccReadyContracts(value: unknown, stationId: string, date: string): value is OccReadyContractsResponse {
  return isRecord(value) && hasOnlyKeys(value, ["stationId", "stationCode", "date", "contracts"]) &&
    isUuid(value.stationId) && value.stationId.toLowerCase() === stationId && isNonEmptyString(value.stationCode) &&
    value.date === date && Array.isArray(value.contracts) && value.contracts.every(contract => isRecord(contract) &&
      hasOnlyKeys(contract, ["contractId", "contractCode", "airlineId", "airlineName", "airlineIataCode", "versionId",
        "versionNumber", "validFrom", "validTo", "renewalMode", "services", "flightsOnDate"]) &&
      isUuid(contract.contractId) && isNonEmptyString(contract.contractCode) && isUuid(contract.airlineId) &&
      isNonEmptyString(contract.airlineName) && isOptionalNullable(contract.airlineIataCode, isNonEmptyString) &&
      isUuid(contract.versionId) && Number.isInteger(contract.versionNumber) && isDateOnly(contract.validFrom) &&
      isOptionalNullable(contract.validTo, isDateOnly) && isOptionalNullable(contract.renewalMode, isNonEmptyString) &&
      Number.isInteger(contract.flightsOnDate) && (contract.flightsOnDate as number) >= 0 &&
      Array.isArray(contract.services) && contract.services.every(service => isRecord(service) &&
        hasOnlyKeys(service, ["code", "name", "billingUnit"]) && isNonEmptyString(service.code) &&
        isNonEmptyString(service.name) && isNonEmptyString(service.billingUnit)));
}

const FLIGHT_PROPOSAL_STATUSES = new Set<string>(["Proposed", "Confirmed", "Dismissed"]);
const FLIGHT_FEED_REFRESH_STATUSES = new Set<string>(["Refreshed", "Reused", "Throttled", "BudgetExhausted", "Paused",
  "NotConfigured", "NoContracts", "Busy", "Failed"]);

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isOccFlightProposal(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["proposalId", "direction", "flightNumber", "airlineId", "airlineName",
    "airlineIataCode", "counterpartIata", "counterpartName", "counterpartKnown", "scheduledAt", "revisedAt", "runwayAt",
    "providerStatus", "aircraftRegistration", "aircraftModel", "terminal", "gate", "status", "turnaroundId",
    "suggestedDepartureId", "lastSeenAt", "version", "suggestedAircraftTypeId"]) &&
    isUuid(value.proposalId) && (value.direction === "Arrival" || value.direction === "Departure") &&
    isNonEmptyString(value.flightNumber) && isUuid(value.airlineId) && isNonEmptyString(value.airlineName) &&
    isOptionalNullable(value.airlineIataCode, isNonEmptyString) && isOptionalNullable(value.counterpartIata, isNonEmptyString) &&
    isOptionalNullable(value.counterpartName, isNonEmptyString) && typeof value.counterpartKnown === "boolean" &&
    isDateTimeOffset(value.scheduledAt) && isOptionalNullable(value.revisedAt, isDateTimeOffset) &&
    isOptionalNullable(value.runwayAt, isDateTimeOffset) && isNonEmptyString(value.providerStatus) &&
    isOptionalNullable(value.aircraftRegistration, isNonEmptyString) && isOptionalNullable(value.aircraftModel, isNonEmptyString) &&
    isOptionalNullable(value.terminal, isNonEmptyString) && isOptionalNullable(value.gate, isNonEmptyString) &&
    typeof value.status === "string" && FLIGHT_PROPOSAL_STATUSES.has(value.status) &&
    isOptionalNullable(value.turnaroundId, isUuid) && isOptionalNullable(value.suggestedDepartureId, isUuid) &&
    isDateTimeOffset(value.lastSeenAt) &&
    // The version of an import or a restore and the type the provider's model suggests (2-B, 2-N36).
    isNonEmptyString(value.version) && value.version.length <= 64 &&
    isOptionalNullable(value.suggestedAircraftTypeId, isUuid);
}

function isOccFlightFeed(value: unknown, stationId: string, date: string,
  view: OccFlightFeedView = "Contracted"): value is OccFlightFeedResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["stationId", "stationCode", "date", "budget", "lastReadAt",
      "nextManualRefreshAt", "canImport", "proposals"])) return false;
  const budget = value.budget;
  return isUuid(value.stationId) && value.stationId.toLowerCase() === stationId && isNonEmptyString(value.stationCode) &&
    value.date === date && isRecord(budget) && hasOnlyKeys(budget, ["configured", "provider", "unitsToday", "dailyUnits",
      "unitsThisMonth", "monthlyUnits", "pausedUntil", "pauseReason"]) &&
    typeof budget.configured === "boolean" && isNonEmptyString(budget.provider) && isNonNegativeInteger(budget.unitsToday) &&
    isNonNegativeInteger(budget.dailyUnits) && isNonNegativeInteger(budget.unitsThisMonth) &&
    isNonNegativeInteger(budget.monthlyUnits) && isOptionalNullable(budget.pausedUntil, isDateTimeOffset) &&
    isOptionalNullable(budget.pauseReason, isNonEmptyString) && isOptionalNullable(value.lastReadAt, isDateTimeOffset) &&
    isOptionalNullable(value.nextManualRefreshAt, isDateTimeOffset) && typeof value.canImport === "boolean" &&
    Array.isArray(value.proposals) && value.proposals.every(isOccFlightProposal) &&
    // The dismissed view lists only dismissed proposals, the others never one.
    value.proposals.every(proposal => ((proposal as { status: string }).status === "Dismissed") === (view === "Dismissed"));
}

function isRefreshOccFlightFeed(value: unknown): value is RefreshOccFlightFeedResponse {
  return isRecord(value) && hasOnlyKeys(value, ["status", "retryAt", "flightsReceived", "contractedLegs", "newProposals"]) &&
    typeof value.status === "string" && FLIGHT_FEED_REFRESH_STATUSES.has(value.status) &&
    isOptionalNullable(value.retryAt, isDateTimeOffset) && isOptionalNullable(value.flightsReceived, isNonNegativeInteger) &&
    isOptionalNullable(value.contractedLegs, isNonNegativeInteger) && isOptionalNullable(value.newProposals, isNonNegativeInteger);
}

const CONTRACT_PARTIES = new Set<string>(["Aviam", "Airline"]);

function validatedPermitInput(input: SubmitAirlinePermitInput): SubmitAirlinePermitInput {
  if (!isRecord(input) || !(AIRLINE_PERMIT_KINDS as readonly string[]).includes(input.kind) || !isNonEmptyString(input.number) || input.number.trim().length > 60 ||
      !isNonEmptyString(input.issuer) || input.issuer.trim().length > 120 || !isDateOnly(input.issuedOn) ||
      !isDateOnly(input.expiresOn) || input.expiresOn < input.issuedOn ||
      input.documentUrl != null && !/^\/api\/v1\/media\/[0-9a-f-]{36}$/i.test(input.documentUrl))
    throw new TypeError("Permit data is incomplete or inconsistent.");
  return { kind: input.kind, number: input.number.trim(), issuer: input.issuer.trim(), issuedOn: input.issuedOn,
    expiresOn: input.expiresOn, documentUrl: input.documentUrl ?? null };
}

function isContractDocument(value: unknown, versionId: string): value is ContractDocumentResponse {
  return isRecord(value) && hasOnlyKeys(value, ["contractId", "versionId", "contractCode", "contractStatus", "airlineName",
      "airlineCode", "airlineLegalName", "versionNumber", "versionStatus", "validFrom", "validTo", "currencyCode",
      "stations", "rates", "terms", "signedOn", "signatures", "contentSha256", "signableBy", "validity"]) &&
    isUuid(value.contractId) && isUuid(value.versionId) && value.versionId.toLowerCase() === versionId &&
    isNonEmptyString(value.contractCode) && isNonEmptyString(value.contractStatus) && isNonEmptyString(value.airlineName) &&
    typeof value.airlineCode === "string" && isOptionalNullable(value.airlineLegalName, isNonEmptyString) &&
    Number.isInteger(value.versionNumber) && isNonEmptyString(value.versionStatus) && isDateOnly(value.validFrom) &&
    isOptionalNullable(value.validTo, isDateOnly) && isNonEmptyString(value.currencyCode) &&
    Array.isArray(value.stations) && value.stations.every(isNonEmptyString) &&
    Array.isArray(value.rates) && value.rates.every(rate => isRecord(rate) &&
      hasOnlyKeys(rate, ["serviceCode", "serviceName", "billingUnit", "unitPrice", "minimumQuantity"]) &&
      isNonEmptyString(rate.serviceCode) && isNonEmptyString(rate.serviceName) && isNonEmptyString(rate.billingUnit) &&
      isFiniteNumber(rate.unitPrice) && isFiniteNumber(rate.minimumQuantity)) &&
    isOptionalNullable(value.terms, (text: unknown) => typeof text === "string") && isOptionalNullable(value.signedOn, isDateOnly) &&
    Array.isArray(value.signatures) && value.signatures.length <= 2 && value.signatures.every(signature => isRecord(signature) &&
      hasOnlyKeys(signature, ["party", "signerName", "signerTitle", "signedAt", "documentSha256", "hasDrawnSignature"]) &&
      typeof signature.hasDrawnSignature === "boolean" &&
      typeof signature.party === "string" && CONTRACT_PARTIES.has(signature.party) && isNonEmptyString(signature.signerName) &&
      isNonEmptyString(signature.signerTitle) && isDateTimeOffset(signature.signedAt) &&
      typeof signature.documentSha256 === "string" && /^[0-9a-f]{64}$/.test(signature.documentSha256)) &&
    typeof value.contentSha256 === "string" && /^[0-9a-f]{64}$/.test(value.contentSha256) &&
    isOptionalNullable(value.signableBy, (party: unknown) => typeof party === "string" && CONTRACT_PARTIES.has(party)) &&
    isOptionalNullable(value.validity, isContractValidity);
}

const RENEWAL_MODES = new Set<string>(["Manual", "Automatic"]);
const READINESS_STATUSES = new Set<string>(["Ok", "Expiring", "Missing", "Info"]);
const DOCUMENT_VALIDITIES = new Set<string>(["Current", "Expiring", "Expired"]);

function isRampAgentReadiness(value: unknown): value is RampAgentReadinessData {
  return isRecord(value) && hasOnlyKeys(value, ["rampProfileId", "agentName", "employeeNumber", "ready", "items"]) &&
    isUuid(value.rampProfileId) && typeof value.agentName === "string" && typeof value.employeeNumber === "string" &&
    typeof value.ready === "boolean" && Array.isArray(value.items) && value.items.every(item => isRecord(item) &&
      hasOnlyKeys(item, ["key", "status", "detail", "expiresOn"]) && isNonEmptyString(item.key) &&
      typeof item.status === "string" && READINESS_STATUSES.has(item.status) &&
      isOptionalNullable(item.detail, (text: unknown) => typeof text === "string") &&
      isOptionalNullable(item.expiresOn, isDateOnly));
}

function isRampAgentSchedule(value: unknown): value is RampAgentScheduleData {
  return isRecord(value) && hasOnlyKeys(value, ["rampProfileId", "agentName", "from", "to", "shifts", "documents"]) &&
    isUuid(value.rampProfileId) && typeof value.agentName === "string" && isDateOnly(value.from) && isDateOnly(value.to) &&
    Array.isArray(value.shifts) && value.shifts.every(shift => isRecord(shift) &&
      hasOnlyKeys(shift, ["id", "workDate", "startsAtLocal", "endsAtLocal", "block", "stationCode", "terminalCode"]) &&
      isUuid(shift.id) && isDateOnly(shift.workDate) && typeof shift.startsAtLocal === "string" &&
      typeof shift.endsAtLocal === "string" && typeof shift.block === "string" && typeof shift.stationCode === "string" &&
      typeof shift.terminalCode === "string") &&
    Array.isArray(value.documents) && value.documents.every(document => isRecord(document) &&
      hasOnlyKeys(document, ["kind", "label", "number", "expiresOn", "validity"]) && isNonEmptyString(document.kind) &&
      typeof document.label === "string" && isOptionalNullable(document.number, (text: unknown) => typeof text === "string") &&
      isDateOnly(document.expiresOn) && typeof document.validity === "string" && DOCUMENT_VALIDITIES.has(document.validity));
}

function isContractValidity(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["renewalMode", "renewalTermMonths", "renewalNoticeDays",
      "terminationNoticeDays", "terminationTerms", "confirmedAt"]) &&
    typeof value.renewalMode === "string" && RENEWAL_MODES.has(value.renewalMode) &&
    isOptionalNullable(value.renewalTermMonths, (months: unknown) => Number.isInteger(months)) &&
    Number.isInteger(value.renewalNoticeDays) && Number.isInteger(value.terminationNoticeDays) &&
    isOptionalNullable(value.terminationTerms, (text: unknown) => typeof text === "string") &&
    isDateTimeOffset(value.confirmedAt);
}

/** Largest drawn signature the API accepts (ADR-0025): a PNG of 256 KB at most. */
export const MAX_SIGNATURE_PNG_BYTES = 256 * 1024;

function validatedSignaturePng(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("The drawn signature is missing.");
  const base64 = value.replace(/^data:image\/png;base64,/i, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length < 32 || base64.length > Math.ceil(MAX_SIGNATURE_PNG_BYTES / 3) * 4 ||
      !base64.startsWith("iVBORw0KGgo"))
    throw new TypeError("The drawn signature must be a PNG of up to 256 KB.");
  return base64;
}

const OCC_REPORT_KEYS = new Set<string>(["operations", "turnaround-times", "services-by-airline", "reviews", "agent-productivity",
  "daily-close"]);
const OCC_REPORT_FORMATS = new Set<string>(["csv", "xlsx", "pdf"]);

function validatedOccReportQuery(key: OccReportKey, query: OccReportQuery): OccReportQuery {
  if (!OCC_REPORT_KEYS.has(key) || !isRecord(query) || !isDateOnly(query.from) || !isDateOnly(query.to) ||
      query.from > query.to ||
      (query.page !== undefined && (!Number.isInteger(query.page) || query.page < 1)) ||
      (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)))
    throw new TypeError("OCC report query is invalid.");
  return { stationId: validatedUuid(query.stationId, "stationId"), from: query.from, to: query.to,
    ...(query.page !== undefined && { page: query.page }), ...(query.limit !== undefined && { limit: query.limit }) };
}

function isOccReportCatalog(value: unknown): value is OccReportCatalogResponse {
  return isRecord(value) && hasOnlyKeys(value, ["reports", "maxRangeDays"]) &&
    Number.isInteger(value.maxRangeDays) && Array.isArray(value.reports) &&
    value.reports.every(report => isRecord(report) && hasOnlyKeys(report, ["key", "title", "description", "columns"]) &&
      typeof report.key === "string" && OCC_REPORT_KEYS.has(report.key) && isNonEmptyString(report.title) &&
      isNonEmptyString(report.description) && Array.isArray(report.columns) && report.columns.every(isNonEmptyString));
}

function isOccReportPage(value: unknown, key: OccReportKey, query: OccReportQuery): value is OccReportPageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["key", "title", "stationId", "stationCode", "from", "to", "asOf",
      "columns", "rows", "page", "limit", "hasMore"]) || value.key !== key || !isNonEmptyString(value.title) ||
      !isUuid(value.stationId) || value.stationId.toLowerCase() !== query.stationId.toLowerCase() ||
      !isNonEmptyString(value.stationCode) || value.from !== query.from || value.to !== query.to ||
      !isDateTimeOffset(value.asOf) || typeof value.hasMore !== "boolean" ||
      !Number.isInteger(value.page) || !Number.isInteger(value.limit) ||
      !Array.isArray(value.columns) || !value.columns.every(isNonEmptyString) || !Array.isArray(value.rows))
    return false;
  const width = value.columns.length;
  return value.rows.length <= (value.limit as number) && value.rows.every(row => Array.isArray(row) && row.length === width &&
    row.every(cell => isRecord(cell) && hasOnlyKeys(cell, ["value", "type"]) && typeof cell.value === "string" &&
      (cell.type === "text" || cell.type === "number")));
}

function isOperationalNotificationListResponse(value: unknown): value is OperationalNotificationListResponse {
  return isRecord(value) && hasOnlyKeys(value, ["notifications", "hasMore"]) &&
    typeof value.hasMore === "boolean" && Array.isArray(value.notifications) &&
    value.notifications.length <= 100 && value.notifications.every(isOperationalNotificationResponse);
}

function isOccReviewSubmissionHistoryResponse(
  value: unknown, operationId: string,
): value is OccReviewSubmissionHistoryResponse {
  if (!isRecord(value) ||
      !hasOnlyKeys(value, ["operationId", "submissions", "hasMore"]) ||
      !isUuid(value.operationId) || value.operationId.toLowerCase() !== operationId ||
      typeof value.hasMore !== "boolean" ||
      !Array.isArray(value.submissions) || value.submissions.length < 1 ||
      value.submissions.length > 100) return false;
  const revisions = new Set<number>();
  const ids = new Set<string>();
  return value.submissions.every((item: unknown) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ["submissionId", "revisionNumber",
      "status", "submittedAt", "outcome", "decidedAt"]) ||
      !isUuid(item.submissionId) || !isInt32(item.revisionNumber) ||
      item.revisionNumber < 1 || !isOneOf(item.status, occReviewStatuses) ||
      !isDateTimeOffset(item.submittedAt) ||
      !isOptionalNullable(item.outcome, outcome =>
        isOneOf(outcome, ["Approved", "Returned"] as const)) ||
      !isOptionalNullable(item.decidedAt, isDateTimeOffset)) return false;
    const id = item.submissionId.toLowerCase();
    if (revisions.has(item.revisionNumber) || ids.has(id)) return false;
    revisions.add(item.revisionNumber);
    ids.add(id);
    return true;
  });
}

function isOccReviewQueueResponse(value: unknown, stationId: string): value is OccReviewQueueResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["stationId", "stationCode", "stationName", "ianaTimeZone", "operations", "hasMore"]) &&
    isUuid(value.stationId) && value.stationId.toLowerCase() === stationId &&
    isNonEmptyString(value.stationCode) && isNonEmptyString(value.stationName) &&
    isNonEmptyString(value.ianaTimeZone) && typeof value.hasMore === "boolean" &&
    Array.isArray(value.operations) && value.operations.length <= 100 &&
    value.operations.every((item: unknown) => isRecord(item) &&
      hasOnlyKeys(item, ["operationId", "submissionId", "revisionNumber", "status",
        "operationCode", "operationDate", "airlineName", "agentName", "submittedAt",
        "serviceCount", "incidentCount"]) &&
      isUuid(item.operationId) && isUuid(item.submissionId) &&
      isInt32(item.revisionNumber) && item.revisionNumber > 0 &&
      isOneOf(item.status, occReviewStatuses) && isNonEmptyString(item.operationCode) &&
      isDateOnly(item.operationDate) && isNonEmptyString(item.airlineName) &&
      isNonEmptyString(item.agentName) && isDateTimeOffset(item.submittedAt) &&
      isInt32(item.serviceCount) && item.serviceCount >= 0 &&
      isInt32(item.incidentCount) && item.incidentCount >= 0);
}

function isOccReviewDetailResponse(
  value: unknown, operationId: string,
): value is OccReviewDetailResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["operationId", "submissionId", "revisionNumber", "status",
      "operationCode", "operationDate", "stationId", "stationCode", "ianaTimeZone",
      "airlineName", "agentName", "plannedStartAt", "plannedEndAt", "actualStartAt",
      "actualEndAt", "submittedAt", "agentNote", "checklistStatus", "checklistAnswers",
      "services", "incidents", "decision", "reviewVersion", "close", "serviceOrderState", "reopening"]) &&
    (value.close === undefined || value.close === null || isOccReviewClose(value.close)) &&
    // Phase 3, block D: the state of the Service Order (3-N02) and the approval a revision reopens (3-H); both may be
    // missing on servers before it.
    isOptionalNullable(value.serviceOrderState, (state) => isOneOf(state, SERVICE_ORDER_STATES)) &&
    isOptionalNullable(value.reopening, (reopening) => isRecord(reopening) &&
      hasOnlyKeys(reopening, ["fromRevisionNumber", "reason", "reopenedAt", "reopenedBy"]) &&
      isInt32(reopening.fromRevisionNumber) && reopening.fromRevisionNumber > 0 &&
      isNonEmptyString(reopening.reason) && reopening.reason.length <= 2000 &&
      isDateTimeOffset(reopening.reopenedAt) && isNonEmptyString(reopening.reopenedBy) &&
      reopening.reopenedBy.length <= 200) &&
    isUuid(value.operationId) && value.operationId.toLowerCase() === operationId &&
    isUuid(value.submissionId) && isInt32(value.revisionNumber) && value.revisionNumber > 0 &&
    isOneOf(value.status, occReviewStatuses) && isNonEmptyString(value.operationCode) &&
    isDateOnly(value.operationDate) && isUuid(value.stationId) &&
    isNonEmptyString(value.stationCode) && isNonEmptyString(value.ianaTimeZone) &&
    isNonEmptyString(value.airlineName) && isNonEmptyString(value.agentName) &&
    isOptionalNullable(value.plannedStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.plannedEndAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualEndAt, isDateTimeOffset) &&
    isDateTimeOffset(value.submittedAt) &&
    isOptionalNullable(value.agentNote, (note) => typeof note === "string" && note.length <= 2000) &&
    value.checklistStatus === "Submitted" &&
    Array.isArray(value.checklistAnswers) && value.checklistAnswers.every((answer: unknown) =>
      isRecord(answer) && hasOnlyKeys(answer, ["section", "code", "label", "value", "note"]) &&
      isNonEmptyString(answer.section) && isNonEmptyString(answer.code) &&
      isNonEmptyString(answer.label) && isOneOf(answer.value, ["Ok", "NotOk", "NotApplicable"] as const) &&
      isOptionalNullable(answer.note, (note) => typeof note === "string" && note.length <= 1000)) &&
    Array.isArray(value.services) && value.services.every((service: unknown) =>
      isRecord(service) && hasOnlyKeys(service, ["id", "code", "name", "status",
        "contractedQuantity", "executedQuantity", "unit"]) &&
      isUuid(service.id) && isNonEmptyString(service.code) && isNonEmptyString(service.name) &&
      isOneOf(service.status, ["Planned", "InProgress", "Completed", "NotPerformed", "Exception"] as const) &&
      isFiniteNumber(service.contractedQuantity) && isFiniteNumber(service.executedQuantity) &&
      isNonEmptyString(service.unit)) &&
    Array.isArray(value.incidents) && value.incidents.every((incident: unknown) =>
      isRecord(incident) && hasOnlyKeys(incident, ["id", "type", "severity", "status",
        "description", "occurredAt", "delayCode"]) && isUuid(incident.id) &&
      isOptionalNullable(incident.delayCode, (code) => typeof code === "string" && /^[0-9]{2}[A-Z]?$/.test(code)) &&
      isNonEmptyString(incident.type) &&
      isOneOf(incident.severity, ["Low", "Medium", "High", "Critical"] as const) &&
      isOneOf(incident.status, ["Open", "InReview", "Resolved", "Closed"] as const) &&
      isNonEmptyString(incident.description) && isDateTimeOffset(incident.occurredAt)) &&
    isOptionalNullable(value.decision, (decision) => isRecord(decision) &&
      hasOnlyKeys(decision, ["outcome", "reason", "decidedAt"]) &&
      isOneOf(decision.outcome, ["Approved", "Returned"] as const) &&
      isOptionalNullable(decision.reason, (reason) => typeof reason === "string" && reason.length <= 2000) &&
      isDateTimeOffset(decision.decidedAt)) &&
    isStrongEtag(value.reviewVersion);
}

function validatedOccReviewDecisionRequest(request: DecideOccReviewRequest): DecideOccReviewRequest {
  if (!isRecord(request) || !hasOnlyKeys(request, ["submissionId", "outcome", "reason"]) ||
      !isUuid(request.submissionId) ||
      !isOneOf(request.outcome, ["Approved", "Returned"] as const)) {
    throw new TypeError("OCC review decision is invalid.");
  }
  if (request.outcome === "Approved") {
    if (request.reason !== undefined && request.reason !== null && request.reason.trim()) {
      throw new TypeError("Approval cannot carry a correction reason.");
    }
    return { submissionId: request.submissionId.toLowerCase(), outcome: "Approved" };
  }
  if (typeof request.reason !== "string" || request.reason.trim().length < 8 ||
      request.reason.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request.reason)) {
    throw new TypeError("A correction reason is required.");
  }
  return { submissionId: request.submissionId.toLowerCase(),
    outcome: "Returned", reason: request.reason.trim() };
}

function isOccReviewDecisionResponse(
  value: unknown, operationId: string, request: DecideOccReviewRequest,
): value is DecideOccReviewResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["operationId", "submissionId", "status", "outcome", "decidedAt", "reason"]) &&
    isUuid(value.operationId) && value.operationId.toLowerCase() === operationId &&
    isUuid(value.submissionId) && value.submissionId.toLowerCase() === request.submissionId &&
    value.status === request.outcome && value.outcome === request.outcome &&
    isDateTimeOffset(value.decidedAt) &&
    (value.reason ?? null) === (request.reason ?? null);
}

function isSessionActorResponse(value: unknown): value is SessionActorResponse {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.accountId) ||
    !isNonEmptyString(value.email) ||
    !isNonEmptyString(value.displayName) ||
    !Array.isArray(value.roles) ||
    !Array.isArray(value.memberships) ||
    !Array.isArray(value.stationScopes)
  ) {
    return false;
  }

  return (
    value.roles.length > 0 &&
    value.memberships.length > 0 &&
    value.roles.every(
      (role) =>
        isRecord(role) &&
        isNonEmptyString(role.roleId) &&
        isNonEmptyString(role.code) &&
        isNonEmptyString(role.name) &&
        isNonEmptyString(role.userType) &&
        ["back_office", "ramp_mobile_app", "airline_portal"].includes(
          String(role.portal),
        ),
    ) &&
    value.memberships.every(
      (membership) =>
        isRecord(membership) &&
        isNonEmptyString(membership.membershipId) &&
        isNonEmptyString(membership.organizationId) &&
        isNonEmptyString(membership.organizationCode) &&
        isNonEmptyString(membership.organizationName) &&
        ["aviam_operator", "airline_customer"].includes(
          String(membership.organizationType),
        ) &&
        ["internal_staff", "airline_client"].includes(String(membership.kind)),
    ) &&
    value.stationScopes.every(
      (scope) =>
        isRecord(scope) &&
        isNonEmptyString(scope.stationId) &&
        isNonEmptyString(scope.stationCode),
    )
  );
}

function validatedRefreshToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value))
    throw new TypeError("refreshToken is invalid.");
  return value;
}

function isSessionResponse(value: unknown): value is SessionResponse {
  return (
    isRecord(value) &&
    isOptionalNullable(value.refreshToken, (token: unknown) => typeof token === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(token)) &&
    isOptionalNullable(value.refreshExpiresAt, isDateTimeOffset) &&
    isNonEmptyString(value.accessToken) &&
    value.tokenType === "Bearer" &&
    isNonEmptyString(value.expiresAt) &&
    !Number.isNaN(Date.parse(value.expiresAt)) &&
    isSessionActorResponse(value.actor)
  );
}

function isCurrentSessionResponse(value: unknown): value is CurrentSessionResponse {
  return isRecord(value) && isSessionActorResponse(value.actor);
}

function isAirlinePortalBootstrapResponse(
  value: unknown,
): value is AirlinePortalBootstrapResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["airlineId", "organizationId", "iataCode", "icaoCode", "name", "stations", "currentOperations"]) &&
    isUuid(value.airlineId) && isUuid(value.organizationId) &&
    // An operator without IATA designator sends an empty code; the ICAO code is always there (1-N17).
    isString(value.iataCode) && isNonEmptyString(value.icaoCode) &&
    isNonEmptyString(value.name) && Array.isArray(value.stations) &&
    value.stations.every((station) => isRecord(station) &&
      hasOnlyKeys(station, ["id", "code", "name", "ianaTimeZone"]) &&
      isUuid(station.id) && isNonEmptyString(station.code) &&
      isNonEmptyString(station.name) && isNonEmptyString(station.ianaTimeZone)) &&
    Array.isArray(value.currentOperations) &&
    value.currentOperations.length <= 50 &&
    value.currentOperations.every((operation) => isRecord(operation) &&
      hasOnlyKeys(operation, ["id", "code", "stationId", "stationCode", "operationDate",
        "status", "arrivalFlightNumber", "departureFlightNumber", "plannedStartAt", "plannedEndAt"]) &&
      isUuid(operation.id) && isNonEmptyString(operation.code) &&
      isUuid(operation.stationId) && isNonEmptyString(operation.stationCode) &&
      (value.stations as unknown[]).some((station) => isRecord(station) &&
        station.id === operation.stationId && station.code === operation.stationCode) &&
      isDateOnly(operation.operationDate) && isNonEmptyString(operation.status) &&
      isOptionalNullable(operation.arrivalFlightNumber, isNonEmptyString) &&
      isOptionalNullable(operation.departureFlightNumber, isNonEmptyString) &&
      isOptionalNullable(operation.plannedStartAt, isDateTimeOffset) &&
      isOptionalNullable(operation.plannedEndAt, isDateTimeOffset));
}

function isAirlineContractPageResponse(value: unknown): value is AirlineContractPageResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["page", "limit", "hasMore", "contracts"]) &&
    isInt32(value.page) && value.page >= 1 &&
    isInt32(value.limit) && value.limit >= 1 && value.limit <= 50 &&
    typeof value.hasMore === "boolean" &&
    Array.isArray(value.contracts) && value.contracts.length <= value.limit &&
    value.contracts.every((contract) => isRecord(contract) &&
      hasOnlyKeys(contract, ["id", "code", "status", "signedOn", "terminatedOn", "approvedVersions"]) &&
      isUuid(contract.id) && isNonEmptyString(contract.code) &&
      ["Draft", "Active", "Suspended", "Terminated", "Expired"].includes(String(contract.status)) &&
      isOptionalNullable(contract.signedOn, isDateOnly) &&
      isOptionalNullable(contract.terminatedOn, isDateOnly) &&
      Array.isArray(contract.approvedVersions) && contract.approvedVersions.length > 0 &&
      contract.approvedVersions.every((version) => isRecord(version) &&
        hasOnlyKeys(version, ["id", "versionNumber", "validFrom", "validTo", "currencyCode", "stations", "rates"]) &&
        isUuid(version.id) && isInt32(version.versionNumber) && version.versionNumber > 0 &&
        isDateOnly(version.validFrom) && isOptionalNullable(version.validTo, isDateOnly) &&
        typeof version.currencyCode === "string" && /^[A-Z]{3}$/.test(version.currencyCode) &&
        Array.isArray(version.stations) && version.stations.every((station) =>
          isRecord(station) && hasOnlyKeys(station, ["id", "code", "name"]) &&
          isUuid(station.id) && isNonEmptyString(station.code) && isNonEmptyString(station.name)) &&
        Array.isArray(version.rates) && version.rates.every((rate) =>
          isRecord(rate) && hasOnlyKeys(rate, ["id", "serviceCode", "serviceName", "billingUnit",
            "unitPrice", "minimumQuantity"]) &&
          isUuid(rate.id) && isNonEmptyString(rate.serviceCode) &&
          isNonEmptyString(rate.serviceName) && isNonEmptyString(rate.billingUnit) &&
          isFiniteNumber(rate.unitPrice) && rate.unitPrice >= 0 &&
          isFiniteNumber(rate.minimumQuantity) && rate.minimumQuantity >= 0)));
}

function isManagedContractPageData(value: unknown): value is ManagedContractPageData {
  return isRecord(value) && hasOnlyKeys(value, ["page", "limit", "hasMore", "contracts"]) &&
    isInt32(value.page) && value.page >= 1 &&
    isInt32(value.limit) && value.limit >= 1 && value.limit <= 50 &&
    typeof value.hasMore === "boolean" && Array.isArray(value.contracts) &&
    value.contracts.length <= value.limit &&
    (!value.hasMore || value.contracts.length === value.limit) &&
    value.contracts.every(contract => isRecord(contract) &&
      hasOnlyKeys(contract, ["id", "code", "airline", "airlineCode", "status",
        "signedOn", "terminatedOn", "approvedVersions"]) &&
      isUuid(contract.id) && isNonEmptyString(contract.code) &&
      isNonEmptyString(contract.airline) && isString(contract.airlineCode) &&
      ["Draft", "Active", "Suspended", "Terminated", "Expired"].includes(String(contract.status)) &&
      isOptionalNullable(contract.signedOn, isDateOnly) &&
      isOptionalNullable(contract.terminatedOn, isDateOnly) &&
      Array.isArray(contract.approvedVersions) && contract.approvedVersions.length > 0 &&
      contract.approvedVersions.every(version => isRecord(version) &&
        hasOnlyKeys(version, ["id", "versionNumber", "status", "validFrom", "validTo",
          "currencyCode", "terms", "stations", "rates"]) &&
        isUuid(version.id) && isInt32(version.versionNumber) && version.versionNumber > 0 &&
        ["Approved", "Superseded"].includes(String(version.status)) &&
        isDateOnly(version.validFrom) && isOptionalNullable(version.validTo, isDateOnly) &&
        typeof version.currencyCode === "string" && /^[A-Z]{3}$/.test(version.currencyCode) &&
        isOptionalNullable(version.terms, isString) &&
        Array.isArray(version.stations) && version.stations.every(station =>
          isRecord(station) && hasOnlyKeys(station, ["id", "code", "name"]) &&
          isUuid(station.id) && isNonEmptyString(station.code) && isNonEmptyString(station.name)) &&
        Array.isArray(version.rates) && version.rates.every(rate =>
          isRecord(rate) && hasOnlyKeys(rate, ["id", "serviceCode", "serviceName",
            "billingUnit", "unitPrice", "minimumQuantity"]) &&
          isUuid(rate.id) && isNonEmptyString(rate.serviceCode) &&
          isNonEmptyString(rate.serviceName) && isNonEmptyString(rate.billingUnit) &&
          isFiniteNumber(rate.unitPrice) && rate.unitPrice >= 0 &&
          isFiniteNumber(rate.minimumQuantity) && rate.minimumQuantity >= 0)));
}

function isAirlineOperationDetailResponse(value: unknown): value is AirlinePortalOperationResponse {
  return isRecord(value) && hasOnlyKeys(value,
    ["id", "code", "stationId", "stationCode", "operationDate", "status",
      "arrivalFlightNumber", "departureFlightNumber", "plannedStartAt", "plannedEndAt"]) &&
    isUuid(value.id) && isNonEmptyString(value.code) && isUuid(value.stationId) &&
    isNonEmptyString(value.stationCode) && isDateOnly(value.operationDate) &&
    ["Planned", "Assigned", "InProgress", "PendingReview", "InReview",
      "Approved", "Returned", "Cancelled"].includes(String(value.status)) &&
    isOptionalNullable(value.arrivalFlightNumber, isNonEmptyString) &&
    isOptionalNullable(value.departureFlightNumber, isNonEmptyString) &&
    isOptionalNullable(value.plannedStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.plannedEndAt, isDateTimeOffset);
}

function isAirlineApprovedOperationEvidenceResponse(
  value: unknown,
): value is AirlineApprovedOperationEvidenceResponse {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ["operationId", "available", "approvedAt", "actualStartAt", "actualEndAt",
      "incidentCount", "services"]) ||
    !isUuid(value.operationId) || typeof value.available !== "boolean" ||
    !isInt32(value.incidentCount) || value.incidentCount < 0 ||
    !Array.isArray(value.services) ||
    !value.services.every(service => isRecord(service) && hasOnlyKeys(service,
      ["id", "code", "name", "status", "contractedQuantity", "executedQuantity",
        "billingUnit"]) &&
      isUuid(service.id) && isNonEmptyString(service.code) &&
      isNonEmptyString(service.name) &&
      ["Completed", "NotPerformed", "Exception"].includes(String(service.status)) &&
      isFiniteNumber(service.contractedQuantity) && service.contractedQuantity >= 0 &&
      isFiniteNumber(service.executedQuantity) && service.executedQuantity >= 0 &&
      isNonEmptyString(service.billingUnit))) return false;
  if (value.available)
    return isDateTimeOffset(value.approvedAt) &&
      isOptionalNullable(value.actualStartAt, isDateTimeOffset) &&
      isOptionalNullable(value.actualEndAt, isDateTimeOffset);
  return (value.approvedAt == null && value.actualStartAt == null &&
    value.actualEndAt == null && value.incidentCount === 0 && value.services.length === 0);
}

function isAirlineOperationPageResponse(value: unknown): value is AirlineOperationPageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["page", "limit", "hasMore", "operations"]) ||
      !isInt32(value.page) || value.page < 1 || !isInt32(value.limit) ||
      value.limit < 1 || value.limit > 50 || typeof value.hasMore !== "boolean" ||
      !Array.isArray(value.operations) || value.operations.length > value.limit ||
      (value.hasMore && value.operations.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.operations.every((operation) => {
    if (!isAirlineOperationDetailResponse(operation) || ids.has(operation.id)) return false;
    ids.add(operation.id);
    return true;
  });
}

function isAirlineOperationalRequestPageResponse(
  value: unknown,
): value is AirlineOperationalRequestPageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["page", "limit", "hasMore", "requests"]) ||
      !isInt32(value.page) || value.page < 1 || !isInt32(value.limit) ||
      value.limit < 1 || value.limit > 50 || typeof value.hasMore !== "boolean" ||
      !Array.isArray(value.requests) || value.requests.length > value.limit ||
      (value.hasMore && value.requests.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.requests.every(request => {
    if (!isRecord(request) || !hasOnlyKeys(request,
      ["id", "stationId", "stationCode", "serviceName", "description", "status",
        "requestedAt", "neededAt", "operationId", "operationCode", "resolvedAt"]) ||
        !isUuid(request.id) || ids.has(request.id) ||
        !isUuid(request.stationId) || !isNonEmptyString(request.stationCode) ||
        !isNonEmptyString(request.serviceName) || typeof request.description !== "string" ||
        !["Submitted", "InReview", "Accepted", "Rejected", "Completed", "Cancelled"]
          .includes(String(request.status)) ||
        !isDateTimeOffset(request.requestedAt) ||
        !isOptionalNullable(request.neededAt, isDateTimeOffset) ||
        !isOptionalNullable(request.operationId, isUuid) ||
        !isOptionalNullable(request.operationCode, isNonEmptyString) ||
        !isOptionalNullable(request.resolvedAt, isDateTimeOffset) ||
        Boolean(request.operationId) !== Boolean(request.operationCode)) return false;
    ids.add(request.id);
    return true;
  });
}

function isAirlinePreinvoicePageResponse(
  value: unknown,
): value is AirlinePreinvoicePageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["page", "limit", "hasMore", "preinvoices"]) ||
      !isInt32(value.page) || value.page < 1 || !isInt32(value.limit) ||
      value.limit < 1 || value.limit > 50 || typeof value.hasMore !== "boolean" ||
      !Array.isArray(value.preinvoices) || value.preinvoices.length > value.limit ||
      (value.hasMore && value.preinvoices.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.preinvoices.every(item => {
    if (!isRecord(item) || !hasOnlyKeys(item,
      ["id", "stationId", "stationCode", "from", "to", "currencyCode", "total",
        "status", "createdAt"]) || !isUuid(item.id) || ids.has(item.id) ||
        !isUuid(item.stationId) || !isNonEmptyString(item.stationCode) ||
        !isDateOnly(item.from) || !isDateOnly(item.to) || item.from > item.to ||
        typeof item.currencyCode !== "string" || !/^[A-Z]{3}$/.test(item.currencyCode) ||
        !isFiniteNumber(item.total) || item.total < 0 ||
        !["Submitted", "Disputed", "Accepted", "Invoiced", "Voided"].includes(String(item.status)) ||
        !isDateTimeOffset(item.createdAt)) return false;
    ids.add(item.id);
    return true;
  });
}

function isAirlinePreinvoiceDetailResponse(value: unknown): value is AirlinePreinvoiceDetailResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "stationId", "stationCode",
      "from", "to", "currencyCode", "total", "status", "createdAt", "lines"]) ||
      !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 500)
    return false;
  const { lines, ...header } = value;
  if (!isAirlinePreinvoicePageResponse({ page: 1, limit: 1, hasMore: false,
    preinvoices: [header] })) return false;
  const periodFrom = String(value.from);
  const periodTo = String(value.to);
  const ids = new Set<string>();
  const validLines = lines.every(line => {
    if (!isRecord(line) || !hasOnlyKeys(line, ["id", "operationCode", "operationDate",
        "serviceCode", "serviceName", "executedQuantity", "billingUnit",
        "unitPrice", "amount", "kind", "parentLineId", "reason"])) return false;
    const kind = line.kind === undefined ? "Service" : String(line.kind);
    if (!PRICED_LINE_KINDS.includes(kind) || !isUuid(line.id) || ids.has(line.id) ||
        !isNonEmptyString(line.operationCode) || !isDateOnly(line.operationDate) ||
        line.operationDate < periodFrom || line.operationDate > periodTo ||
        !isNonEmptyString(line.serviceCode) || !isNonEmptyString(line.serviceName) ||
        !isNonEmptyString(line.billingUnit) || !isPricedLineAmounts(line, kind) ||
        !isOptionalNullable(line.parentLineId, isUuid) || (kind === "Charge" && !isUuid(line.parentLineId)) ||
        !isOptionalNullable(line.reason, isString)) return false;
    ids.add(line.id);
    return true;
  });
  return validLines;
}

function isPreinvoiceDisputes(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 50) return false;
  const disputeIds = new Set<string>();
  return value.every(dispute => {
    if (!isRecord(dispute) || !hasOnlyKeys(dispute,
        ["id", "subject", "description", "createdAt", "lineIds", "resolution"]) ||
        !isUuid(dispute.id) || disputeIds.has(dispute.id) ||
        !isNonEmptyString(dispute.subject) || dispute.subject.length > 160 ||
        !isNonEmptyString(dispute.description) || dispute.description.length > 1000 ||
        !isDateTimeOffset(dispute.createdAt) ||
        !Array.isArray(dispute.lineIds) || dispute.lineIds.length < 1 ||
        dispute.lineIds.length > 50 ||
        !isOptionalNullable(dispute.resolution, resolution =>
          isRecord(resolution) && hasOnlyKeys(resolution,
            ["id", "decision", "reason", "resolvedAt"]) &&
          isUuid(resolution.id) &&
          (resolution.decision === "Maintain" || resolution.decision === "Void") &&
          isNonEmptyString(resolution.reason) && resolution.reason.length <= 1000 &&
          isDateTimeOffset(resolution.resolvedAt))) return false;
    const selected = new Set<string>();
    for (const id of dispute.lineIds) {
      if (!isUuid(id) || selected.has(id)) return false;
      selected.add(id);
    }
    disputeIds.add(dispute.id);
    return true;
  });
}

function isPreinvoiceDisputeListResponse(value: unknown, preinvoiceId: string):
  value is PreinvoiceDisputeListResponse {
  return isRecord(value) && hasOnlyKeys(value, ["preinvoiceId", "disputes"]) &&
    value.preinvoiceId === preinvoiceId && isPreinvoiceDisputes(value.disputes);
}

function isResolvePreinvoiceDisputeResponse(value: unknown, preinvoiceId: string,
  decision: string): value is ResolvePreinvoiceDisputeResponse {
  return isRecord(value) && hasOnlyKeys(value,
    ["id", "preinvoiceId", "status", "replayed"]) &&
    isUuid(value.id) && value.preinvoiceId === preinvoiceId &&
    value.status === (decision === "Void" ? "Voided" : "Submitted") &&
    typeof value.replayed === "boolean";
}

function validatedIssueInvoiceFromOperationsRequest(
  request: IssueInvoiceFromOperationsRequest,
): IssueInvoiceFromOperationsRequest {
  if (!isRecord(request) || !hasOnlyKeys(request, ["stationId", "operationIds", "requestId"]) ||
      !isUuid(request.stationId) || !isUuid(request.requestId) || !Array.isArray(request.operationIds) ||
      request.operationIds.length < 1 || request.operationIds.length > 100 ||
      !request.operationIds.every(isUuid) ||
      new Set(request.operationIds.map((id) => id.toLowerCase())).size !== request.operationIds.length)
    throw new TypeError("Invoice issuance request is invalid.");
  return request;
}

const FISCAL_NUMBER = /^E31\d{10}$/;

const CARD_STATUSES = ["Approved", "Declined", "Error"];

/** ADR-0036: the attempt carries the brand and last four digits only; an approval has its receipt. */
function isCardPaymentAttempt(value: unknown, invoiceId: string): value is CardPaymentAttemptResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "invoiceId", "status", "brand", "last4", "amount",
      "currencyCode", "authorizationCode", "declineCode", "receiptId", "attemptedAt"]) ||
      !isUuid(value.id) || typeof value.invoiceId !== "string" || value.invoiceId.toLowerCase() !== invoiceId ||
      typeof value.status !== "string" || !CARD_STATUSES.includes(value.status) ||
      typeof value.brand !== "string" || value.brand.length < 1 || value.brand.length > 16 ||
      typeof value.last4 !== "string" || !/^\d{4}$/.test(value.last4) ||
      !isFiniteNumber(value.amount) || value.amount <= 0 ||
      (value.currencyCode !== "USD" && value.currencyCode !== "DOP") || !isDateTimeOffset(value.attemptedAt)) return false;
  return value.status === "Approved"
    ? typeof value.authorizationCode === "string" && isUuid(value.receiptId) &&
      (value.declineCode === null || value.declineCode === undefined)
    : typeof value.declineCode === "string" && (value.authorizationCode === null || value.authorizationCode === undefined) &&
      (value.receiptId === null || value.receiptId === undefined);
}

function isCardPaymentList(value: unknown, invoiceId: string): value is CardPaymentListResponse {
  return isRecord(value) && hasOnlyKeys(value, ["invoiceId", "attempts"]) && typeof value.invoiceId === "string" &&
    value.invoiceId.toLowerCase() === invoiceId && Array.isArray(value.attempts) && value.attempts.length <= 500 &&
    value.attempts.every(item => isCardPaymentAttempt(item, invoiceId));
}

function validatedCardBody(request: PayInvoiceByCardBody): PayInvoiceByCardBody {
  if (!isRecord(request) || !hasOnlyKeys(request, ["cardholderName", "cardNumber", "expiryMonth", "expiryYear",
      "securityCode", "amount"]) ||
      typeof request.cardholderName !== "string" || request.cardholderName.trim().length < 2 ||
      request.cardholderName.trim().length > 80 ||
      typeof request.cardNumber !== "string" || !/^[\d -]{12,23}$/.test(request.cardNumber) ||
      !Number.isInteger(request.expiryMonth) || request.expiryMonth < 1 || request.expiryMonth > 12 ||
      !Number.isInteger(request.expiryYear) || request.expiryYear < 2000 || request.expiryYear > 2099 ||
      typeof request.securityCode !== "string" || !/^\d{3,4}$/.test(request.securityCode) ||
      !isFiniteNumber(request.amount) || request.amount <= 0)
    throw new TypeError("Card payment request is invalid.");
  return { ...request, cardholderName: request.cardholderName.trim() };
}

function isIssuedInvoiceResponse(value: unknown): value is IssuedInvoiceResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["invoiceId", "number", "fiscalNumber", "total", "currencyCode", "replayed"]) &&
    isUuid(value.invoiceId) && value.number === `NF-${value.invoiceId.replaceAll("-", "")}` &&
    typeof value.fiscalNumber === "string" && FISCAL_NUMBER.test(value.fiscalNumber) &&
    isFiniteNumber(value.total) && value.total > 0 &&
    (value.currencyCode === "USD" || value.currencyCode === "DOP") && typeof value.replayed === "boolean";
}

function isIssueFinanceInvoiceResponse(value: unknown,
  request: IssueFinanceInvoiceRequest): value is IssueFinanceInvoiceResponse {
  return isRecord(value) && hasOnlyKeys(value,
    ["id", "preinvoiceId", "number", "kind", "replayed"]) &&
    isUuid(value.id) && value.preinvoiceId === request.preinvoiceId &&
    value.number === `NF-${value.id.replaceAll("-", "")}` &&
    value.kind === "NonFiscal" && typeof value.replayed === "boolean";
}

function isNonFiscalInvoiceResponse(value: unknown, preinvoiceId: string):
  value is NonFiscalInvoiceResponse {
  if (!isRecord(value) || !hasOnlyKeys(value,
      ["id", "preinvoiceId", "airlineId", "stationId", "number", "kind",
        "currencyCode", "total", "issuedAt", "lines"]) ||
      !isUuid(value.id) || value.preinvoiceId !== preinvoiceId ||
      !isUuid(value.airlineId) || !isUuid(value.stationId) ||
      value.number !== `NF-${value.id.replaceAll("-", "")}` ||
      value.kind !== "NonFiscal" ||
      typeof value.currencyCode !== "string" || !/^[A-Z]{3}$/.test(value.currencyCode) ||
      !isFiniteNumber(value.total) || value.total < 0 ||
      !isDateTimeOffset(value.issuedAt) || !Array.isArray(value.lines) ||
      value.lines.length < 1 || value.lines.length > 500) return false;
  const ids = new Set<string>();
  let previousNumber = 0;
  for (let index = 0; index < value.lines.length; index++) {
    const line = value.lines[index];
    if (!isRecord(line) || !hasOnlyKeys(line,
        ["id", "lineNumber", "operationCode", "operationDate", "serviceCode",
          "serviceName", "executedQuantity", "billingUnit", "unitPrice", "amount", "kind", "parentLineNumber",
          "reason"])) return false;
    const kind = line.kind === undefined ? "Service" : String(line.kind);
    if (!PRICED_LINE_KINDS.includes(kind) || !isUuid(line.id) || ids.has(line.id) ||
        !isInt32(line.lineNumber) || line.lineNumber <= previousNumber ||
        !isNonEmptyString(line.operationCode) || !isDateOnly(line.operationDate) ||
        !isNonEmptyString(line.serviceCode) || !isNonEmptyString(line.serviceName) ||
        !isNonEmptyString(line.billingUnit) || !isPricedLineAmounts(line, kind) ||
        !isOptionalNullable(line.parentLineNumber, isInt32) || !isOptionalNullable(line.reason, isString))
      return false;
    previousNumber = line.lineNumber;
    ids.add(line.id);
  }
  // SQL validates decimal(19,4) snapshots at issuance. Re-adding parsed JSON
  // numbers here can reject a valid large invoice due to IEEE-754 rounding.
  return true;
}

function isPaymentReference(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/.test(value);
}

function isRecordNonFiscalPaymentResponse(value: unknown,
  request: RecordNonFiscalPaymentRequest): value is RecordNonFiscalPaymentResponse {
  return isRecord(value) && hasOnlyKeys(value,
    ["id", "invoiceId", "reference", "currencyCode", "amount", "replayed"]) &&
    isUuid(value.id) && value.invoiceId === request.invoiceId &&
    value.reference === request.reference &&
    typeof value.currencyCode === "string" && /^[A-Z]{3}$/.test(value.currencyCode) &&
    isFiniteNumber(value.amount) && value.amount >= 0 &&
    typeof value.replayed === "boolean";
}

function isNonFiscalPaymentLookupResponse(value: unknown, invoiceId: string):
  value is NonFiscalPaymentLookupResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["invoiceId", "payment"]) ||
      value.invoiceId !== invoiceId) return false;
  if (value.payment === null || value.payment === undefined) return true;
  const payment = value.payment;
  return isRecord(payment) && hasOnlyKeys(payment,
    ["id", "invoiceId", "reference", "currencyCode", "amount", "recordedAt"]) &&
    isUuid(payment.id) && payment.invoiceId === invoiceId &&
    isPaymentReference(payment.reference) &&
    typeof payment.currencyCode === "string" && /^[A-Z]{3}$/.test(payment.currencyCode) &&
    isFiniteNumber(payment.amount) && payment.amount >= 0 &&
    isDateTimeOffset(payment.recordedAt);
}

function isAcceptAirlinePreinvoiceResponse(value: unknown): value is AcceptAirlinePreinvoiceResponse {
  return isRecord(value) && hasOnlyKeys(value, ["id", "status", "replayed"]) &&
    isUuid(value.id) && value.status === "Accepted" &&
    typeof value.replayed === "boolean";
}

function isDisputeAirlinePreinvoiceResponse(value: unknown): value is DisputeAirlinePreinvoiceResponse {
  return isRecord(value) && hasOnlyKeys(value, ["id", "disputeId", "status", "replayed"]) &&
    isUuid(value.id) && isUuid(value.disputeId) && value.status === "Disputed" &&
    typeof value.replayed === "boolean";
}

function isPublicCommercialCatalog(value: unknown): value is PublicCommercialCatalog {
  if (!isRecord(value) || !hasOnlyKeys(value, ["services", "airlines"]) ||
      !Array.isArray(value.services) || !Array.isArray(value.airlines)) return false;
  const services = value.services.every((item: unknown) => isRecord(item) &&
    hasOnlyKeys(item, ["id", "name", "description", "imageUrl", "videoUrl", "displayOrder"]) &&
    isUuid(item.id) && isNonEmptyString(item.name) && isString(item.description) &&
    isOptionalNullable(item.imageUrl, isString) &&
    isOptionalNullable(item.videoUrl, isString) && isInt32(item.displayOrder));
  const airlines = value.airlines.every((item: unknown) => isRecord(item) &&
    hasOnlyKeys(item, ["id", "name", "region", "legalName", "countryCode",
      "iataCode", "icaoCode", "logoUrl", "isVerified", "registrySource"]) &&
    isUuid(item.id) && isNonEmptyString(item.name) && isNonEmptyString(item.region) &&
    isOptionalNullable(item.legalName, isString) &&
    isOptionalNullable(item.countryCode, isString) &&
    isOptionalNullable(item.iataCode, isString) &&
    isOptionalNullable(item.icaoCode, isString) &&
    isOptionalNullable(item.logoUrl, isString) && typeof item.isVerified === "boolean" &&
    isOptionalNullable(item.registrySource, (source: unknown) => source === "Wikidata" || source === "OpenFlights"));
  return services && airlines &&
    new Set(value.services.map(item => item.id.toLowerCase())).size === value.services.length &&
    new Set(value.airlines.map(item => item.id.toLowerCase())).size === value.airlines.length;
}

function validatedCommercialRequest(
  request: SubmitCommercialRequestRequest,
): SubmitCommercialRequestRequest {
  if (!isRecord(request) || !hasOnlyKeys(request, ["requestId", "airlineProfileId",
    "serviceIds", "representativeName", "representativeTitle",
    "representativeEmail", "representativePhone", "authorityDeclared",
    "representativeNationalityCode", "representativeAddress", "representativeCountry",
    "representativeProvince", "representativeMunicipality",
    "representativeDocumentType", "representativeDocumentNumber", "representativeDistrict",
    "proposedAirline"]) ||
    !isUuid(request.requestId) ||
    // A catalog profile, or an airline proposed because it is not listed (1-N25); never both.
    (request.proposedAirline == null ? !isUuid(request.airlineProfileId)
      : request.airlineProfileId != null || !isProposedAirline(request.proposedAirline)) ||
    !Array.isArray(request.serviceIds) || request.serviceIds.length < 1 ||
    request.serviceIds.length > 20 || !request.serviceIds.every(isUuid) ||
    new Set(request.serviceIds.map(id => id.toLowerCase())).size !== request.serviceIds.length ||
    !isNonEmptyString(request.representativeName) || request.representativeName.length > 160 ||
    !isNonEmptyString(request.representativeTitle) || request.representativeTitle.length > 120 ||
    !isNonEmptyString(request.representativeEmail) || request.representativeEmail.length > 256 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.representativeEmail) ||
    !isNonEmptyString(request.representativePhone) || request.representativePhone.length > 32 ||
    normalizePhone(request.representativePhone) === null ||
    !isOptionalNullable(request.representativeNationalityCode,
      value => typeof value === "string" && /^[A-Z]{2}$/.test(value)) ||
    !isOptionalNullable(request.representativeAddress,
      value => typeof value === "string" && value.trim().length <= 250) ||
    !isOptionalNullable(request.representativeCountry,
      value => typeof value === "string" && value.trim().length <= 80) ||
    !isOptionalNullable(request.representativeProvince,
      value => typeof value === "string" && value.trim().length <= 80) ||
    !isOptionalNullable(request.representativeMunicipality,
      value => typeof value === "string" && value.trim().length <= 80) ||
    !isOptionalNullable(request.representativeDistrict,
      value => typeof value === "string" && value.trim().length <= 80) ||
    // The representative is identified by a cédula (Dominican) or a passport with its nationality.
    !(request.representativeDocumentType === "NationalId"
      ? (request.representativeNationalityCode == null || request.representativeNationalityCode === "DO") &&
        typeof request.representativeDocumentNumber === "string" &&
        normalizeIdentityDocument("Cedula", request.representativeDocumentNumber) !== null
      : request.representativeDocumentType === "Passport" &&
        typeof request.representativeNationalityCode === "string" &&
        typeof request.representativeDocumentNumber === "string" &&
        normalizeIdentityDocument("Passport", request.representativeDocumentNumber,
          request.representativeNationalityCode) !== null) ||
    request.authorityDeclared !== true)
    throw new TypeError("Commercial application is invalid.");
  return request as unknown as SubmitCommercialRequestRequest;
}

/** ICAO is required; IATA only when the airline has one; the website must be HTTPS. */
function isProposedAirline(value: unknown) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["name", "countryCode", "iataCode", "icaoCode", "websiteUrl"]) ||
      typeof value.name !== "string" || value.name.trim().length < 2 || value.name.trim().length > 160 ||
      typeof value.countryCode !== "string" || !/^[A-Z]{2}$/.test(value.countryCode) ||
      !isOptionalNullable(value.iataCode, code => typeof code === "string" && /^[A-Z0-9]{2}$/.test(code) &&
        !/^\d{2}$/.test(code)) ||
      typeof value.icaoCode !== "string" || !/^[A-Z]{3}$/.test(value.icaoCode))
    return false;
  if (value.websiteUrl == null) return true;
  if (typeof value.websiteUrl !== "string" || value.websiteUrl.length > 512) return false;
  try {
    const url = new URL(value.websiteUrl);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isCommercialRequestReceipt(value: unknown): value is SubmitCommercialRequestResponse {
  return isRecord(value) && hasOnlyKeys(value, ["reference", "replayed"]) &&
    isNonEmptyString(value.reference) && value.reference.length <= 128 &&
    typeof value.replayed === "boolean";
}

function validatedFinanceApprovedServicesQuery(
  query: FinanceApprovedServicesQuery,
): FinanceApprovedServicesQuery {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "from", "to"]) ||
      !isUuid(query.stationId) || !isDateOnly(query.from) || !isDateOnly(query.to) ||
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) /
        86_400_000 > 30 || query.to < query.from)
    throw new TypeError("Finance evidence station and date range are invalid.");
  return query as unknown as FinanceApprovedServicesQuery;
}

function validatedFinancePreinvoiceQuery(
  query: ListFinancePreinvoicesParams,
): ListFinancePreinvoicesParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "page", "limit"]) ||
      !isUuid(query.stationId) ||
      (query.page !== undefined && (!isInt32(query.page) || query.page < 1 || query.page > 10_000)) ||
      (query.limit !== undefined && (!isInt32(query.limit) || query.limit < 1 || query.limit > 50)))
    throw new TypeError("Finance preinvoice station or paging is invalid.");
  return { stationId: query.stationId,
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.limit === undefined ? {} : { limit: query.limit }) };
}

function validatedFinanceTariffQuery(
  query: ListFinanceTariffsParams,
): ListFinanceTariffsParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "page", "limit"]) ||
      !isUuid(query.stationId) ||
      (query.page !== undefined && (!isInt32(query.page) || query.page < 1 || query.page > 10_000)) ||
      (query.limit !== undefined && (!isInt32(query.limit) || query.limit < 1 || query.limit > 50)))
    throw new TypeError("Finance tariff station or paging is invalid.");
  return { stationId: query.stationId,
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.limit === undefined ? {} : { limit: query.limit }) };
}

function validatedHumanResourcesPaging(
  query: { page?: number; limit?: number } | undefined,
): { page?: number; limit?: number } {
  if (query === undefined) return {};
  if (!isRecord(query) || !hasOnlyKeys(query, ["page", "limit"]) ||
      (query.page !== undefined && (!isInt32(query.page) || query.page < 1 || query.page > 10_000)) ||
      (query.limit !== undefined && (!isInt32(query.limit) || query.limit < 1 || query.limit > 100)))
    throw new TypeError("Human Resources paging is invalid.");
  return { ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.limit === undefined ? {} : { limit: query.limit }) };
}

function validatedHumanResourcesQualificationQuery(
  query: ListHumanResourcesQualificationsParams | undefined,
): ListHumanResourcesQualificationsParams {
  if (query === undefined) return {};
  if (!isRecord(query) || !hasOnlyKeys(query,
    ["page", "limit", "rampProfileId", "equipmentTypeId", "search", "validity", "asOf"]) ||
      (query.rampProfileId !== undefined && !isUuid(query.rampProfileId)) ||
      (query.equipmentTypeId !== undefined && !isUuid(query.equipmentTypeId)) ||
      !isValidHumanResourcesDocumentFilter(query))
    throw new TypeError("Human Resources qualification filter is invalid.");
  const paging = validatedHumanResourcesPaging({
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  });
  return { ...paging,
    ...(query.rampProfileId === undefined ? {} : { rampProfileId: query.rampProfileId }),
    ...(query.equipmentTypeId === undefined ? {} : { equipmentTypeId: query.equipmentTypeId }),
    ...documentFilterParams(query) };
}

const HUMAN_RESOURCES_DOCUMENT_VALIDITIES = ["Upcoming", "Valid", "ExpiringSoon", "Expired"];

function isValidHumanResourcesDocumentFilter(
  query: { search?: unknown; validity?: unknown; asOf?: unknown },
): boolean {
  return (query.search === undefined ||
      (typeof query.search === "string" && query.search.trim().length <= 100)) &&
    (query.validity === undefined || (typeof query.validity === "string" &&
      HUMAN_RESOURCES_DOCUMENT_VALIDITIES.includes(query.validity))) &&
    (query.asOf === undefined || isDateOnly(query.asOf));
}

function documentFilterParams(
  query: { search?: string; validity?: string; asOf?: string },
): { search?: string; validity?: string; asOf?: string } {
  const search = query.search?.trim();
  return {
    ...(search ? { search } : {}),
    ...(query.validity === undefined ? {} : { validity: query.validity }),
    ...(query.asOf === undefined ? {} : { asOf: query.asOf }),
  };
}

function validatedHumanResourcesDocumentSummaryQuery<T extends {
  search?: string; asOf?: string; equipmentTypeId?: string; documentType?: string;
}>(query: T | undefined, key: "equipmentTypeId" | "documentType"): T {
  if (query === undefined) return {} as T;
  if (!isRecord(query) || !hasOnlyKeys(query, [key, "search", "asOf"]) ||
      !isValidHumanResourcesDocumentFilter(query) ||
      (key === "equipmentTypeId" && query.equipmentTypeId !== undefined &&
        !isUuid(query.equipmentTypeId)) ||
      (key === "documentType" && query.documentType !== undefined &&
        !["AirportId", "RampDriverLicense"].includes(query.documentType)))
    throw new TypeError("Human Resources document summary filter is invalid.");
  return { ...(query[key] === undefined ? {} : { [key]: query[key] }),
    ...documentFilterParams(query) } as T;
}

function isHumanResourcesDocumentSummary(
  value: unknown, asOf: string | undefined,
): value is HumanResourcesDocumentSummary {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ["asOf", "expiringSoonDays", "total", "valid", "expiringSoon", "expired", "upcoming"]) ||
      !isDateOnly(value.asOf) || (asOf !== undefined && value.asOf !== asOf) ||
      !isInt32(value.expiringSoonDays) || value.expiringSoonDays < 1) return false;
  const counts = [value.total, value.valid, value.expiringSoon, value.expired, value.upcoming];
  return counts.every(count => isInt32(count) && count >= 0) &&
    (value.total as number) === (value.valid as number) + (value.expiringSoon as number) +
      (value.expired as number) + (value.upcoming as number);
}

function isHumanResourcesDocumentCycles(
  cycles: unknown, keys: string[], valid: (item: Record<string, unknown>) => boolean,
): boolean {
  if (!Array.isArray(cycles) || cycles.length === 0) return false;
  const ids = new Set<string>();
  let previous = Number.MAX_SAFE_INTEGER;
  let currentCount = 0;
  const ok = cycles.every(item => {
    if (!isRecord(item) || !hasOnlyKeys(item, keys) || !isUuid(item.id) || ids.has(item.id) ||
        !isInt32(item.cycleNumber) || item.cycleNumber < 1 || item.cycleNumber >= previous ||
        typeof item.isCurrent !== "boolean" || !isDateTimeOffset(item.recordedAt) ||
        (item.recordedByName != null && !isNonEmptyString(item.recordedByName)) ||
        !valid(item)) return false;
    ids.add(item.id);
    previous = item.cycleNumber;
    if (item.isCurrent) currentCount += 1;
    return true;
  });
  return ok && currentCount <= 1;
}

function isHumanResourcesPermitPage(value: unknown): value is HumanResourcesPermitPage {
  if (!isRecord(value) || !hasOnlyKeys(value, ["page", "limit", "hasMore", "permits"]) ||
      !isInt32(value.page) || value.page < 1 ||
      !isInt32(value.limit) || value.limit < 1 || value.limit > 100 ||
      typeof value.hasMore !== "boolean" || !Array.isArray(value.permits) ||
      value.permits.length > value.limit ||
      (value.hasMore && value.permits.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.permits.every(item => {
    if (!isRecord(item) || !hasOnlyKeys(item,
      ["id", "rampProfileId", "agentName", "employeeNumber", "documentType",
        "cycleNumber", "documentNumber", "issuedOn", "expiresOn", "recordedAt", "validity"]) ||
        !isDateTimeOffset(item.recordedAt) || typeof item.validity !== "string" ||
        !HUMAN_RESOURCES_DOCUMENT_VALIDITIES.includes(item.validity) ||
        !isUuid(item.id) || ids.has(item.id) || !isUuid(item.rampProfileId) ||
        !isNonEmptyString(item.agentName) || !isNonEmptyString(item.employeeNumber) ||
        typeof item.documentType !== "string" ||
        !["AirportId", "RampDriverLicense"].includes(item.documentType) ||
        !isInt32(item.cycleNumber) || item.cycleNumber < 1 ||
        !isNonEmptyString(item.documentNumber) ||
        !isDateOnly(item.issuedOn) || !isDateOnly(item.expiresOn) ||
        item.issuedOn > item.expiresOn) return false;
    ids.add(item.id);
    return true;
  });
}

function validatedHumanResourcesPermitQuery(
  query: ListHumanResourcesPermitsParams | undefined,
): ListHumanResourcesPermitsParams {
  if (query === undefined) return {};
  if (!isRecord(query) || !hasOnlyKeys(query,
    ["page", "limit", "rampProfileId", "documentType", "search", "validity", "asOf"]) ||
      (query.rampProfileId !== undefined && !isUuid(query.rampProfileId)) ||
      (query.documentType !== undefined &&
        !["AirportId", "RampDriverLicense"].includes(query.documentType)) ||
      !isValidHumanResourcesDocumentFilter(query))
    throw new TypeError("Human Resources permit filter is invalid.");
  const paging = validatedHumanResourcesPaging({
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  });
  return { ...paging,
    ...(query.rampProfileId === undefined ? {} : { rampProfileId: query.rampProfileId }),
    ...(query.documentType === undefined ? {} : { documentType: query.documentType }),
    ...documentFilterParams(query) };
}

function validatedHumanResourcesShiftsQuery(query: HumanResourcesShiftsQuery): HumanResourcesShiftsQuery {
  if (!isRecord(query) || !hasOnlyKeys(query, ["from", "to", "page", "limit"]) ||
      !isDateOnly(query.from) || !isDateOnly(query.to) || query.from > query.to ||
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) /
        86_400_000 > 30 ||
      (query.page !== undefined && (!isInt32(query.page) || query.page < 1 || query.page > 10_000)) ||
      (query.limit !== undefined && (!isInt32(query.limit) || query.limit < 1 || query.limit > 100)))
    throw new TypeError("Human Resources shift range or paging is invalid.");
  return { from: query.from, to: query.to,
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.limit === undefined ? {} : { limit: query.limit }) };
}

function validatedHumanResourcesAvailabilityQuery(
  query: HumanResourcesAvailabilityQuery,
): HumanResourcesAvailabilityQuery {
  if (!isRecord(query) || !hasOnlyKeys(query, ["from", "to", "page", "limit"]) ||
      !isDateOnly(query.from) || !isDateOnly(query.to) || query.from > query.to ||
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) /
        86_400_000 > 30 ||
      (query.page !== undefined && (!isInt32(query.page) || query.page < 1 ||
        query.page > 10_000)) ||
      (query.limit !== undefined && (!isInt32(query.limit) || query.limit < 1 ||
        query.limit > 100)))
    throw new TypeError("Human Resources availability range or paging is invalid.");
  return { from: query.from, to: query.to,
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.limit === undefined ? {} : { limit: query.limit }) };
}

function validatedHumanResourcesShiftAssignmentQuery(
  query: HumanResourcesShiftAssignmentQuery,
): HumanResourcesShiftAssignmentQuery {
  if (!isRecord(query) || !hasOnlyKeys(query, ["rampProfileId", "workDate"]) ||
      !isUuid(query.rampProfileId) || !isDateOnly(query.workDate))
    throw new TypeError("Human Resources shift assignment query is invalid.");
  return { rampProfileId: query.rampProfileId, workDate: query.workDate };
}

function isHumanResourcesShiftAssignmentOptions(
  value: unknown, query: HumanResourcesShiftAssignmentQuery,
): value is HumanResourcesShiftAssignmentOptions {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ["rampProfileId", "workDate", "hasShift", "stations"]) ||
      !isUuid(value.rampProfileId) ||
      value.rampProfileId.toLowerCase() !== query.rampProfileId.toLowerCase() ||
      value.workDate !== query.workDate || typeof value.hasShift !== "boolean" ||
      !Array.isArray(value.stations)) return false;
  const stationIds = new Set<string>();
  const terminalIds = new Set<string>();
  return value.stations.every(station => {
    if (!isRecord(station) || !hasOnlyKeys(station, ["id", "code", "terminals"]) ||
        !isUuid(station.id) || !isNonEmptyString(station.code) ||
        stationIds.has(station.id.toLowerCase()) ||
        !Array.isArray(station.terminals) || station.terminals.length === 0) return false;
    stationIds.add(station.id.toLowerCase());
    return station.terminals.every(terminal => {
      if (!isRecord(terminal) || !hasOnlyKeys(terminal, ["id", "code"]) ||
          !isUuid(terminal.id) || !isNonEmptyString(terminal.code) ||
          terminalIds.has(terminal.id.toLowerCase())) return false;
      terminalIds.add(terminal.id.toLowerCase());
      return true;
    });
  });
}

function validatedHumanResourcesShiftInput(
  request: RecordHumanResourcesShiftInput,
): RecordHumanResourcesShiftInput {
  if (!isRecord(request) || !hasOnlyKeys(request,
      ["rampProfileId", "stationId", "terminalId", "workDate",
        "startsAtLocal", "endsAtLocal", "notes"]) ||
      !isUuid(request.rampProfileId) || !isUuid(request.stationId) ||
      !isUuid(request.terminalId) || !isDateOnly(request.workDate) ||
      typeof request.startsAtLocal !== "string" ||
      typeof request.endsAtLocal !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(request.startsAtLocal) ||
      !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(request.endsAtLocal) ||
      request.startsAtLocal === request.endsAtLocal ||
      (request.notes != null && (typeof request.notes !== "string" ||
        request.notes.trim().length > 500)))
    throw new TypeError("Human Resources shift input is invalid.");
  const toSeconds = (value: string) => {
    const [hour, minute, second] = value.split(":").map(Number);
    return hour! * 3600 + minute! * 60 + second!;
  };
  const start = toSeconds(request.startsAtLocal);
  const end = toSeconds(request.endsAtLocal);
  if ((end > start ? end - start : end + 86400 - start) > 16 * 3600)
    throw new TypeError("Human Resources shift cannot exceed sixteen hours.");
  return request;
}

function isHumanResourcesAvailabilityRequestPage(
  value: unknown,
): value is HumanResourcesAvailabilityRequestPage {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ["from", "to", "page", "limit", "hasMore", "requests"]) ||
      !isDateOnly(value.from) || !isDateOnly(value.to) || value.from > value.to ||
      !isInt32(value.page) || value.page < 1 ||
      !isInt32(value.limit) || value.limit < 1 || value.limit > 100 ||
      typeof value.hasMore !== "boolean" || !Array.isArray(value.requests) ||
      value.requests.length > value.limit ||
      (value.hasMore && value.requests.length !== value.limit)) return false;
  const ids = new Set<string>();
  const from = value.from;
  const to = value.to;
  return value.requests.every(item => {
    // `version` is the expected version of a decision or an amendment (2-N22).
    if (!isRecord(item) || !hasOnlyKeys(item,
      ["id", "rampProfileId", "agentName", "employeeNumber", "startsOn",
        "endsOn", "type", "status", "reason", "requestedAt", "resolvedAt",
        "resolutionNote", "version"]) || !isRecordVersion(item.version) ||
        !isUuid(item.id) || ids.has(item.id) || !isUuid(item.rampProfileId) ||
        !isNonEmptyString(item.agentName) || !isNonEmptyString(item.employeeNumber) ||
        !isDateOnly(item.startsOn) || !isDateOnly(item.endsOn) ||
        item.startsOn > item.endsOn || item.startsOn > to || item.endsOn < from ||
        typeof item.type !== "string" ||
        !["DayOff", "ShiftChange", "Restriction"].includes(item.type) ||
        typeof item.status !== "string" ||
        !["Pending", "Approved", "Rejected", "Cancelled"].includes(item.status) ||
        !isNonEmptyString(item.reason) || !isDateTimeOffset(item.requestedAt) ||
        !isOptionalNullable(item.resolvedAt, isDateTimeOffset) ||
        !isOptionalNullable(item.resolutionNote, isNonEmptyString)) return false;
    ids.add(item.id);
    return true;
  });
}

function validatedHumanResourcesAvailabilityInput(
  input: RecordHumanResourcesAvailabilityInput,
): RecordHumanResourcesAvailabilityInput {
  if (!isRecord(input) || !hasOnlyKeys(input,
      ["rampProfileId", "startsOn", "endsOn", "type", "reason"]) ||
      !isUuid(input.rampProfileId) || !isDateOnly(input.startsOn) ||
      !isDateOnly(input.endsOn) || input.startsOn > input.endsOn ||
      (Date.parse(`${input.endsOn}T00:00:00Z`) -
        Date.parse(`${input.startsOn}T00:00:00Z`)) / 86_400_000 > 30 ||
      !["DayOff", "ShiftChange", "Restriction"].includes(input.type) ||
      typeof input.reason !== "string" || !input.reason.trim() ||
      input.reason.trim().length > 1000)
    throw new TypeError("Human Resources availability input is invalid.");
  return { rampProfileId: input.rampProfileId, startsOn: input.startsOn,
    endsOn: input.endsOn, type: input.type, reason: input.reason.trim() };
}

function validatedHumanResourcesAvailabilityResolution(
  input: ResolveHumanResourcesAvailabilityInput,
): ResolveHumanResourcesAvailabilityInput {
  if (!isRecord(input) || !hasOnlyKeys(input, ["decision", "note", "expectedVersion"]) ||
      !["Approve", "Reject", "Cancel"].includes(input.decision) ||
      (input.note != null && (typeof input.note !== "string" ||
        input.note.trim().length > 1000)) ||
      (input.expectedVersion != null && !isRecordVersion(input.expectedVersion)))
    throw new TypeError("Human Resources availability resolution is invalid.");
  return { decision: input.decision,
    ...(input.note == null ? {} : { note: input.note.trim() || null }),
    ...(input.expectedVersion == null ? {} : { expectedVersion: input.expectedVersion }) };
}

function isHumanResourcesAvailabilityWritten(
  value: unknown, id: string,
  expectedStatuses: readonly string[],
): value is HumanResourcesAvailabilityWritten {
  return isRecord(value) && hasOnlyKeys(value, ["id", "status"]) &&
    isUuid(value.id) && value.id.toLowerCase() === id &&
    typeof value.status === "string" && expectedStatuses.includes(value.status);
}

function isHumanResourcesShiftPage(value: unknown): value is HumanResourcesShiftPage {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ["from", "to", "page", "limit", "hasMore", "shifts"]) ||
      !isDateOnly(value.from) || !isDateOnly(value.to) || value.from > value.to ||
      !isInt32(value.page) || value.page < 1 ||
      !isInt32(value.limit) || value.limit < 1 || value.limit > 100 ||
      typeof value.hasMore !== "boolean" || !Array.isArray(value.shifts) ||
      value.shifts.length > value.limit ||
      (value.hasMore && value.shifts.length !== value.limit)) return false;
  const ids = new Set<string>();
  const from = value.from;
  const to = value.to;
  return value.shifts.every(item => {
    // `version` is the expected version of the shift's removal (2-N11).
    if (!isRecord(item) || !hasOnlyKeys(item,
      ["id", "rampProfileId", "agentName", "employeeNumber", "stationId",
        "stationCode", "terminalId", "terminalCode", "positionId", "positionCode",
        "workDate", "startsAtLocal", "endsAtLocal", "block", "version"]) || !isRecordVersion(item.version) ||
        !isUuid(item.id) || ids.has(item.id) || !isUuid(item.rampProfileId) ||
        !isNonEmptyString(item.agentName) || !isNonEmptyString(item.employeeNumber) ||
        !isUuid(item.stationId) || !isNonEmptyString(item.stationCode) ||
        !isUuid(item.terminalId) || !isNonEmptyString(item.terminalCode) ||
        (item.positionId != null && !isUuid(item.positionId)) ||
        (item.positionCode != null && !isNonEmptyString(item.positionCode)) ||
        (item.positionId == null) !== (item.positionCode == null) ||
        !isDateOnly(item.workDate) || item.workDate < from || item.workDate > to ||
        typeof item.startsAtLocal !== "string" ||
        typeof item.endsAtLocal !== "string" ||
        !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(item.startsAtLocal) ||
        !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(item.endsAtLocal) ||
        typeof item.block !== "string" ||
        !["Morning", "Afternoon", "Night"].includes(item.block)) return false;
    ids.add(item.id);
    return true;
  });
}

function isHumanResourcesQualificationPage(value: unknown): value is HumanResourcesQualificationPage {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ["page", "limit", "hasMore", "qualifications"]) ||
      !isInt32(value.page) || value.page < 1 ||
      !isInt32(value.limit) || value.limit < 1 || value.limit > 100 ||
      typeof value.hasMore !== "boolean" || !Array.isArray(value.qualifications) ||
      value.qualifications.length > value.limit ||
      (value.hasMore && value.qualifications.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.qualifications.every(item => {
    if (!isRecord(item) || !hasOnlyKeys(item,
      ["id", "rampProfileId", "agentName", "employeeNumber", "equipmentTypeId",
        "equipmentCode", "equipmentName", "cycleNumber", "trainingDate", "obtainedOn",
        "expiresOn", "certifyingEntity", "instructorName", "notes", "recordedAt", "validity"]) ||
        (item.notes != null && typeof item.notes !== "string") ||
        !isDateTimeOffset(item.recordedAt) || typeof item.validity !== "string" ||
        !HUMAN_RESOURCES_DOCUMENT_VALIDITIES.includes(item.validity) ||
        !isUuid(item.id) || ids.has(item.id) || !isUuid(item.rampProfileId) ||
        !isNonEmptyString(item.agentName) || !isNonEmptyString(item.employeeNumber) ||
        !isUuid(item.equipmentTypeId) || !isNonEmptyString(item.equipmentCode) ||
        !isNonEmptyString(item.equipmentName) || !isInt32(item.cycleNumber) ||
        item.cycleNumber < 1 || !isDateOnly(item.trainingDate) ||
        !isDateOnly(item.obtainedOn) || !isDateOnly(item.expiresOn) ||
        item.trainingDate > item.obtainedOn || item.obtainedOn > item.expiresOn ||
        !isNonEmptyString(item.certifyingEntity) || !isNonEmptyString(item.instructorName))
      return false;
    ids.add(item.id);
    return true;
  });
}

function isHumanResourcesQualificationEquipmentTypes(
  value: unknown,
): value is HumanResourcesQualificationEquipmentType[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!isRecord(item) || !hasOnlyKeys(item, ["id", "code", "name"]) ||
        !isUuid(item.id) || ids.has(item.id) ||
        !isNonEmptyString(item.code) || !isNonEmptyString(item.name)) return false;
    ids.add(item.id);
    return true;
  });
}

function validatedHumanResourcesQualificationInput(
  request: RecordHumanResourcesQualificationInput,
): RecordHumanResourcesQualificationInput {
  if (!isRecord(request) || !hasOnlyKeys(request,
    ["rampProfileId", "equipmentTypeId", "expectedCurrentId", "trainingDate",
      "obtainedOn", "expiresOn", "certifyingEntity", "instructorName", "notes"]) ||
      !isUuid(request.rampProfileId) || !isUuid(request.equipmentTypeId) ||
      (request.expectedCurrentId != null && !isUuid(request.expectedCurrentId)) ||
      !isDateOnly(request.trainingDate) || !isDateOnly(request.obtainedOn) ||
      !isDateOnly(request.expiresOn) || request.trainingDate > request.obtainedOn ||
      request.obtainedOn > request.expiresOn ||
      !isNonEmptyString(request.certifyingEntity) ||
      request.certifyingEntity.trim().length < 2 || request.certifyingEntity.trim().length > 160 ||
      !isNonEmptyString(request.instructorName) ||
      request.instructorName.trim().length < 2 || request.instructorName.trim().length > 160 ||
      (request.notes != null && (typeof request.notes !== "string" || request.notes.trim().length > 1000)))
    throw new TypeError("Human Resources qualification input is invalid.");
  return request;
}

function validatedHumanResourcesPermitInput(
  request: RecordHumanResourcesPermitInput,
): RecordHumanResourcesPermitInput {
  if (!isRecord(request) || !hasOnlyKeys(request,
    ["rampProfileId", "documentType", "expectedCurrentId", "documentNumber", "issuedOn", "expiresOn"]) ||
      !isUuid(request.rampProfileId) ||
      !["AirportId", "RampDriverLicense"].includes(String(request.documentType)) ||
      (request.expectedCurrentId != null && !isUuid(request.expectedCurrentId)) ||
      !isNonEmptyString(request.documentNumber) ||
      request.documentNumber.trim().length < 2 || request.documentNumber.trim().length > 64 ||
      !isDateOnly(request.issuedOn) || !isDateOnly(request.expiresOn) ||
      request.issuedOn > request.expiresOn)
    throw new TypeError("Human Resources permit input is invalid.");
  return request;
}

function isFinanceTariffPageData(value: unknown): value is FinanceTariffPageData {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ["stationId", "page", "limit", "hasMore", "tariffs"]) ||
      !isUuid(value.stationId) || !isInt32(value.page) || value.page < 1 ||
      !isInt32(value.limit) || value.limit < 1 || value.limit > 50 ||
      typeof value.hasMore !== "boolean" || !Array.isArray(value.tariffs) ||
      value.tariffs.length > value.limit ||
      (value.hasMore && value.tariffs.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.tariffs.every(item => {
    if (!isRecord(item) || !hasOnlyKeys(item,
      ["id", "contractId", "contractCode", "airlineId", "airlineName",
        "versionNumber", "versionStatus", "validFrom", "validTo", "currencyCode",
        "serviceCode", "serviceName", "billingUnit", "unitPrice", "minimumQuantity"]) ||
        !isUuid(item.id) || ids.has(item.id) || !isUuid(item.contractId) ||
        !isNonEmptyString(item.contractCode) || !isUuid(item.airlineId) ||
        !isNonEmptyString(item.airlineName) || !isInt32(item.versionNumber) ||
        item.versionNumber < 1 || !["Approved", "Superseded"].includes(String(item.versionStatus)) ||
        !isDateOnly(item.validFrom) || !isOptionalNullable(item.validTo, isDateOnly) ||
        (item.validTo != null && item.validTo < item.validFrom) ||
        typeof item.currencyCode !== "string" || !/^[A-Z]{3}$/.test(item.currencyCode) ||
        !isNonEmptyString(item.serviceCode) || !isNonEmptyString(item.serviceName) ||
        !isNonEmptyString(item.billingUnit) || !isFiniteNumber(item.unitPrice) ||
        item.unitPrice < 0 || !isFiniteNumber(item.minimumQuantity) ||
        item.minimumQuantity < 0) return false;
    ids.add(item.id);
    return true;
  });
}

function validatedFinanceReconciliationQuery(
  query: ListFinanceReconciliationParams,
): ListFinanceReconciliationParams {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "page", "limit"]) ||
      !isUuid(query.stationId) ||
      (query.page !== undefined && (!isInt32(query.page) || query.page < 1 || query.page > 10_000)) ||
      (query.limit !== undefined && (!isInt32(query.limit) || query.limit < 1 || query.limit > 50)))
    throw new TypeError("Finance reconciliation station or paging is invalid.");
  return { stationId: query.stationId,
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.limit === undefined ? {} : { limit: query.limit }) };
}

function isFinanceReconciliationPageData(value: unknown): value is FinanceReconciliationPageData {
  if (!isRecord(value) || !hasOnlyKeys(value,
    ["stationId", "page", "limit", "hasMore", "rows"]) ||
      !isUuid(value.stationId) || !isInt32(value.page) || value.page < 1 ||
      !isInt32(value.limit) || value.limit < 1 || value.limit > 50 ||
      typeof value.hasMore !== "boolean" || !Array.isArray(value.rows) ||
      value.rows.length > value.limit ||
      (value.hasMore && value.rows.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.rows.every(item => {
    if (!isRecord(item) || !hasOnlyKeys(item,
      ["preinvoiceId", "airlineId", "airlineName", "from", "to", "currencyCode",
        "preinvoiceTotal", "preinvoiceStatus", "invoiceId", "invoiceNumber",
        "invoiceTotal", "issuedAt", "paymentId", "paymentReference",
        "paymentAmount", "paymentRecordedAt"]) ||
        !isUuid(item.preinvoiceId) || ids.has(item.preinvoiceId) ||
        !isUuid(item.airlineId) || !isNonEmptyString(item.airlineName) ||
        !isDateOnly(item.from) || !isDateOnly(item.to) || item.to < item.from ||
        typeof item.currencyCode !== "string" || !/^[A-Z]{3}$/.test(item.currencyCode) ||
        !isFiniteNumber(item.preinvoiceTotal) || item.preinvoiceTotal < 0 ||
        !["Accepted", "Invoiced"].includes(String(item.preinvoiceStatus))) return false;
    ids.add(item.preinvoiceId);
    const invoiceFields = [item.invoiceId, item.invoiceNumber, item.invoiceTotal, item.issuedAt];
    const paymentFields = [item.paymentId, item.paymentReference,
      item.paymentAmount, item.paymentRecordedAt];
    if (item.preinvoiceStatus === "Accepted")
      return invoiceFields.every(field => field == null) &&
        paymentFields.every(field => field == null);
    if (!isUuid(item.invoiceId) || !isNonEmptyString(item.invoiceNumber) ||
        !isFiniteNumber(item.invoiceTotal) || item.invoiceTotal !== item.preinvoiceTotal ||
        !isDateTimeOffset(item.issuedAt)) return false;
    if (paymentFields.every(field => field == null)) return true;
    return isUuid(item.paymentId) && isNonEmptyString(item.paymentReference) &&
      isFiniteNumber(item.paymentAmount) && item.paymentAmount === item.invoiceTotal &&
      isDateTimeOffset(item.paymentRecordedAt);
  });
}

function isFinancePreinvoicePageData(value: unknown): value is FinancePreinvoicePageData {
  if (!isRecord(value) || !hasOnlyKeys(value, ["page", "limit", "hasMore", "preinvoices"]) ||
      !isInt32(value.page) || value.page < 1 ||
      !isInt32(value.limit) || value.limit < 1 || value.limit > 50 ||
      typeof value.hasMore !== "boolean" || !Array.isArray(value.preinvoices) ||
      value.preinvoices.length > value.limit ||
      (value.hasMore && value.preinvoices.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.preinvoices.every(item => {
    if (!isRecord(item) || !hasOnlyKeys(item, ["id", "airlineId", "airlineName",
        "stationId", "from", "to", "currencyCode", "total", "status",
        "lineCount", "createdAt"]) || !isUuid(item.id) || ids.has(item.id) ||
        !isUuid(item.airlineId) || !isNonEmptyString(item.airlineName) ||
        !isUuid(item.stationId) || !isDateOnly(item.from) || !isDateOnly(item.to) ||
        item.to < item.from || typeof item.currencyCode !== "string" ||
        !/^[A-Z]{3}$/.test(item.currencyCode) ||
        !isFiniteNumber(item.total) || item.total < 0 ||
        !["Draft", "Submitted", "Disputed", "Accepted", "Invoiced", "Voided"].includes(String(item.status)) ||
        !isInt32(item.lineCount) || item.lineCount < 1 || item.lineCount > 100 ||
        !isDateTimeOffset(item.createdAt)) return false;
    ids.add(item.id);
    return true;
  });
}

function isFinanceApprovedServicesResponse(value: unknown): value is FinanceApprovedServicesResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["stationId", "from", "to", "services", "hasMore"]) &&
    isUuid(value.stationId) && isDateOnly(value.from) && isDateOnly(value.to) &&
    typeof value.hasMore === "boolean" && Array.isArray(value.services) &&
    value.services.length <= 200 &&
    value.services.every((service) => isRecord(service) &&
      hasOnlyKeys(service, ["id", "operationId", "turnaroundId", "approvedSubmissionId",
        "operationCode", "operationDate", "airlineId", "airlineName", "flightNumber", "contractCode",
        "serviceCode", "serviceName", "executionStatus", "contractedQuantity",
        "executedQuantity", "billingUnit", "frozenUnitPrice", "frozenCurrency",
        "ready", "blockingReason", "amount", "preinvoiceId", "charges"]) &&
      (service.charges === undefined || service.charges === null || (Array.isArray(service.charges) &&
        service.charges.length <= 50 && service.charges.every((charge: unknown) => isRecord(charge) &&
          hasOnlyKeys(charge, ["code", "source"]) && isNonEmptyString(charge.code) &&
          isOneOf(charge.source, CHARGE_MARK_SOURCES)))) &&
      isUuid(service.id) && isUuid(service.operationId) && isUuid(service.turnaroundId) &&
      isUuid(service.approvedSubmissionId) && isNonEmptyString(service.operationCode) &&
      isDateOnly(service.operationDate) && isUuid(service.airlineId) &&
      isNonEmptyString(service.airlineName) &&
      isString(service.flightNumber) && isOptionalNullable(service.contractCode, isNonEmptyString) &&
      isNonEmptyString(service.serviceCode) && isNonEmptyString(service.serviceName) &&
      ["Planned", "InProgress", "Completed", "NotPerformed", "Exception"].includes(
        String(service.executionStatus)) &&
      isFiniteNumber(service.contractedQuantity) && service.contractedQuantity >= 0 &&
      isFiniteNumber(service.executedQuantity) && service.executedQuantity >= 0 &&
      isString(service.billingUnit) &&
      isOptionalNullable(service.frozenUnitPrice, value => isFiniteNumber(value) && value >= 0) &&
      isOptionalNullable(service.frozenCurrency, value =>
        typeof value === "string" && /^[A-Z]{3}$/.test(value)) &&
      isOptionalNullable(service.preinvoiceId, isUuid) &&
      typeof service.ready === "boolean" &&
      (service.ready
        ? service.executionStatus === "Completed" && service.executedQuantity > 0 &&
          isNonEmptyString(service.billingUnit) && isFiniteNumber(service.frozenUnitPrice) &&
          typeof service.frozenCurrency === "string" &&
          /^[A-Z]{3}$/.test(service.frozenCurrency) &&
          (service.blockingReason === null || service.blockingReason === undefined) &&
          isFiniteNumber(service.amount) && service.amount >= 0
        : isNonEmptyString(service.blockingReason) &&
          (service.amount === null || service.amount === undefined)));
}

function validatedPreinvoiceDraftRequest(
  request: CreatePreinvoiceDraftRequest,
): CreatePreinvoiceDraftRequest {
  if (!isRecord(request) ||
      !hasOnlyKeys(request, ["stationId", "from", "to", "requestId", "serviceIds"]) ||
      !isUuid(request.stationId) || !isUuid(request.requestId) ||
      !isDateOnly(request.from) || !isDateOnly(request.to) ||
      request.to < request.from ||
      (Date.parse(`${request.to}T00:00:00Z`) - Date.parse(`${request.from}T00:00:00Z`)) /
        86_400_000 > 30 || !Array.isArray(request.serviceIds) ||
      request.serviceIds.length < 1 || request.serviceIds.length > 100 ||
      !request.serviceIds.every(isUuid) ||
      new Set(request.serviceIds).size !== request.serviceIds.length)
    throw new TypeError("Preinvoice draft selection is invalid.");
  return request as unknown as CreatePreinvoiceDraftRequest;
}

function isPreinvoiceDraftCreateResponse(value: unknown): value is CreatePreinvoiceDraftResponse {
  return isRecord(value) && hasOnlyKeys(value, ["id", "replayed"]) &&
    isUuid(value.id) && typeof value.replayed === "boolean";
}

function isSubmitPreinvoiceResponse(value: unknown): value is SubmitPreinvoiceResponse {
  return isRecord(value) && hasOnlyKeys(value, ["id", "status", "replayed"]) &&
    isUuid(value.id) && value.status === "Submitted" &&
    typeof value.replayed === "boolean";
}

const PRICED_LINE_KINDS = ["Service", "Charge", "Adjustment", "Package", "Excess", "Minimum"];
const INVOICE_STATUSES = ["Pending", "PartiallyPaid", "Paid", "Overdue"];
const PAYMENT_METHODS = ["Transfer", "Check", "Cash", "Other", "Card"];

function isStatementText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

/** Airline statement: own invoice only, balance consistent with payments and credit notes. */
function isAirlineInvoiceStatementResponse(
  value: unknown,
  invoiceId: string,
): value is AirlineInvoiceStatementResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "invoiceId", "number", "preinvoiceId", "currencyCode", "total", "paid", "credited", "balance",
      "issuedAt", "dueDate", "status", "daysOverdue", "lines", "payments", "creditNotes",
    ]) ||
    !isUuid(value.invoiceId) || value.invoiceId.toLowerCase() !== invoiceId ||
    !isStatementText(value.number, 64) || !isUuid(value.preinvoiceId) ||
    (value.currencyCode !== "USD" && value.currencyCode !== "DOP") ||
    !isFiniteNumber(value.total) || value.total < 0 ||
    !isFiniteNumber(value.paid) || value.paid < 0 ||
    !isFiniteNumber(value.credited) || value.credited < 0 ||
    !isFiniteNumber(value.balance) ||
    Math.abs(value.total - value.paid - value.credited - value.balance) > 0.0001 ||
    !isDateTimeOffset(value.issuedAt) ||
    (value.dueDate !== null && value.dueDate !== undefined && !isDateOnly(value.dueDate)) ||
    typeof value.status !== "string" || !INVOICE_STATUSES.includes(value.status) ||
    !Number.isInteger(value.daysOverdue) || (value.daysOverdue as number) < 0 ||
    !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 500 ||
    !Array.isArray(value.payments) || value.payments.length > 500 ||
    !Array.isArray(value.creditNotes) || value.creditNotes.length > 500
  ) return false;
  let previous = 0;
  for (const line of value.lines) {
    if (
      !isRecord(line) ||
      !hasOnlyKeys(line, [
        "lineNumber", "kind", "parentLineNumber", "operationCode", "operationDate", "serviceCode",
        "serviceName", "quantity", "billingUnit", "unitPrice", "amount", "reason",
      ]) ||
      !Number.isInteger(line.lineNumber) || (line.lineNumber as number) <= previous ||
      typeof line.kind !== "string" || !PRICED_LINE_KINDS.includes(line.kind) ||
      (line.parentLineNumber !== null && line.parentLineNumber !== undefined &&
        (!Number.isInteger(line.parentLineNumber) || (line.parentLineNumber as number) >= (line.lineNumber as number))) ||
      (line.kind === "Service" && line.parentLineNumber !== null && line.parentLineNumber !== undefined) ||
      !isStatementText(line.operationCode, 64) || !isDateOnly(line.operationDate) ||
      !isStatementText(line.serviceCode, 64) || !isStatementText(line.serviceName, 200) ||
      !isFiniteNumber(line.quantity) || line.quantity < 0 ||
      !isStatementText(line.billingUnit, 32) ||
      !isFiniteNumber(line.unitPrice) || !isFiniteNumber(line.amount) ||
      (line.kind !== "Adjustment" && (line.amount < 0 || line.unitPrice < 0)) ||
      (line.reason !== null && line.reason !== undefined &&
        !(typeof line.reason === "string" && line.reason.length <= 1000))
    ) return false;
    previous = line.lineNumber as number;
  }
  return value.payments.every(payment =>
    isRecord(payment) &&
    hasOnlyKeys(payment, ["reference", "method", "paidOn", "amount", "recordedAt"]) &&
    isStatementText(payment.reference, 80) &&
    typeof payment.method === "string" && PAYMENT_METHODS.includes(payment.method) &&
    (payment.paidOn === null || payment.paidOn === undefined || isDateOnly(payment.paidOn)) &&
    isFiniteNumber(payment.amount) && payment.amount > 0 &&
    isDateTimeOffset(payment.recordedAt)) &&
    value.creditNotes.every(note =>
      isRecord(note) &&
      hasOnlyKeys(note, ["number", "amount", "reason", "issuedAt"]) &&
      isStatementText(note.number, 64) &&
      isFiniteNumber(note.amount) && note.amount > 0 &&
      isStatementText(note.reason, 1000) &&
      isDateTimeOffset(note.issuedAt));
}

/**
 * Service lines bill a positive executed quantity; charges may bill zero (inside a
 * grace period) and adjustments may be negative discounts.
 */
function isPricedLineAmounts(line: Record<string, unknown>, kind: string): boolean {
  return isFiniteNumber(line.executedQuantity) &&
    (kind === "Service" ? line.executedQuantity > 0 : line.executedQuantity >= 0) &&
    isFiniteNumber(line.unitPrice) && line.unitPrice >= 0 &&
    isFiniteNumber(line.amount) && (kind === "Adjustment" || line.amount >= 0);
}

function isPreinvoiceDraftResponse(value: unknown): value is PreinvoiceDraftResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "airlineId", "airlineName",
      "stationId", "from", "to", "currencyCode", "total", "status", "lines", "version"]) ||
      (value.version !== undefined && value.version !== null && !isNonEmptyString(value.version)) ||
      !isUuid(value.id) || !isUuid(value.airlineId) || !isUuid(value.stationId) ||
      !isNonEmptyString(value.airlineName) || !isDateOnly(value.from) ||
      !isDateOnly(value.to) || value.to < value.from ||
      typeof value.currencyCode !== "string" || !/^[A-Z]{3}$/.test(value.currencyCode) ||
      !isFiniteNumber(value.total) || value.total < 0 ||
      !["Draft", "Submitted", "Disputed", "Accepted", "Invoiced", "Voided"].includes(String(value.status)) ||
      !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 500)
    return false;
  const validLines = value.lines.every((line, index) => {
    if (!isRecord(line) || !hasOnlyKeys(line, ["id", "operationServiceId", "approvedSubmissionId", "lineNumber",
        "operationCode", "operationDate", "serviceCode", "serviceName",
        "executedQuantity", "billingUnit", "unitPrice", "currencyCode", "amount", "kind", "parentLineId",
        "computedQuantity", "computedAmount", "isExcluded", "adjustmentReason", "editedAt"])) return false;
    const kind = line.kind === undefined ? "Service" : String(line.kind);
    return PRICED_LINE_KINDS.includes(kind) && isUuid(line.id) &&
      (kind === "Adjustment" ? isOptionalNullable(line.operationServiceId, isUuid) : isUuid(line.operationServiceId)) &&
      (kind === "Adjustment" ? isOptionalNullable(line.approvedSubmissionId, isUuid) : isUuid(line.approvedSubmissionId)) &&
      isOptionalNullable(line.parentLineId, isUuid) && (kind !== "Charge" || isUuid(line.parentLineId)) &&
      line.lineNumber === index + 1 && isNonEmptyString(line.operationCode) &&
      isDateOnly(line.operationDate) && String(line.operationDate) >= String(value.from) &&
      String(line.operationDate) <= String(value.to) && isNonEmptyString(line.serviceCode) &&
      isNonEmptyString(line.serviceName) && isNonEmptyString(line.billingUnit) &&
      line.currencyCode === value.currencyCode && isPricedLineAmounts(line, kind) &&
      isOptionalNullable(line.computedQuantity, isFiniteNumber) && isOptionalNullable(line.computedAmount, isFiniteNumber) &&
      (line.isExcluded === undefined || typeof line.isExcluded === "boolean") &&
      isOptionalNullable(line.adjustmentReason, isString) && isOptionalNullable(line.editedAt, isDateTimeOffset);
  });
  return validLines;
}

function validatedAirlineContractParams(parameters: GetAirlineContractsParams): GetAirlineContractsParams {
  if (!isRecord(parameters) ||
    (parameters.page !== undefined && (!isInt32(parameters.page) || parameters.page < 1 || parameters.page > 10_000)) ||
    (parameters.limit !== undefined && (!isInt32(parameters.limit) || parameters.limit < 1 || parameters.limit > 50)))
    throw new TypeError("Airline contract paging is invalid.");
  return {
    ...(parameters.page === undefined ? {} : { page: parameters.page }),
    ...(parameters.limit === undefined ? {} : { limit: parameters.limit }),
  };
}

function validatedAirlineOperationParams(parameters: GetAirlineOperationsParams): GetAirlineOperationsParams {
  if (!isRecord(parameters) || !hasOnlyKeys(parameters, ["page", "limit"]) ||
    (parameters.page !== undefined && (!isInt32(parameters.page) || parameters.page < 1 || parameters.page > 10_000)) ||
    (parameters.limit !== undefined && (!isInt32(parameters.limit) || parameters.limit < 1 || parameters.limit > 50)))
    throw new TypeError("Airline operation paging is invalid.");
  return {
    ...(parameters.page === undefined ? {} : { page: parameters.page }),
    ...(parameters.limit === undefined ? {} : { limit: parameters.limit }),
  };
}

function validatedAirlineRequestParams(
  parameters: GetAirlineOperationalRequestsParams,
): GetAirlineOperationalRequestsParams {
  if (!isRecord(parameters) || !hasOnlyKeys(parameters, ["page", "limit"]) ||
    (parameters.page !== undefined && (!isInt32(parameters.page) || parameters.page < 1 || parameters.page > 10_000)) ||
    (parameters.limit !== undefined && (!isInt32(parameters.limit) || parameters.limit < 1 || parameters.limit > 50)))
    throw new TypeError("Airline request paging is invalid.");
  return {
    ...(parameters.page === undefined ? {} : { page: parameters.page }),
    ...(parameters.limit === undefined ? {} : { limit: parameters.limit }),
  };
}

function validatedAirlinePreinvoiceParams(
  parameters: GetAirlinePreinvoicesParams,
): GetAirlinePreinvoicesParams {
  if (!isRecord(parameters) || !hasOnlyKeys(parameters, ["page", "limit"]) ||
    (parameters.page !== undefined && (!isInt32(parameters.page) || parameters.page < 1 || parameters.page > 10_000)) ||
    (parameters.limit !== undefined && (!isInt32(parameters.limit) || parameters.limit < 1 || parameters.limit > 50)))
    throw new TypeError("Airline preinvoice paging is invalid.");
  return {
    ...(parameters.page === undefined ? {} : { page: parameters.page }),
    ...(parameters.limit === undefined ? {} : { limit: parameters.limit }),
  };
}

function validatedManagedContractParams(
  parameters: ListManagedContractsParams,
): ListManagedContractsParams {
  if (!isRecord(parameters) || !hasOnlyKeys(parameters, ["page", "limit"]) ||
    (parameters.page !== undefined && (!isInt32(parameters.page) || parameters.page < 1 || parameters.page > 10_000)) ||
    (parameters.limit !== undefined && (!isInt32(parameters.limit) || parameters.limit < 1 || parameters.limit > 50)))
    throw new TypeError("Managed contract paging is invalid.");
  return {
    ...(parameters.page === undefined ? {} : { page: parameters.page }),
    ...(parameters.limit === undefined ? {} : { limit: parameters.limit }),
  };
}

export type SessionStart =
  | { kind: "session"; session: SessionResponse }
  | { kind: "code_required"; challenge: LoginChallengeResponse };

function isLoginChallengeResponse(value: unknown): value is LoginChallengeResponse {
  return isRecord(value) && value.code === "code_required" && typeof value.challengeId === "string" &&
    UUID_TEXT.test(value.challengeId) && typeof value.emailHint === "string" && value.emailHint.length <= 320 &&
    typeof value.expiresAt === "string" && !Number.isNaN(Date.parse(value.expiresAt));
}

function isEmailDeliveryResponse(value: unknown): value is EmailDeliveryResponse {
  return isRecord(value) && typeof value.id === "string" && typeof value.recipient === "string" &&
    typeof value.purpose === "string" && typeof value.status === "string" && typeof value.attempts === "number" &&
    typeof value.createdAt === "string";
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validatedLoginCode(code: string): string {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new TypeError("The code must be 6 digits.");
  return code;
}

function validatedLinkToken(token: string): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(token))
    throw new TypeError("The link token is invalid.");
  return token;
}

function validatedNewPassword(password: string): string {
  if (typeof password !== "string" || password.length === 0 || password.length > 256)
    throw new TypeError("The new password is required.");
  return password;
}

function validatedEmailAddress(email: string): string {
  if (typeof email !== "string" || email.length > 256 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
    throw new TypeError("A valid email is required.");
  return email.trim();
}

function validatedSessionRequest(request: CreateSessionRequest): CreateSessionRequest {
  if (
    !isRecord(request) ||
    !isNonEmptyString(request.email) ||
    typeof request.password !== "string" ||
    request.password.length === 0
  ) {
    throw new TypeError("Session credentials must include an email and password.");
  }

  return request;
}

function validatedChangePasswordRequest(request: ChangePasswordRequest): ChangePasswordRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["email", "currentPassword", "newPassword"]) ||
    !isNonEmptyString(request.email) ||
    request.email.length > 256 ||
    !isNonEmptyString(request.currentPassword) ||
    request.currentPassword.length > 256 ||
    !isNonEmptyString(request.newPassword) ||
    request.newPassword.length > 256
  ) {
    throw new TypeError("Password change request is invalid.");
  }

  return request as unknown as ChangePasswordRequest;
}

function validatedOccPlanningSnapshotParams(
  parameters: GetOccPlanningSnapshotParams,
): GetOccPlanningSnapshotParams {
  if (!isRecord(parameters)) {
    throw new TypeError("OCC planning parameters must be an object.");
  }

  const stationId = parameters.stationId;
  const date = parameters.date;
  if (stationId !== undefined && !isUuid(stationId)) {
    throw new TypeError("stationId must be a non-empty canonical UUID.");
  }
  if (date !== undefined && !isDateOnly(date)) {
    throw new TypeError("date must be a valid calendar date in YYYY-MM-DD format.");
  }

  return {
    ...(stationId === undefined ? {} : { stationId }),
    ...(date === undefined ? {} : { date }),
  };
}

function validatedOccPlanningOptionsParams(
  turnaroundId: string,
): GetOccPlanningOptionsParams {
  if (!isUuid(turnaroundId)) {
    throw new TypeError("turnaroundId must be a non-empty canonical UUID.");
  }

  return { turnaroundId };
}

function validatedManualTurnaroundOptionsParams(
  parameters: GetManualTurnaroundOptionsParams,
): GetManualTurnaroundOptionsParams {
  if (!isRecord(parameters) || !hasOnlyKeys(parameters, ["stationId", "date"]) ||
      !isUuid(parameters.stationId))
    throw new TypeError("stationId must be a canonical UUID.");
  if (!isDateOnly(parameters.date))
    throw new TypeError("date must be a valid calendar date.");
  return { stationId: parameters.stationId, date: parameters.date };
}

function validatedManualTurnaroundRequest(
  request: CreateManualTurnaroundRequest,
): CreateManualTurnaroundRequest {
  const keys = ["turnaroundId", "stationId", "airlineId", "standId", "operationDate",
    "arrivalFlightNumber", "arrivalOriginIata", "arrivalScheduledAt",
    "departureFlightNumber", "departureDestinationIata", "departureScheduledAt", "charter", "aircraftTypeId"];
  if (!isRecord(request) || !hasOnlyKeys(request, keys) ||
      (request.charter !== undefined && typeof request.charter !== "boolean") ||
      (request.aircraftTypeId !== undefined && request.aircraftTypeId !== null && !isUuid(request.aircraftTypeId)))
    throw new TypeError("manual turnaround request has unknown or invalid fields.");
  if (!isUuid(request.turnaroundId) || !isUuid(request.stationId) ||
      !isUuid(request.airlineId) || !isUuid(request.standId) ||
      !isDateOnly(request.operationDate))
    throw new TypeError("manual turnaround identifiers or operationDate are invalid.");
  const arrivalFlightNumber = typeof request.arrivalFlightNumber === "string"
    ? request.arrivalFlightNumber.replace(/\s+/g, "").toUpperCase() : "";
  const departureFlightNumber = typeof request.departureFlightNumber === "string"
    ? request.departureFlightNumber.replace(/\s+/g, "").toUpperCase() : "";
  const arrivalOriginIata = typeof request.arrivalOriginIata === "string"
    ? request.arrivalOriginIata.trim().toUpperCase() : "";
  const departureDestinationIata = typeof request.departureDestinationIata === "string"
    ? request.departureDestinationIata.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{2,16}$/.test(arrivalFlightNumber) ||
      !/^[A-Z0-9]{2,16}$/.test(departureFlightNumber) ||
      !/^[A-Z]{3}$/.test(arrivalOriginIata) ||
      !/^[A-Z]{3}$/.test(departureDestinationIata))
    throw new TypeError("manual turnaround flight or airport code is invalid.");
  if (typeof request.arrivalScheduledAt !== "string" ||
      typeof request.departureScheduledAt !== "string" ||
      !isDateTimeOffset(request.arrivalScheduledAt) ||
      !isDateTimeOffset(request.departureScheduledAt) ||
      !/(?:Z|\+00:00)$/.test(request.arrivalScheduledAt) ||
      !/(?:Z|\+00:00)$/.test(request.departureScheduledAt))
    throw new TypeError("manual turnaround scheduled times must be UTC instants.");
  const duration = Date.parse(request.departureScheduledAt) - Date.parse(request.arrivalScheduledAt);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60 * 1000)
    throw new TypeError("departureScheduledAt must follow arrivalScheduledAt within 24 hours.");
  return { turnaroundId: request.turnaroundId, stationId: request.stationId,
    airlineId: request.airlineId, standId: request.standId,
    operationDate: request.operationDate,
    arrivalFlightNumber, arrivalOriginIata, arrivalScheduledAt: request.arrivalScheduledAt,
    departureFlightNumber, departureDestinationIata,
    departureScheduledAt: request.departureScheduledAt, charter: request.charter === true,
    // Only sent when chosen, so a body without a type stays the one older servers accept.
    ...(request.aircraftTypeId ? { aircraftTypeId: request.aircraftTypeId } : {}) };
}

function validatedOccShiftRequest(request: ProgramOccShiftRequest): ProgramOccShiftRequest {
  if (!isRecord(request) || !hasOnlyKeys(request,
      ["agentId", "startsAtLocal", "endsAtLocal"]) || !isUuid(request.agentId) ||
      typeof request.startsAtLocal !== "string" ||
      typeof request.endsAtLocal !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(request.startsAtLocal) ||
      !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(request.endsAtLocal) ||
      request.startsAtLocal === request.endsAtLocal)
    throw new TypeError("OCC shift requires an agentId and distinct local HH:mm:ss times.");
  const toSeconds = (value: string) => {
    const [hour, minute, second] = value.split(":").map(Number);
    return hour! * 3600 + minute! * 60 + second!;
  };
  const start = toSeconds(request.startsAtLocal);
  const end = toSeconds(request.endsAtLocal);
  const duration = end > start ? end - start : end + 86400 - start;
  if (duration > 16 * 3600)
    throw new TypeError("OCC shift cannot exceed sixteen hours.");
  return { agentId: request.agentId,
    startsAtLocal: request.startsAtLocal, endsAtLocal: request.endsAtLocal };
}

function validatedOccAssignmentRequest(
  request: AssignOccOperationRequest,
): AssignOccOperationRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["agentId"]) ||
    !isUuid(request.agentId)
  ) {
    throw new TypeError("OCC assignment must contain only a valid agentId UUID.");
  }

  return { agentId: request.agentId };
}

function validatedOptionalDeviceText(
  value: unknown,
  field: string,
  maximumLength: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${field} is not a valid mobile device value.`);
  }
  return value;
}

function validatedMobileDeviceRequest(
  request: RegisterMobileDeviceRequest,
): RegisterMobileDeviceRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, [
      "installationId",
      "platform",
      "appVersion",
      "deviceName",
      "operatingSystemVersion",
    ]) ||
    !isUuid(request.installationId) ||
    (request.platform !== "Android" && request.platform !== "Ios") ||
    typeof request.appVersion !== "string" ||
    request.appVersion.length === 0 ||
    request.appVersion.length > 32 ||
    request.appVersion.trim() !== request.appVersion ||
    /[\u0000-\u001f\u007f]/.test(request.appVersion)
  ) {
    throw new TypeError("Mobile device registration is invalid.");
  }

  const deviceName = validatedOptionalDeviceText(
    request.deviceName,
    "deviceName",
    120,
  );
  const operatingSystemVersion = validatedOptionalDeviceText(
    request.operatingSystemVersion,
    "operatingSystemVersion",
    64,
  );
  return {
    installationId: request.installationId,
    platform: request.platform,
    appVersion: request.appVersion,
    ...(deviceName === undefined ? {} : { deviceName }),
    ...(operatingSystemVersion === undefined
      ? {}
      : { operatingSystemVersion }),
  };
}

function validatedChecklistSubmissionRequest(
  request: SubmitRampOperationChecklistRequest,
): SubmitRampOperationChecklistRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["checklistId", "answers"]) ||
    !isUuid(request.checklistId) ||
    !Array.isArray(request.answers) ||
    request.answers.length < 1 ||
    request.answers.length > 256
  ) {
    throw new TypeError("Ramp checklist submission is invalid.");
  }

  const itemIds = new Set<string>();
  const answers = request.answers.map((answer) => {
    if (
      !isRecord(answer) ||
      !hasOnlyKeys(answer, ["itemId", "value", "note"]) ||
      !isUuid(answer.itemId) ||
      !isOneOf(answer.value, rampChecklistAnswerValues) ||
      !isOptionalNullable(
        answer.note,
        (note) => typeof note === "string" && note.length <= 1_000,
      )
    ) {
      throw new TypeError("Ramp checklist submission is invalid.");
    }

    const itemId = answer.itemId.toLowerCase();
    if (itemIds.has(itemId)) {
      throw new TypeError("Ramp checklist submission contains duplicate items.");
    }
    itemIds.add(itemId);

    return {
      itemId,
      value: answer.value,
      ...(answer.note === undefined ? {} : { note: answer.note }),
    };
  });

  return { checklistId: request.checklistId.toLowerCase(), answers };
}

function hasAtMostFourDecimalPlaces(value: number) {
  const [coefficient = "", exponentText] = value
    .toString()
    .toLowerCase()
    .split("e");
  const decimalPlaces = coefficient.includes(".")
    ? coefficient.length - coefficient.indexOf(".") - 1
    : 0;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  return Number.isInteger(exponent) && Math.max(0, decimalPlaces - exponent) <= 4;
}

/** The optional body of «Iniciar» (3-I): only the tapped time, and only when there is one. */
function validatedStartRequest(request: StartRampOperationRequest): StartRampOperationRequest {
  if (!isRecord(request) || !hasOnlyKeys(request, ["startedAt"]) ||
    !isOptionalNullable(request.startedAt, isDateTimeOffset)) {
    throw new TypeError("Ramp operation start is invalid.");
  }
  return typeof request.startedAt === "string" ? { startedAt: request.startedAt } : {};
}

function validatedServiceTransitionRequest(
  request: TransitionRampOperationServiceRequest,
): TransitionRampOperationServiceRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["targetStatus", "executedQuantity", "note", "occurredAt"]) ||
    !isOneOf(request.targetStatus, rampServiceTargetStatuses) ||
    !isOptionalNullable(
      request.note,
      (note) => typeof note === "string" && note.length <= 1_000,
    ) ||
    // 3-I: the moment the agent tapped it; without it the server's time applies, as for the first version.
    !isOptionalNullable(request.occurredAt, isDateTimeOffset)
  ) {
    throw new TypeError("Ramp service transition is invalid.");
  }

  const quantity = request.executedQuantity;
  if (request.targetStatus === "InProgress") {
    if (quantity !== undefined && quantity !== null) {
      throw new TypeError("InProgress service transitions cannot set a quantity.");
    }
  } else if (
    !isFiniteNumber(quantity) ||
    quantity < 0 ||
    quantity >= maximumExecutedQuantityExclusive ||
    !hasAtMostFourDecimalPlaces(quantity)
  ) {
    throw new TypeError("Terminal service transitions require a valid quantity.");
  }

  if (
    request.targetStatus === "NotPerformed" &&
    (quantity !== 0 ||
      typeof request.note !== "string" ||
      request.note.trim().length === 0)
  ) {
    throw new TypeError("NotPerformed service transitions require a zero quantity and note.");
  }
  if (
    request.targetStatus === "Exception" &&
    (typeof request.note !== "string" || request.note.trim().length === 0)
  ) {
    throw new TypeError("Exception service transitions require a note.");
  }

  return {
    targetStatus: request.targetStatus,
    ...(quantity === undefined ? {} : { executedQuantity: quantity }),
    ...(request.note === undefined ? {} : { note: request.note }),
    ...(typeof request.occurredAt === "string" ? { occurredAt: request.occurredAt } : {}),
  };
}

function validatedIncidentReportRequest(
  request: ReportRampIncidentRequest,
): ReportRampIncidentRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["incidentType", "severity", "description", "occurredAt", "delayCode"]) ||
    // A deviation carries its IATA delay code (ADR-0031); other incidents never do.
    (request.incidentType === "Deviation" ? !isIataDelayCode(request.delayCode) : request.delayCode != null) ||
    !isOneOf(request.incidentType, rampIncidentTypes) ||
    !isOneOf(request.severity, rampIncidentSeverities) ||
    typeof request.description !== "string" ||
    request.description.length > 2_000 ||
    request.description.trim().length < 8 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request.description) ||
    !isDateTimeOffset(request.occurredAt)
  ) throw new TypeError("Ramp incident report is invalid.");

  return {
    incidentType: request.incidentType,
    severity: request.severity,
    description: request.description.trim(),
    occurredAt: request.occurredAt,
    ...(request.incidentType === "Deviation" ? { delayCode: request.delayCode } : {}),
  };
}

function validatedAttendanceDraftRequest(
  request: SaveAttendanceDraftRequest,
): SaveAttendanceDraftRequest {
  if (!isRecord(request) || !hasOnlyKeys(request, [
    "expectedRevision", "observedStartAt", "observedEndAt", "incidentNote",
  ]) || !Number.isSafeInteger(request.expectedRevision) ||
    (request.expectedRevision as number) < 0) {
    throw new TypeError("Attendance draft request is invalid.");
  }
  const start = request.observedStartAt ?? null;
  const end = request.observedEndAt ?? null;
  const note = request.incidentNote ?? null;
  const normalizedNote = typeof note === "string" ? note.trim() : null;
  if ((start !== null && !isDateTimeOffset(start)) ||
    (end !== null && !isDateTimeOffset(end)) ||
    (note !== null && (typeof note !== "string" ||
      normalizedNote!.length > 2_000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note))) ||
    (start === null && end === null && !normalizedNote) ||
    (start !== null && end !== null && Date.parse(end) < Date.parse(start))) {
    throw new TypeError("Attendance draft request is invalid.");
  }
  return request;
}

function validatedHumanResourcesAttendanceQuery(
  query: GetHumanResourcesAttendanceParams,
): GetHumanResourcesAttendanceParams {
  if (!isRecord(query) || !hasOnlyKeys(query, [
    "stationId", "from", "to", "page", "limit",
  ]) || !isUuid(query.stationId) || !isDateOnly(query.from) ||
    !isDateOnly(query.to) || query.from > query.to ||
    (Date.parse(`${query.to}T00:00:00Z`) -
      Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 >= 30 ||
    (query.page !== undefined && (!isInt32(query.page) || query.page < 1)) ||
    (query.limit !== undefined && (!isInt32(query.limit) ||
      query.limit < 1 || query.limit > 100)))
    throw new TypeError("Human Resources attendance query is invalid.");
  return query;
}

function validatedHumanResourcesReportQuery(
  kind: HumanResourcesReportKind, query: HumanResourcesReportQuery,
): HumanResourcesReportQuery {
  if (!["expirations", "account-movements", "staff-distribution",
    "qualification-coverage"].includes(kind) || !isRecord(query) ||
      !hasOnlyKeys(query, ["stationId", "from", "to", "page", "limit",
        "documentKind", "validity"]) ||
    !isUuid(query.stationId) || !isDateOnly(query.from) ||
    !isDateOnly(query.to) || query.from > query.to ||
    (Date.parse(`${query.to}T00:00:00Z`) -
      Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 >= 30 ||
    (query.page !== undefined && (!isInt32(query.page) || query.page < 1)) ||
      (query.limit !== undefined && (!isInt32(query.limit) ||
        query.limit < 1 || query.limit > 100)) ||
      (kind !== "expirations" &&
        (query.documentKind !== undefined || query.validity !== undefined)) ||
      (query.documentKind !== undefined &&
        !["Qualification", "Permit"].includes(query.documentKind)) ||
      (query.validity !== undefined &&
        !["Current", "Expired"].includes(query.validity)))
    throw new TypeError("Human Resources report query is invalid.");
  return query;
}

function validatedHumanResourcesScheduleWarningsQuery(
  query: HumanResourcesScheduleWarningsQuery,
): HumanResourcesScheduleWarningsQuery {
  if (!isRecord(query) || !hasOnlyKeys(query,
      ["stationId", "from", "to", "page", "limit", "includeReadiness"]) ||
      !isUuid(query.stationId) || !isDateOnly(query.from) ||
      !isDateOnly(query.to) || query.from > query.to ||
      (Date.parse(`${query.to}T00:00:00Z`) -
        Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 >= 30 ||
      (query.page !== undefined && (!isInt32(query.page) || query.page < 1)) ||
      (query.limit !== undefined && (!isInt32(query.limit) ||
        query.limit < 1 || query.limit > 100)) ||
      (query.includeReadiness !== undefined && typeof query.includeReadiness !== "boolean"))
    throw new TypeError("Human Resources schedule warning query is invalid.");
  // Without readiness the parameter stays out of the URL, like older clients send it.
  const { includeReadiness, ...scope } = query;
  return includeReadiness ? { ...scope, includeReadiness: true } : scope;
}

function isHumanResourcesScheduleWarningPage(value: unknown,
  query: HumanResourcesScheduleWarningsQuery,
): value is HumanResourcesScheduleWarningPageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["stationId", "from", "to",
      "page", "limit", "hasMore", "asOf", "ruleVersion", "ruleEffectiveOn",
      "warnings"]) || value.stationId !== query.stationId ||
      value.from !== query.from || value.to !== query.to ||
      value.page !== (query.page ?? 1) ||
      value.limit !== (query.limit ?? 20) ||
      typeof value.hasMore !== "boolean" || !isDateTimeOffset(value.asOf) ||
      !isNonEmptyString(value.ruleVersion) ||
      !isDateOnly(value.ruleEffectiveOn) ||
      !Array.isArray(value.warnings) || value.warnings.length > value.limit ||
      (value.hasMore && value.warnings.length !== value.limit)) return false;
  const keys = new Set<string>();
  // The readiness kinds (2-N24) only answer a read that asked for them.
  const kinds: readonly string[] = query.includeReadiness
    ? [...SCHEDULE_WARNING_KINDS, ...SCHEDULE_READINESS_WARNING_KINDS] : SCHEDULE_WARNING_KINDS;
  return value.warnings.every(warning => {
    if (!isRecord(warning) || !hasOnlyKeys(warning, [
      "anchorShiftId", "rampProfileId", "agentName", "employeeNumber",
      "workDate", "kind", "evidence", "hasRestrictedEvidence",
      "measuredMinutes", "thresholdMinutes", "ruleVersion",
      "ruleEffectiveOn", "reason",
    ]) || !isUuid(warning.anchorShiftId) ||
      !isUuid(warning.rampProfileId) ||
      !isNonEmptyString(warning.agentName) ||
      !isNonEmptyString(warning.employeeNumber) ||
      !isDateOnly(warning.workDate) || warning.workDate < query.from ||
      warning.workDate > query.to ||
      !kinds.includes(String(warning.kind)) ||
      (warning.kind === "DocumentExpired" && !isNonEmptyString(warning.reason)) ||
      !Array.isArray(warning.evidence) ||
      typeof warning.hasRestrictedEvidence !== "boolean" ||
      (warning.measuredMinutes != null &&
        (!isInt32(warning.measuredMinutes) || warning.measuredMinutes < 0)) ||
      (warning.thresholdMinutes != null &&
        (!isInt32(warning.thresholdMinutes) || warning.thresholdMinutes < 0)) ||
      (warning.hasRestrictedEvidence && warning.measuredMinutes != null) ||
      (warning.kind === "Unevaluable" &&
        (warning.measuredMinutes != null || !isNonEmptyString(warning.reason))) ||
      (warning.reason != null && !isNonEmptyString(warning.reason)) ||
      warning.ruleVersion !== value.ruleVersion ||
      warning.ruleEffectiveOn !== value.ruleEffectiveOn) return false;
    const key = `${warning.anchorShiftId}:${warning.kind}`;
    if (keys.has(key)) return false;
    keys.add(key);
    const evidenceIds = new Set<string>();
    return warning.evidence.every(evidence => {
      if (!isRecord(evidence) || !hasOnlyKeys(evidence,
          ["shiftId", "stationId", "stationCode", "startsAt", "endsAt"]) ||
        !isUuid(evidence.shiftId) || evidenceIds.has(evidence.shiftId) ||
        !isUuid(evidence.stationId) || !isNonEmptyString(evidence.stationCode) ||
        !isDateTimeOffset(evidence.startsAt) ||
        !isDateTimeOffset(evidence.endsAt) ||
        Date.parse(evidence.startsAt) >= Date.parse(evidence.endsAt)) return false;
      evidenceIds.add(evidence.shiftId);
      return true;
    });
  });
}

function isHumanResourcesReportPage(value: unknown, kind: HumanResourcesReportKind,
  query: HumanResourcesReportQuery): value is HumanResourcesReportPage {
    if (!isRecord(value) || !hasOnlyKeys(value, ["stationId", "from", "to",
      "page", "limit", "hasMore", "asOf", "rows", "documentKind",
      "validity"]) ||
      value.stationId !== query.stationId || value.from !== query.from ||
      value.to !== query.to || value.page !== (query.page ?? 1) ||
      value.limit !== (query.limit ?? 20) ||
      (value.documentKind ?? null) !== (query.documentKind ?? null) ||
      (value.validity ?? null) !== (query.validity ?? null) ||
    typeof value.hasMore !== "boolean" || !isDateTimeOffset(value.asOf) ||
    !Array.isArray(value.rows) || value.rows.length > value.limit ||
    (value.hasMore && value.rows.length !== value.limit)) return false;
  return value.rows.every(row => {
    if (!isRecord(row)) return false;
    if (kind === "expirations") return hasOnlyKeys(row, ["id", "rampProfileId",
      "agentName", "employeeNumber", "kind", "code", "expiresOn"]) &&
      isUuid(row.id) && isUuid(row.rampProfileId) &&
      isNonEmptyString(row.agentName) && isNonEmptyString(row.employeeNumber) &&
      isNonEmptyString(row.kind) && isNonEmptyString(row.code) &&
      isDateOnly(row.expiresOn);
    if (kind === "account-movements") return hasOnlyKeys(row, ["id", "accountId",
      "rampProfileId", "agentName", "employeeNumber", "kind", "occurredAt"]) &&
      isUuid(row.id) && isUuid(row.accountId) && isUuid(row.rampProfileId) &&
      isNonEmptyString(row.agentName) && isNonEmptyString(row.employeeNumber) &&
      isNonEmptyString(row.kind) && isDateTimeOffset(row.occurredAt);
    if (kind === "staff-distribution") return hasOnlyKeys(row, ["id",
      "rampProfileId", "agentName", "employeeNumber", "terminalId",
      "terminalCode", "positionCode", "workDate", "startsAtLocal",
      "endsAtLocal"]) && isUuid(row.id) && isUuid(row.rampProfileId) &&
      isUuid(row.terminalId) && isNonEmptyString(row.agentName) &&
      isNonEmptyString(row.employeeNumber) && isNonEmptyString(row.terminalCode) &&
      (row.positionCode === null || row.positionCode === undefined ||
        typeof row.positionCode === "string") && isDateOnly(row.workDate) &&
      typeof row.startsAtLocal === "string" && typeof row.endsAtLocal === "string";
    return hasOnlyKeys(row, ["equipmentTypeId", "equipmentCode",
      "equipmentName", "eligibleAgents", "qualifiedAgents"]) &&
      isUuid(row.equipmentTypeId) && isNonEmptyString(row.equipmentCode) &&
      isNonEmptyString(row.equipmentName) && isInt32(row.eligibleAgents) &&
      row.eligibleAgents >= 0 && isInt32(row.qualifiedAgents) &&
      row.qualifiedAgents >= 0 && row.qualifiedAgents <= row.eligibleAgents;
  });
}

function validatedAttendanceValidationRequest(
  request: ValidateAttendanceRequest,
): ValidateAttendanceRequest {
  if (!isRecord(request) || !hasOnlyKeys(request, [
    "expectedOccRevision", "expectedRampAgentRevision",
    "startSource", "endSource", "reason",
  ]) || !isInt32(request.expectedOccRevision) ||
    request.expectedOccRevision < 1 || !isInt32(request.expectedRampAgentRevision) ||
    request.expectedRampAgentRevision < 1 ||
    !["Occ", "RampAgent"].includes(request.startSource as string) ||
    !["Occ", "RampAgent"].includes(request.endSource as string) ||
    (request.reason != null && (typeof request.reason !== "string" ||
      request.reason.length > 1_000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request.reason))))
    throw new TypeError("Attendance validation request is invalid.");
  return request;
}

function validatedRampOperationSubmissionRequest(
  request: SubmitRampOperationRequest,
): SubmitRampOperationRequest {
  if (!isRecord(request) || !hasOnlyKeys(request, ["agentNote"])) {
    throw new TypeError("Ramp operation submission is invalid.");
  }
  if (request.agentNote === null || request.agentNote === undefined) return {};
  if (
    typeof request.agentNote !== "string" ||
    request.agentNote.length > 2_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request.agentNote)
  ) throw new TypeError("Ramp operation note is invalid.");
  const note = request.agentNote.trim();
  return note.length > 0 ? { agentNote: note } : {};
}

function validatedUuid(value: string, field: string) {
  if (!isUuid(value)) {
    throw new TypeError(`${field} must be a non-empty canonical UUID.`);
  }
  return value.toLowerCase();
}

function isStrongEtag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.trim() === value &&
    value.startsWith('"') &&
    value.endsWith('"') &&
    !value.startsWith('W/"') &&
    !/["\u0000-\u0020\u007f]/.test(value.slice(1, -1))
  );
}

function validatedStrongEtag(value: string) {
  if (!isStrongEtag(value)) {
    throw new TypeError("etag must be the strong OCC ETag returned by the API.");
  }

  return value;
}

function validatedAccessToken(value: AccessToken) {
  if (value === null || value === undefined || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError("getAccessToken returned an invalid access token.");
  }
  return value;
}

export function createElevantApiClient(options: ElevantApiClientOptions): ElevantApiClient {
  const baseUrl = validatedBaseUrl(options.baseUrl);
  const defaultHeaders = headersFrom(options.defaultHeaders, "defaultHeaders");
  if (defaultHeaders.has("authorization")) {
    throw new TypeError(
      "defaultHeaders must not contain Authorization; use getAccessToken instead.",
    );
  }

  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }
  const getAccessToken = options.getAccessToken;

  const send = async (
    path: string,
    init: ElevantRequestInit = {},
    includeAccessToken = false,
  ): Promise<Response> => {
    const url = validatedRequestUrl(baseUrl, path);
    const headers = mergeHeaders(defaultHeaders, init.headers);
    if (init.body === undefined || init.body === null) headers.delete("content-type");

    if (includeAccessToken && getAccessToken) {
      const token = validatedAccessToken(await getAccessToken());
      if (token) headers.set("authorization", `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await fetchImplementation(url, {
        ...init,
        method: init.method ?? "GET",
        headers,
      });
    } finally {
      headers.delete("authorization");
    }

    if (!validResponse(response)) throw malformedResponse(0);
    if (!response.ok) {
      const metadata = await readProblemMetadata(response);
      throw new ElevantApiError({
        kind: "http",
        status: response.status,
        title: metadata.title,
        traceId: metadata.traceId,
        code: metadata.code,
        reasons: metadata.reasons,
      });
    }

    return response;
  };

  const execute = async (
    path: string, init: ElevantRequestInit = {}, includeAccessToken = false,
  ): Promise<ApiResult> => {
    const response = await send(path, init, includeAccessToken);

    return {
      status: response.status,
      data: await readSuccessBody(response),
      etag: response.headers.get("etag"),
    };
  };

  // A portal account command (phase 1, block E): JSON body, Idempotency-Key and the status the endpoint answers.
  const accountCommand = async <T>(path: string, body: unknown, idempotencyKey: string,
    options: CreateSessionOptions | undefined, status: 200 | 201 | 202, valid: (value: unknown) => value is T): Promise<T> => {
    const headers = headersFrom(options?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
    if (result.status !== status || !valid(result.data)) throw malformedResponse(result.status);
    return result.data;
  };

  const commercialCommand = async (path: string, body: unknown, idempotencyKey: string,
    options: GetHumanResourcesReportOptions | undefined, expectedId: string | undefined) => {
    const headers = headersFrom(options?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
    if (result.status !== 200 || !isCommercialIdResponse(result.data, expectedId)) throw malformedResponse(result.status);
    return result.data;
  };

  // A draft command: JSON body, Idempotency-Key, and the expected status with a CommercialIdResponse.
  const draftCommand = async (method: "POST" | "PUT", path: string, body: unknown, idempotencyKey: string,
    options: GetHumanResourcesReportOptions | undefined, status: 200 | 201, expectedId: string | undefined) => {
    const headers = headersFrom(options?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...options, method, headers, body: JSON.stringify(body) }, true);
    if (result.status !== status || !isCommercialIdResponse(result.data, expectedId)) throw malformedResponse(result.status);
    return result.data;
  };

  // A catalog or closure command: JSON body, Idempotency-Key and the resource the strict validator accepts.
  const catalogCommand = async <T>(method: "POST" | "PUT", path: string, body: unknown, idempotencyKey: string,
    options: GetHumanResourcesReportOptions | undefined, valid: (value: unknown) => value is T): Promise<T> => {
    const headers = headersFrom(options?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...options, method, headers, body: JSON.stringify(body) }, true);
    if (result.status !== 200 || !valid(result.data)) throw malformedResponse(result.status);
    return result.data;
  };

  // A master-data command (phase 2, block C): JSON body, Idempotency-Key, 201 on a creation (200 when the key
  // replays it or on an update) and the record the strict validator accepts.
  const masterDataCommand = async <T>(method: "POST" | "PUT", path: string, body: unknown, idempotencyKey: string,
    options: GetHumanResourcesReportOptions | undefined, valid: (value: unknown) => value is T): Promise<T> => {
    const headers = headersFrom(options?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...options, method, headers, body: JSON.stringify(body) }, true);
    const accepted = method === "POST" ? result.status === 201 || result.status === 200 : result.status === 200;
    if (!accepted || !valid(result.data)) throw malformedResponse(result.status);
    return result.data;
  };

  // A Finance package or amendment command: JSON body, Idempotency-Key and a FinancePackageIdResponse.
  const packageCommand = async (path: string, body: unknown, idempotencyKey: string,
    options: GetHumanResourcesReportOptions | undefined, status: 200 | 201, expectedId: string | undefined) => {
    const headers = headersFrom(options?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
    if (result.status !== status || !isFinancePackageIdResponse(result.data, expectedId)) throw malformedResponse(result.status);
    return result.data;
  };

  const executePdf = async (path: string, init: ElevantRequestInit = {}): Promise<Blob> => {
    const response = await send(path, { ...init, method: "GET" }, true);
    if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/pdf") throw malformedResponse(response.status);
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > 8_388_608)
      throw malformedResponse(response.status);
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw malformedResponse(response.status);
    }
    const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 5));
    if (bytes.byteLength < 8 || bytes.byteLength > 8_388_608 ||
        ![37, 80, 68, 70, 45].every((value, index) => header[index] === value))
      throw malformedResponse(response.status);
    return new Blob([bytes], { type: "application/pdf" });
  };

  const executeReportDocument = async (path: string, format: "pdf" | "xlsx" | "csv",
    init: ElevantRequestInit = {}): Promise<Blob> => {
    const response = await send(path, { ...init, method: "GET" }, true);
    const mime = format === "pdf" ? "application/pdf" : format === "csv" ? "text/csv" :
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== mime)
      throw malformedResponse(response.status);
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > 16_777_216)
      throw malformedResponse(response.status);
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw malformedResponse(response.status);
    }
    const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 5));
    // CSV exports start with the UTF-8 byte order mark.
    const signature = format === "pdf" ? [37, 80, 68, 70, 45] : format === "csv" ? [0xef, 0xbb, 0xbf] : [80, 75];
    if (bytes.byteLength < 8 || bytes.byteLength > 16_777_216 ||
      !signature.every((value, index) => header[index] === value))
      throw malformedResponse(response.status);
    return new Blob([bytes], { type: mime });
  };

  // A positions map command (3-N10): the Idempotency-Key and the turnaround's ETag travel only when the screen sends them.
  const positionCommand = async (path: string, body: unknown,
    options?: GetHumanResourcesReportOptions & OccPositionCommandHeaders, method: "POST" | "PUT" = "POST") => {
    const { ifMatch, idempotencyKey, ...init } = options ?? {};
    const command = validatedPositionHeaders({ ifMatch: ifMatch ?? null, idempotencyKey: idempotencyKey ?? null });
    const headers = headersFrom(init.headers, "Request headers");
    if (body !== undefined) headers.set("content-type", "application/json");
    if (command.idempotencyKey) headers.set("idempotency-key", command.idempotencyKey);
    if (command.ifMatch) headers.set("if-match", command.ifMatch);
    const result = await execute(path, { ...init, method, headers,
      ...(body !== undefined && { body: JSON.stringify(body) }) }, true);
    if (!isOccPositionBoard(result.data)) throw malformedResponse(result.status);
    return result.data;
  };

  // A turnaround detail with its strong ETag; the version in the body is the ETag's value (3-A).
  const turnaroundWithMetadata = (result: ApiResult, turnaroundId: string): OccTurnaroundWithMetadata => {
    const etag = result.etag;
    if (!isOccTurnaroundDetail(result.data, turnaroundId) || !isStrongEntityTag(etag) ||
        etag !== "\"" + result.data.version + "\"")
      throw malformedResponse(result.status);
    return { turnaround: result.data, etag };
  };

  // «Editar vuelo», «Cancelar vuelo» and «Marcar desviado»: the intent's key and the ETag on screen (3-A).
  const turnaroundCommand = async (method: "POST" | "PUT", path: string, turnaroundId: string, body: unknown,
    commandHeaders: OccTurnaroundCommandHeaders, options?: GetHumanResourcesReportOptions) => {
    const { ifMatch, idempotencyKey } = validatedTurnaroundHeaders(commandHeaders);
    const headers = headersFrom(options?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("idempotency-key", idempotencyKey);
    headers.set("if-match", ifMatch);
    const result = await execute(path, { ...options, method, headers, body: JSON.stringify(body) }, true);
    return turnaroundWithMetadata(result, turnaroundId);
  };

  // A coverage command; the intent's Idempotency-Key travels only when the screen sends one (3-J, expand).
  const coverageCommand = async (path: string, body: unknown, options?: OccCoverageCommandOptions,
    method: "POST" | "PUT" | "DELETE" = "POST") => {
    const { idempotencyKey, ...init } = options ?? {};
    const headers = headersFrom(init.headers, "Request headers");
    if (body !== undefined) headers.set("content-type", "application/json");
    if (idempotencyKey != null) headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...init, method, headers,
      ...(body !== undefined && { body: JSON.stringify(body) }) }, true);
    if (!isOccCoverageBoard(result.data)) throw malformedResponse(result.status);
    return result.data;
  };

  const rampExecution = async (path: string, operation: string, body: unknown, installationId: string,
    idempotencyKey: string, options?: ReportRampIncidentOptions) => {
    const headers = headersFrom(options?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("x-elevant-installation-id", validatedUuid(installationId, "installationId"));
    headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...options, method: "PUT", headers, body: JSON.stringify(body) }, true);
    if (!isRampExecutionResponse(result.data, operation)) throw malformedResponse(result.status);
    return result.data;
  };

  const documentWrite = async (path: string, operation: string, body: unknown, installationId: string,
    idempotencyKey: string, options?: ReportRampIncidentOptions) => {
    const headers = headersFrom(options?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("x-elevant-installation-id", validatedUuid(installationId, "installationId"));
    headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...options, method: "PUT", headers, body: JSON.stringify(body) }, true);
    if (!isOperationDocumentsResponse(result.data, operation)) throw malformedResponse(result.status);
    return result.data;
  };

  const charterWrite = async (path: string, method: "POST" | "PUT", operation: string, body: unknown,
    installationId: string, idempotencyKey: string, options?: ReportRampIncidentOptions) => {
    const headers = headersFrom(options?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("x-elevant-installation-id", validatedUuid(installationId, "installationId"));
    headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...options, method, headers, body: JSON.stringify(body) }, true);
    if (!isRampCharterResponse(result.data, operation)) throw malformedResponse(result.status);
    return result.data;
  };

  const reviewChargeWrite = async (path: string, body: unknown, etag: string, options?: DecideOccReviewOptions) => {
    const { idempotencyKey, ...init } = options ?? {};
    const headers = headersFrom(init.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("if-match", validatedStrongEtag(etag));
    if (idempotencyKey != null) headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
    const result = await execute(path, { ...init, method: "POST", headers, body: JSON.stringify(body) }, true);
    if (!isOccReviewChargeAdjustResponse(result.data)) throw malformedResponse(result.status);
    return result.data;
  };

  const executeOccAssignment = async (
    turnaroundId: string,
    request: AssignOccOperationRequest,
    etag: string,
    requestOptions?: AssignOccPlanningOperationOptions,
  ) => {
    const body = validatedOccAssignmentRequest(request);
    const headers = headersFrom(requestOptions?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("if-match", validatedStrongEtag(etag));
    const result = await execute(
      getAssignOccPlanningOperationUrl(
        validatedOccPlanningOptionsParams(turnaroundId).turnaroundId,
      ),
      {
        ...requestOptions,
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      true,
    );
    if (!isOccAssignmentResponse(result.data)) {
      throw malformedResponse(result.status);
    }

    return { assignment: result.data, etag: result.etag, status: result.status };
  };

  return Object.freeze({
    async getAccountChanges(
      parameters?: GetAccountChangesParams,
      options?: GetAccountChangesOptions,
    ) {
      if (parameters !== undefined &&
          (!isRecord(parameters) || !hasOnlyKeys(parameters, ["after", "limit"])))
        throw new TypeError("Change feed parameters are invalid.");
      const after = parameters?.after;
      const limit = parameters?.limit ?? 50;
      if (after !== undefined && !isChangeCursor(after))
        throw new TypeError("Change feed cursor is invalid.");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new TypeError("Change feed limit must be an integer from 1 to 100.");
      const { installationId, ...requestOptions } = options ?? {};
      const headers = headersFrom(requestOptions.headers, "Request headers");
      headers.delete("x-elevant-installation-id");
      if (installationId !== undefined) {
        headers.set("x-elevant-installation-id",
          validatedUuid(installationId, "installationId"));
      }
      const result = await execute(getGetAccountChangesUrl(parameters),
        { ...requestOptions, method: "GET", headers }, true);
      if (!isAccountChangeListResponse(result.data, after, limit))
        throw malformedResponse(result.status);
      return result.data;
    },
    async createSession(request: CreateSessionRequest, options?: CreateSessionOptions) {
      const credentials = validatedSessionRequest(request);
      const result = await execute(
        getCreateSessionUrl(),
        {
          ...options,
          method: "POST",
          headers: {
            ...Object.fromEntries(headersFrom(options?.headers, "Request headers")),
            "content-type": "application/json",
          },
          body: JSON.stringify(credentials),
        },
        false,
      );
      if (!isSessionResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async startSession(request: CreateSessionRequest, options?: CreateSessionOptions): Promise<SessionStart> {
      const result = await execute(getCreateSessionUrl(), jsonPost(options, validatedSessionRequest(request)), false);
      if (isLoginChallengeResponse(result.data)) return { kind: "code_required", challenge: result.data };
      if (!isSessionResponse(result.data)) throw malformedResponse(result.status);
      return { kind: "session", session: result.data };
    },
    async verifyLoginCode(challengeId: string, code: string, options?: CreateSessionOptions) {
      const result = await execute(getVerifyLoginCodeUrl(), jsonPost(options,
        { challengeId: validatedUuid(challengeId, "challengeId"), code: validatedLoginCode(code) }), false);
      if (!isSessionResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async resendLoginCode(challengeId: string, options?: CreateSessionOptions) {
      const result = await execute(getResendLoginCodeUrl(), jsonPost(options,
        { challengeId: validatedUuid(challengeId, "challengeId") }), false);
      if (!isLoginChallengeResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async activateAccount(token: string, newPassword: string, options?: CreateSessionOptions) {
      await execute(getActivatePortalAccountUrl(), jsonPost(options,
        { token: validatedLinkToken(token), newPassword: validatedNewPassword(newPassword) }), false);
    },
    async requestPasswordReset(email: string, options?: CreateSessionOptions) {
      await execute(getRequestPasswordResetUrl(), jsonPost(options, { email: validatedEmailAddress(email) }), false);
    },
    async resetPassword(token: string, newPassword: string, options?: CreateSessionOptions) {
      await execute(getConfirmPasswordResetUrl(), jsonPost(options,
        { token: validatedLinkToken(token), newPassword: validatedNewPassword(newPassword) }), false);
    },
    async resendAirlineInvitation(accountId: string, command: ResendAirlineInvitationCommand, idempotencyKey: string,
      options?: CreateSessionOptions) {
      const id = validatedUuid(accountId, "accountId");
      return accountCommand(getResendAirlineInvitationUrl(id), normalizedInvitationResend(command), idempotencyKey,
        options, 202, value => isCommercialAccountResponse(value, id));
    },
    async getEmailOutbox(query?: EmailOutboxQuery, options?: CreateSessionOptions) {
      const params = normalizedEmailOutboxQuery(query);
      const result = await execute(getListEmailOutboxUrl(params), { ...options, method: "GET",
        headers: Object.fromEntries(headersFrom(options?.headers, "Request headers")) }, true);
      if (!isEmailOutboxPage(result.data, params)) throw malformedResponse(result.status);
      return result.data;
    },
    async listProvisioningTasks(options?: CreateSessionOptions) {
      const result = await execute(getListCommercialProvisioningUrl(), { ...options, method: "GET",
        headers: Object.fromEntries(headersFrom(options?.headers, "Request headers")) }, true);
      if (!isProvisioningTaskList(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async provisionAirlineAccount(requestId: string, command: ProvisionAirlineAccountCommand, idempotencyKey: string,
      options?: CreateSessionOptions) {
      return accountCommand(getProvisionCommercialAirlineUrl(validatedUuid(requestId, "requestId")),
        normalizedProvisioning(command), idempotencyKey, options, 201, value => isCommercialAccountResponse(value));
    },
    async linkProvisioningAccount(requestId: string, command: LinkProvisioningAccountCommand, idempotencyKey: string,
      options?: CreateSessionOptions) {
      return accountCommand(getLinkCommercialAirlineAccountUrl(validatedUuid(requestId, "requestId")),
        normalizedAccountLink(command), idempotencyKey, options, 200, value => isCommercialAccountResponse(value));
    },
    async resetClientUserPassword(organizationId: string, userId: string, command: ResetClientUserPasswordCommand,
      idempotencyKey: string, options?: CreateSessionOptions) {
      const id = validatedUuid(userId, "userId");
      return accountCommand(getResetGovernanceClientUserPasswordUrl(validatedUuid(organizationId, "organizationId"), id),
        normalizedClientPasswordReset(command), idempotencyKey, options, 200, value => isCommercialIdResponse(value, id));
    },
    async getInvoiceEmailDeliveries(invoiceId: string, options?: CreateSessionOptions) {
      const id = validatedUuid(invoiceId, "invoiceId");
      const result = await execute(getGetFinanceInvoiceEmailDeliveriesUrl(id), { ...options, method: "GET",
        headers: Object.fromEntries(headersFrom(options?.headers, "Request headers")) }, true);
      if (!isInvoiceEmailStatus(result.data, id)) throw malformedResponse(result.status);
      return result.data;
    },
    async sendTestEmail(to: string, options?: CreateSessionOptions) {
      const result = await execute(getSendTestEmailUrl(), jsonPost(options, { to: validatedEmailAddress(to) }), true);
      if (!isEmailDeliveryResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async listEmailDeliveries(options?: CreateSessionOptions) {
      const result = await execute(getListEmailDeliveriesUrl(), { ...options, method: "GET",
        headers: Object.fromEntries(headersFrom(options?.headers, "Request headers")) }, true);
      const data = result.data;
      if (!isRecord(data) || typeof data.smtpConfigured !== "boolean" || !Array.isArray(data.deliveries) ||
          !data.deliveries.every(isEmailDeliveryResponse))
        throw malformedResponse(result.status);
      return data as unknown as EmailDeliveriesResponse;
    },
    async refreshSession(refreshToken: string, options?: CreateSessionOptions) {
      const result = await execute(getRefreshSessionUrl(), {
        ...options,
        method: "POST",
        headers: { ...Object.fromEntries(headersFrom(options?.headers, "Request headers")), "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: validatedRefreshToken(refreshToken) }),
      }, false);
      if (!isSessionResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async endSession(refreshToken: string, options?: CreateSessionOptions) {
      await execute(getEndSessionUrl(), {
        ...options,
        method: "POST",
        headers: { ...Object.fromEntries(headersFrom(options?.headers, "Request headers")), "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: validatedRefreshToken(refreshToken) }),
      }, false);
    },
    async changePassword(request: ChangePasswordRequest, options?: ChangePasswordOptions) {
      const body = validatedChangePasswordRequest(request);
      const result = await execute(
        getChangePasswordUrl(),
        {
          ...options,
          method: "POST",
          headers: {
            ...Object.fromEntries(headersFrom(options?.headers, "Request headers")),
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
        false,
      );
      if (result.status !== 204 || result.data !== undefined) {
        throw malformedResponse(result.status);
      }
    },
    async getCurrentSession(options?: GetCurrentSessionOptions) {
      const result = await execute(
        getGetCurrentSessionUrl(),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isCurrentSessionResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlinePortalBootstrap(options?: GetAirlinePortalBootstrapOptions) {
      const result = await execute(
        getGetAirlinePortalBootstrapUrl(),
        { ...options, method: "GET" },
        true,
      );
      if (!isAirlinePortalBootstrapResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getAirlineContracts(
      parameters: GetAirlineContractsParams = {}, options?: GetAirlineContractsOptions,
    ) {
      const paging = validatedAirlineContractParams(parameters);
      const result = await execute(
        getGetAirlineContractsUrl(paging), { ...options, method: "GET" }, true,
      );
      if (!isAirlineContractPageResponse(result.data) ||
        result.data.page !== (paging.page ?? 1) ||
        result.data.limit !== (paging.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlineOperations(
      parameters: GetAirlineOperationsParams = {}, options?: GetAirlineOperationsOptions,
    ) {
      const paging = validatedAirlineOperationParams(parameters);
      const result = await execute(
        getGetAirlineOperationsUrl(paging), { ...options, method: "GET" }, true,
      );
      if (!isAirlineOperationPageResponse(result.data) ||
        result.data.page !== (paging.page ?? 1) ||
        result.data.limit !== (paging.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlineOperation(operationId: string, options?: GetAirlineOperationOptions) {
      if (!isUuid(operationId)) throw new TypeError("Operation ID must be a UUID.");
      const result = await execute(
        getGetAirlineOperationUrl(operationId), { ...options, method: "GET" }, true,
      );
      if (!isAirlineOperationDetailResponse(result.data) || result.data.id !== operationId)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlineApprovedOperationEvidence(
      operationId: string, options?: GetAirlineApprovedOperationEvidenceOptions,
    ) {
      if (!isUuid(operationId)) throw new TypeError("Operation ID must be a UUID.");
      const result = await execute(
        getGetAirlineApprovedOperationEvidenceUrl(operationId),
        { ...options, method: "GET" }, true,
      );
      if (!isAirlineApprovedOperationEvidenceResponse(result.data) ||
          result.data.operationId !== operationId)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlineOperationalRequests(
      parameters: GetAirlineOperationalRequestsParams = {},
      options?: GetAirlineOperationalRequestsOptions,
    ) {
      const paging = validatedAirlineRequestParams(parameters);
      const result = await execute(getGetAirlineOperationalRequestsUrl(paging),
        { ...options, method: "GET" }, true);
      if (!isAirlineOperationalRequestPageResponse(result.data) ||
          result.data.page !== (paging.page ?? 1) ||
          result.data.limit !== (paging.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlinePreinvoices(
      parameters: GetAirlinePreinvoicesParams = {},
      options?: GetAirlinePreinvoicesOptions,
    ) {
      const paging = validatedAirlinePreinvoiceParams(parameters);
      const result = await execute(getGetAirlinePreinvoicesUrl({ ...paging, includeVoided: true }),
        { ...options, method: "GET" }, true);
      if (!isAirlinePreinvoicePageResponse(result.data) ||
          result.data.page !== (paging.page ?? 1) ||
          result.data.limit !== (paging.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlinePreinvoice(
      preinvoiceId: string, options?: GetAirlinePreinvoiceOptions,
    ) {
      if (!isUuid(preinvoiceId)) throw new TypeError("Preinvoice ID must be a UUID.");
      const result = await execute(getGetAirlinePreinvoiceUrl(preinvoiceId, { includeVoided: true }),
        { ...options, method: "GET" }, true);
      if (!isAirlinePreinvoiceDetailResponse(result.data) ||
          result.data.id !== preinvoiceId) throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlinePreinvoiceDisputes(
      preinvoiceId: string, options?: GetPreinvoiceDisputesOptions,
    ) {
      const id = validatedUuid(preinvoiceId, "preinvoiceId");
      const result = await execute(getGetAirlinePreinvoiceDisputesUrl(id, { includeResolutions: true }),
        { ...options, method: "GET" }, true);
      if (!isPreinvoiceDisputeListResponse(result.data, id))
        throw malformedResponse(result.status);
      return result.data;
    },
    async acceptAirlinePreinvoice(
      preinvoiceId: string, request: AcceptAirlinePreinvoiceRequest,
      options?: AcceptAirlinePreinvoiceOptions,
    ) {
      const id = validatedUuid(preinvoiceId, "preinvoiceId");
      if (!isRecord(request) || !hasOnlyKeys(request, ["requestId"]) ||
          !isUuid(request.requestId))
        throw new TypeError("Preinvoice acceptance request is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getAcceptAirlinePreinvoiceUrl(id),
        { ...options, method: "POST", headers, body: JSON.stringify(request) }, true);
      if (!isAcceptAirlinePreinvoiceResponse(result.data) || result.data.id !== id)
        throw malformedResponse(result.status);
      return result.data;
    },
    async disputeAirlinePreinvoice(
      preinvoiceId: string, request: DisputeAirlinePreinvoiceRequest,
      options?: DisputeAirlinePreinvoiceOptions,
    ) {
      const id = validatedUuid(preinvoiceId, "preinvoiceId");
      if (!isRecord(request) || !hasOnlyKeys(request,
          ["requestId", "subject", "description", "lineIds"]) ||
          !isUuid(request.requestId) ||
          !isNonEmptyString(request.subject) || request.subject.trim() !== request.subject ||
          request.subject.length > 160 ||
          !isNonEmptyString(request.description) ||
          request.description.trim() !== request.description ||
          request.description.length > 1000 ||
          !Array.isArray(request.lineIds) || request.lineIds.length < 1 ||
          request.lineIds.length > 50 ||
          request.lineIds.some(lineId => !isUuid(lineId)) ||
          new Set(request.lineIds).size !== request.lineIds.length)
        throw new TypeError("Preinvoice dispute request is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getDisputeAirlinePreinvoiceUrl(id),
        { ...options, method: "POST", headers, body: JSON.stringify(request) }, true);
      if (!isDisputeAirlinePreinvoiceResponse(result.data) || result.data.id !== id)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getManagedContracts(
      parameters: ListManagedContractsParams = {}, options?: GetManagedContractsOptions,
    ) {
      const paging = validatedManagedContractParams(parameters);
      const result = await execute(getListManagedContractsUrl(paging),
        { ...options, method: "GET" }, true);
      if (!isManagedContractPageData(result.data) ||
          result.data.page !== (paging.page ?? 1) ||
          result.data.limit !== (paging.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getPublicCommercialCatalog(options?: GetPublicCommercialCatalogOptions) {
      const result = await execute(getGetPublicCommercialCatalogUrl(),
        { ...options, method: "GET" });
      if (!isPublicCommercialCatalog(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async submitCommercialRequest(
      request: SubmitCommercialRequestRequest,
      options?: SubmitCommercialRequestOptions,
    ) {
      const body = validatedCommercialRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getSubmitCommercialRequestUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(body) });
      if (!isCommercialRequestReceipt(result.data) ||
        result.status !== (result.data.replayed ? 200 : 201))
        throw malformedResponse(result.status);
      return result.data;
    },
    async lookupCommercialRequestReceipt(
      request: SubmitCommercialRequestRequest,
      options?: SubmitCommercialRequestOptions,
    ) {
      const body = validatedCommercialRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getLookupCommercialRequestReceiptUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(body) });
      if (!isCommercialRequestReceipt(result.data) || result.status !== 200 ||
          result.data.replayed !== true)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getFinanceApprovedServices(
      query: FinanceApprovedServicesQuery,
      options?: GetFinanceApprovedServicesOptions,
    ) {
      const scope = validatedFinanceApprovedServicesQuery(query);
      const result = await execute(getGetFinanceApprovedServicesUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isFinanceApprovedServicesResponse(result.data) ||
          result.data.stationId !== scope.stationId ||
          result.data.from !== scope.from || result.data.to !== scope.to)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getFinancePreinvoices(
      query: ListFinancePreinvoicesParams,
      options?: GetFinancePreinvoicesOptions,
    ) {
      const scope = validatedFinancePreinvoiceQuery(query);
      const result = await execute(getListFinancePreinvoicesUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isFinancePreinvoicePageData(result.data) ||
          result.data.page !== (scope.page ?? 1) ||
          result.data.limit !== (scope.limit ?? 20) ||
          result.data.preinvoices.some(item => item.stationId !== scope.stationId))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getFinanceTariffs(
      query: ListFinanceTariffsParams,
      options?: GetFinanceTariffsOptions,
    ) {
      const scope = validatedFinanceTariffQuery(query);
      const result = await execute(getListFinanceTariffsUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isFinanceTariffPageData(result.data) ||
          result.data.stationId !== scope.stationId ||
          result.data.page !== (scope.page ?? 1) ||
          result.data.limit !== (scope.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getHumanResourcesQualifications(
      query?: ListHumanResourcesQualificationsParams,
      options?: GetHumanResourcesQualificationsOptions,
    ) {
      const paging = validatedHumanResourcesQualificationQuery(query);
      const result = await execute(getListHumanResourcesQualificationsUrl(paging),
        { ...options, method: "GET" }, true);
      if (!isHumanResourcesQualificationPage(result.data) ||
          result.data.page !== (paging.page ?? 1) ||
          result.data.limit !== (paging.limit ?? 50) ||
          (paging.rampProfileId !== undefined && paging.equipmentTypeId !== undefined &&
            (result.data.hasMore || result.data.qualifications.length > 1)) ||
          result.data.qualifications.some(item =>
            (paging.rampProfileId !== undefined &&
              item.rampProfileId.toLowerCase() !== paging.rampProfileId.toLowerCase()) ||
            (paging.equipmentTypeId !== undefined &&
              item.equipmentTypeId.toLowerCase() !== paging.equipmentTypeId.toLowerCase()) ||
            (paging.validity !== undefined && item.validity !== paging.validity)))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getHumanResourcesQualificationEquipmentTypes(
      options?: GetHumanResourcesQualificationEquipmentTypesOptions,
    ) {
      const result = await execute(getListHumanResourcesQualificationEquipmentTypesUrl(),
        { ...options, method: "GET" }, true);
      if (!isHumanResourcesQualificationEquipmentTypes(result.data))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getHumanResourcesQualificationSummary(
      query?: SummarizeHumanResourcesQualificationsParams,
      options?: GetHumanResourcesDocumentSummaryOptions,
    ) {
      const scope = validatedHumanResourcesDocumentSummaryQuery(query, "equipmentTypeId");
      const result = await execute(getSummarizeHumanResourcesQualificationsUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isHumanResourcesDocumentSummary(result.data, scope.asOf))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getHumanResourcesQualificationHistory(
      id: string,
      options?: GetHumanResourcesDocumentHistoryOptions,
    ) {
      const qualificationId = validatedUuid(id, "Qualification ID");
      const result = await execute(getGetHumanResourcesQualificationHistoryUrl(qualificationId),
        { ...options, method: "GET" }, true);
      const data = result.data;
      if (!isRecord(data) || !hasOnlyKeys(data, ["rampProfileId", "agentName", "employeeNumber",
        "equipmentTypeId", "equipmentCode", "equipmentName", "cycles"]) ||
          !isUuid(data.rampProfileId) || !isNonEmptyString(data.agentName) ||
          !isNonEmptyString(data.employeeNumber) || !isUuid(data.equipmentTypeId) ||
          !isNonEmptyString(data.equipmentCode) || !isNonEmptyString(data.equipmentName) ||
          !isHumanResourcesDocumentCycles(data.cycles, ["id", "cycleNumber", "isCurrent",
            "trainingDate", "obtainedOn", "expiresOn", "certifyingEntity", "instructorName",
            "notes", "recordedAt", "recordedByName"], item =>
            isDateOnly(item.trainingDate) && isDateOnly(item.obtainedOn) &&
            isDateOnly(item.expiresOn) && item.trainingDate <= item.obtainedOn &&
            item.obtainedOn <= item.expiresOn && isNonEmptyString(item.certifyingEntity) &&
            isNonEmptyString(item.instructorName) &&
            (item.notes == null || typeof item.notes === "string")) ||
          !(data.cycles as Array<{ id: string }>).some(cycle =>
            cycle.id.toLowerCase() === qualificationId))
        throw malformedResponse(result.status);
      return data as unknown as HumanResourcesQualificationHistory;
    },
    async recordHumanResourcesQualification(
      id: string,
      request: RecordHumanResourcesQualificationInput,
      options?: RecordHumanResourcesQualificationOptions,
    ) {
      const qualificationId = validatedUuid(id, "Qualification ID");
      const body = validatedHumanResourcesQualificationInput(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getRecordHumanResourcesQualificationUrl(qualificationId),
        { ...options, method: "PUT", headers, body: JSON.stringify(body) }, true);
      if (result.status !== 200 || !isRecord(result.data) ||
          !hasOnlyKeys(result.data, ["id", "cycleNumber"]) ||
          !isUuid(result.data.id) || result.data.id.toLowerCase() !== qualificationId ||
          !isInt32(result.data.cycleNumber) || result.data.cycleNumber < 1)
        throw malformedResponse(result.status);
      return result.data as unknown as HumanResourcesQualificationRecorded;
    },
    async getHumanResourcesPermits(
      query?: ListHumanResourcesPermitsParams,
      options?: GetHumanResourcesPermitsOptions,
    ) {
      const paging = validatedHumanResourcesPermitQuery(query);
      const result = await execute(getListHumanResourcesPermitsUrl(paging),
        { ...options, method: "GET" }, true);
      if (!isHumanResourcesPermitPage(result.data) ||
          result.data.page !== (paging.page ?? 1) ||
          result.data.limit !== (paging.limit ?? 50) ||
          (paging.rampProfileId !== undefined && paging.documentType !== undefined &&
            (result.data.hasMore || result.data.permits.length > 1)) ||
          result.data.permits.some(item =>
            (paging.rampProfileId !== undefined &&
              item.rampProfileId.toLowerCase() !== paging.rampProfileId.toLowerCase()) ||
            (paging.documentType !== undefined && item.documentType !== paging.documentType) ||
            (paging.validity !== undefined && item.validity !== paging.validity)))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getHumanResourcesPermitSummary(
      query?: SummarizeHumanResourcesPermitsParams,
      options?: GetHumanResourcesDocumentSummaryOptions,
    ) {
      const scope = validatedHumanResourcesDocumentSummaryQuery(query, "documentType");
      const result = await execute(getSummarizeHumanResourcesPermitsUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isHumanResourcesDocumentSummary(result.data, scope.asOf))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getHumanResourcesPermitHistory(
      id: string,
      options?: GetHumanResourcesDocumentHistoryOptions,
    ) {
      const permitId = validatedUuid(id, "Permit ID");
      const result = await execute(getGetHumanResourcesPermitHistoryUrl(permitId),
        { ...options, method: "GET" }, true);
      const data = result.data;
      if (!isRecord(data) || !hasOnlyKeys(data,
        ["rampProfileId", "agentName", "employeeNumber", "documentType", "cycles"]) ||
          !isUuid(data.rampProfileId) || !isNonEmptyString(data.agentName) ||
          !isNonEmptyString(data.employeeNumber) || typeof data.documentType !== "string" ||
          !["AirportId", "RampDriverLicense"].includes(data.documentType) ||
          !isHumanResourcesDocumentCycles(data.cycles, ["id", "cycleNumber", "isCurrent",
            "documentNumber", "issuedOn", "expiresOn", "recordedAt", "recordedByName"], item =>
            isNonEmptyString(item.documentNumber) && isDateOnly(item.issuedOn) &&
            isDateOnly(item.expiresOn) && item.issuedOn <= item.expiresOn) ||
          !(data.cycles as Array<{ id: string }>).some(cycle => cycle.id.toLowerCase() === permitId))
        throw malformedResponse(result.status);
      return data as unknown as HumanResourcesPermitHistory;
    },
    async recordHumanResourcesPermit(
      id: string,
      request: RecordHumanResourcesPermitInput,
      options?: RecordHumanResourcesPermitOptions,
    ) {
      const permitId = validatedUuid(id, "Permit ID");
      const body = validatedHumanResourcesPermitInput(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getRecordHumanResourcesPermitUrl(permitId),
        { ...options, method: "PUT", headers, body: JSON.stringify(body) }, true);
      if (result.status !== 200 || !isRecord(result.data) ||
          !hasOnlyKeys(result.data, ["id", "cycleNumber"]) ||
          !isUuid(result.data.id) || result.data.id.toLowerCase() !== permitId ||
          !isInt32(result.data.cycleNumber) || result.data.cycleNumber < 1)
        throw malformedResponse(result.status);
      return result.data as unknown as HumanResourcesPermitRecorded;
    },
    async getHumanResourcesShifts(
      query: HumanResourcesShiftsQuery,
      options?: GetHumanResourcesShiftsOptions,
    ) {
      const scope = validatedHumanResourcesShiftsQuery(query);
      const result = await execute(getListHumanResourcesShiftsUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isHumanResourcesShiftPage(result.data) ||
          result.data.from !== scope.from || result.data.to !== scope.to ||
          result.data.page !== (scope.page ?? 1) ||
          result.data.limit !== (scope.limit ?? 50))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getHumanResourcesScheduleWarnings(
      query: HumanResourcesScheduleWarningsQuery,
      options?: GetHumanResourcesScheduleWarningsOptions,
    ) {
      const scope = validatedHumanResourcesScheduleWarningsQuery(query);
      const result = await execute(getListHumanResourcesScheduleWarningsUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isHumanResourcesScheduleWarningPage(result.data, scope))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getHumanResourcesAvailabilityRequests(
      query: HumanResourcesAvailabilityQuery,
      options?: GetHumanResourcesAvailabilityRequestsOptions,
    ) {
      const scope = validatedHumanResourcesAvailabilityQuery(query);
      const result = await execute(getListHumanResourcesAvailabilityRequestsUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isHumanResourcesAvailabilityRequestPage(result.data) ||
          result.data.from !== scope.from || result.data.to !== scope.to ||
          result.data.page !== (scope.page ?? 1) ||
          result.data.limit !== (scope.limit ?? 50))
        throw malformedResponse(result.status);
      return result.data;
    },
    async recordHumanResourcesAvailabilityRequest(
      id: string,
      request: RecordHumanResourcesAvailabilityInput,
      options?: RecordHumanResourcesAvailabilityOptions,
    ) {
      const requestId = validatedUuid(id, "Availability request ID");
      const body = validatedHumanResourcesAvailabilityInput(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getRecordHumanResourcesAvailabilityRequestUrl(requestId),
        { ...options, method: "PUT", headers, body: JSON.stringify(body) }, true);
      if (result.status !== 200 || !isHumanResourcesAvailabilityWritten(result.data,
        requestId, ["Pending", "Approved", "Rejected"]))
        throw malformedResponse(result.status);
      return result.data;
    },
    async resolveHumanResourcesAvailabilityRequest(
      id: string,
      request: ResolveHumanResourcesAvailabilityInput,
      idempotencyKey?: string | null,
      options?: ResolveHumanResourcesAvailabilityOptions,
    ) {
      const requestId = validatedUuid(id, "Availability request ID");
      const body = validatedHumanResourcesAvailabilityResolution(request);
      // A key needs the version on screen, like the server asks (expected_version_required).
      if (idempotencyKey != null && body.expectedVersion == null)
        throw new TypeError("A keyed availability decision needs the version on screen.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      if (idempotencyKey != null) headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getResolveHumanResourcesAvailabilityRequestUrl(requestId),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (result.status !== 200 || !isHumanResourcesAvailabilityWritten(result.data,
        requestId, [{ Approve: "Approved", Reject: "Rejected", Cancel: "Cancelled" }[
          body.decision as "Approve" | "Reject" | "Cancel"]]))
        throw malformedResponse(result.status);
      return result.data;
    },
    async amendHumanResourcesAvailabilityRequest(
      id: string,
      command: AmendHumanResourcesAvailabilityCommand,
      idempotencyKey: string,
      options?: ResolveHumanResourcesAvailabilityOptions,
    ) {
      const requestId = validatedUuid(id, "Availability request ID");
      const body = normalizedAvailabilityAmendment(command);
      return catalogCommand("POST", getAmendHumanResourcesAvailabilityRequestUrl(requestId), body, idempotencyKey,
        options, (value): value is HumanResourcesAvailabilityAmended =>
          isHumanResourcesAvailabilityAmended(value, requestId, body));
    },
    async getHumanResourcesShiftAssignmentOptions(
      query: HumanResourcesShiftAssignmentQuery,
      options?: GetHumanResourcesShiftAssignmentOptionsOptions,
    ) {
      const scope = validatedHumanResourcesShiftAssignmentQuery(query);
      const result = await execute(getGetHumanResourcesShiftAssignmentOptionsUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isHumanResourcesShiftAssignmentOptions(result.data, scope))
        throw malformedResponse(result.status);
      return result.data;
    },
    async recordHumanResourcesShift(
      id: string,
      request: RecordHumanResourcesShiftInput,
      options?: RecordHumanResourcesShiftOptions,
    ) {
      const shiftId = validatedUuid(id, "Shift ID");
      const body = validatedHumanResourcesShiftInput(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getRecordHumanResourcesShiftUrl(shiftId),
        { ...options, method: "PUT", headers, body: JSON.stringify(body) }, true);
      if (result.status !== 200 || !isRecord(result.data) ||
          !hasOnlyKeys(result.data, ["id"]) || !isUuid(result.data.id) ||
          result.data.id.toLowerCase() !== shiftId)
        throw malformedResponse(result.status);
      return result.data as unknown as HumanResourcesShiftRecorded;
    },
    async removeHumanResourcesShift(id: string, expectedVersion?: string | null, idempotencyKey?: string | null,
      options?: GetHumanResourcesReportOptions) {
      const shiftId = validatedUuid(id, "Shift ID");
      if (expectedVersion != null && !isRecordVersion(expectedVersion))
        throw new TypeError("The shift version is invalid.");
      // A key needs the version on screen, like the server asks (expected_version_required).
      if (idempotencyKey != null && expectedVersion == null)
        throw new TypeError("A keyed shift removal needs the version on screen.");
      const headers = headersFrom(options?.headers, "Request headers");
      if (idempotencyKey != null) headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getRemoveHumanResourcesShiftUrl(shiftId,
        expectedVersion == null ? undefined : { version: expectedVersion }), { ...options, method: "DELETE", headers }, true);
      if (result.status !== 204) throw malformedResponse(result.status);
    },
    async adjustHumanResourcesShift(id: string, command: AdjustHumanResourcesShiftCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const shiftId = validatedUuid(id, "Shift ID");
      const body = validatedShiftAdjustment(command);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getAdjustHumanResourcesShiftUrl(shiftId),
        { ...options, method: "PATCH", headers, body: JSON.stringify(body) }, true);
      if (result.status !== 200 || !isHumanResourcesShiftAdjusted(result.data, shiftId)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOccAssignmentReadiness(query: OccAssignmentReadinessQuery, options?: GetHumanResourcesReportOptions) {
      const scope = validatedOccAssignmentReadinessQuery(query);
      const result = await execute(getGetOccAssignmentReadinessUrl(scope), { ...options, method: "GET" }, true);
      if (!isOccAssignmentReadiness(result.data, scope)) throw malformedResponse(result.status);
      return result.data;
    },
    async listRampAgentReadiness(options?: GetHumanResourcesReportOptions) {
      const result = await execute(getListRampAgentReadinessUrl(), { ...options, method: "GET" }, true);
      if (!Array.isArray(result.data) || !result.data.every(isRampAgentReadiness)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOwnRampSchedule(from: string, to: string, options?: GetHumanResourcesReportOptions) {
      if (!isDateOnly(from) || !isDateOnly(to) || to < from) throw new TypeError("Schedule range is invalid.");
      const result = await execute(getGetOwnRampScheduleUrl({ from, to }), { ...options, method: "GET" }, true);
      if (!isRampAgentSchedule(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async getFinanceReconciliation(
      query: ListFinanceReconciliationParams,
      options?: GetFinanceReconciliationOptions,
    ) {
      const scope = validatedFinanceReconciliationQuery(query);
      const result = await execute(getListFinanceReconciliationUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isFinanceReconciliationPageData(result.data) ||
          result.data.stationId !== scope.stationId ||
          result.data.page !== (scope.page ?? 1) ||
          result.data.limit !== (scope.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async createPreinvoiceDraft(
      request: CreatePreinvoiceDraftRequest,
      options?: CreatePreinvoiceDraftOptions,
    ) {
      const selection = validatedPreinvoiceDraftRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getCreatePreinvoiceDraftUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(selection) }, true);
      if (!isPreinvoiceDraftCreateResponse(result.data))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getPreinvoiceDraft(
      draftId: string, expectedStationId: string,
      options?: GetPreinvoiceDraftOptions,
    ) {
      const draft = validatedUuid(draftId, "draftId");
      const station = validatedUuid(expectedStationId, "expectedStationId");
      const result = await execute(getGetPreinvoiceDraftUrl(draft),
        { ...options, method: "GET" }, true);
      if (!isPreinvoiceDraftResponse(result.data) ||
          result.data.id !== draft || result.data.stationId !== station)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getFinancePreinvoiceDisputes(
      draftId: string, options?: GetPreinvoiceDisputesOptions,
    ) {
      const id = validatedUuid(draftId, "draftId");
      const result = await execute(getGetFinancePreinvoiceDisputesUrl(id, { includeResolutions: true }),
        { ...options, method: "GET" }, true);
      if (!isPreinvoiceDisputeListResponse(result.data, id))
        throw malformedResponse(result.status);
      return result.data;
    },
    async resolveFinancePreinvoiceDispute(
      preinvoiceId: string, request: ResolvePreinvoiceDisputeRequest,
      options?: ResolvePreinvoiceDisputeOptions,
    ) {
      const id = validatedUuid(preinvoiceId, "preinvoiceId");
      if (!isRecord(request) || !hasOnlyKeys(request,
          ["requestId", "decision", "reason"]) || !isUuid(request.requestId) ||
          (request.decision !== "Maintain" && request.decision !== "Void") ||
          !isNonEmptyString(request.reason) || request.reason.trim() !== request.reason ||
          request.reason.length > 1000)
        throw new TypeError("Dispute resolution request is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getResolveFinancePreinvoiceDisputeUrl(id),
        { ...options, method: "POST", headers, body: JSON.stringify(request) }, true);
      if (!isResolvePreinvoiceDisputeResponse(result.data, id, request.decision))
        throw malformedResponse(result.status);
      return result.data;
    },
    async issueFinanceInvoice(
      request: IssueFinanceInvoiceRequest, options?: IssueFinanceInvoiceOptions,
    ) {
      if (!isRecord(request) || !hasOnlyKeys(request, ["preinvoiceId", "requestId"]) ||
          !isUuid(request.preinvoiceId) || !isUuid(request.requestId))
        throw new TypeError("Invoice issuance request is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getIssueFinanceInvoiceUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(request) }, true);
      if (!isIssueFinanceInvoiceResponse(result.data, request))
        throw malformedResponse(result.status);
      return result.data;
    },
    async issueInvoiceFromOperations(
      request: IssueInvoiceFromOperationsRequest, options?: IssueInvoiceFromOperationsOptions,
    ) {
      const body = validatedIssueInvoiceFromOperationsRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getIssueInvoiceFromOperationsUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (!isIssuedInvoiceResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async getFinanceInvoiceByPreinvoice(
      preinvoiceId: string, options?: GetNonFiscalInvoiceOptions,
    ) {
      const id = validatedUuid(preinvoiceId, "preinvoiceId");
      const result = await execute(getGetFinanceInvoiceByPreinvoiceUrl(id),
        { ...options, method: "GET" }, true);
      if (!isNonFiscalInvoiceResponse(result.data, id))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlineInvoiceByPreinvoice(
      preinvoiceId: string, options?: GetNonFiscalInvoiceOptions,
    ) {
      const id = validatedUuid(preinvoiceId, "preinvoiceId");
      const result = await execute(getGetAirlineInvoiceByPreinvoiceUrl(id),
        { ...options, method: "GET" }, true);
      if (!isNonFiscalInvoiceResponse(result.data, id))
        throw malformedResponse(result.status);
      return result.data;
    },
    async recordNonFiscalPayment(
      request: RecordNonFiscalPaymentRequest, options?: RecordNonFiscalPaymentOptions,
    ) {
      if (!isRecord(request) || !hasOnlyKeys(request,
          ["invoiceId", "requestId", "reference"]) ||
          !isUuid(request.invoiceId) || !isUuid(request.requestId) ||
          !isPaymentReference(request.reference))
        throw new TypeError("Payment request is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getRecordNonFiscalPaymentUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(request) }, true);
      if (!isRecordNonFiscalPaymentResponse(result.data, request))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getFinancePaymentByInvoice(
      invoiceId: string, options?: GetNonFiscalPaymentOptions,
    ) {
      const id = validatedUuid(invoiceId, "invoiceId");
      const result = await execute(getGetFinancePaymentByInvoiceUrl(id),
        { ...options, method: "GET" }, true);
      if (!isNonFiscalPaymentLookupResponse(result.data, id))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlinePaymentByInvoice(
      invoiceId: string, options?: GetNonFiscalPaymentOptions,
    ) {
      const id = validatedUuid(invoiceId, "invoiceId");
      const result = await execute(getGetAirlinePaymentByInvoiceUrl(id),
        { ...options, method: "GET" }, true);
      if (!isNonFiscalPaymentLookupResponse(result.data, id))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlineInvoiceStatement(
      invoiceId: string, options?: GetNonFiscalPaymentOptions,
    ) {
      const id = validatedUuid(invoiceId, "invoiceId");
      const result = await execute(getGetAirlineInvoiceStatementUrl(id),
        { ...options, method: "GET" }, true);
      if (!isAirlineInvoiceStatementResponse(result.data, id))
        throw malformedResponse(result.status);
      return result.data;
    },
    getAirlineInvoiceDocument(preinvoiceId: string, options?: GetFinancialDocumentOptions) {
      const id = validatedUuid(preinvoiceId, "preinvoiceId");
      return executePdf(getGetAirlineInvoiceDocumentUrl(id), options);
    },
    getAirlinePaymentReceipt(invoiceId: string, options?: GetFinancialDocumentOptions) {
      const id = validatedUuid(invoiceId, "invoiceId");
      return executePdf(getGetAirlinePaymentReceiptUrl(id), options);
    },
    getFinanceInvoiceDocument(preinvoiceId: string, options?: GetFinancialDocumentOptions) {
      const id = validatedUuid(preinvoiceId, "preinvoiceId");
      return executePdf(getGetFinanceInvoiceDocumentUrl(id), options);
    },
    getFinanceInvoiceDocumentById(invoiceId: string, options?: GetFinancialDocumentOptions) {
      const id = validatedUuid(invoiceId, "invoiceId");
      return executePdf(getGetFinanceInvoiceDocumentByIdUrl(id), options);
    },
    async payAirlineInvoiceByCard(invoiceId: string, request: PayInvoiceByCardBody, idempotencyKey: string,
      options?: PayInvoiceByCardOptions) {
      const id = validatedUuid(invoiceId, "invoiceId");
      const key = validatedUuid(idempotencyKey, "idempotencyKey");
      const body = validatedCardBody(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", key);
      const result = await execute(getPayAirlineInvoiceByCardUrl(id),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      const data = result.data;
      if (!isRecord(data) || !hasOnlyKeys(data, ["attempt", "invoiceBalance", "replayed"]) ||
          !isCardPaymentAttempt(data.attempt, id) || !isFiniteNumber(data.invoiceBalance) || data.invoiceBalance < 0 ||
          typeof data.replayed !== "boolean")
        throw malformedResponse(result.status);
      return data as unknown as CardPaymentResponse;
    },
    async getAirlineInvoiceCardPayments(invoiceId: string, options?: GetFinancialDocumentOptions) {
      const id = validatedUuid(invoiceId, "invoiceId");
      const result = await execute(getGetAirlineInvoiceCardPaymentsUrl(id), { ...options, method: "GET" }, true);
      if (!isCardPaymentList(result.data, id)) throw malformedResponse(result.status);
      return result.data;
    },
    async getFinanceInvoiceCardPayments(invoiceId: string, options?: GetFinancialDocumentOptions) {
      const id = validatedUuid(invoiceId, "invoiceId");
      const result = await execute(getGetFinanceInvoiceCardPaymentsUrl(id), { ...options, method: "GET" }, true);
      if (!isCardPaymentList(result.data, id)) throw malformedResponse(result.status);
      return result.data;
    },
    getAirlineCardPaymentReceipt(attemptId: string, options?: GetFinancialDocumentOptions) {
      const id = validatedUuid(attemptId, "attemptId");
      return executePdf(getGetAirlineCardPaymentReceiptUrl(id), options);
    },
    getAirlineInvoiceDocumentById(invoiceId: string, options?: GetFinancialDocumentOptions) {
      const id = validatedUuid(invoiceId, "invoiceId");
      return executePdf(getGetAirlineInvoiceDocumentByIdUrl(id), options);
    },
    getFinancePaymentReceipt(invoiceId: string, options?: GetFinancialDocumentOptions) {
      const id = validatedUuid(invoiceId, "invoiceId");
      return executePdf(getGetFinancePaymentReceiptUrl(id), options);
    },
    async submitPreinvoice(
      draftId: string, request: SubmitPreinvoiceRequest,
      options?: SubmitPreinvoiceOptions,
    ) {
      const draft = validatedUuid(draftId, "draftId");
      if (!isRecord(request) || !hasOnlyKeys(request, ["requestId"]) ||
          !isUuid(request.requestId))
        throw new TypeError("Preinvoice submission request is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getSubmitPreinvoiceUrl(draft),
        { ...options, method: "POST", headers, body: JSON.stringify(request) }, true);
      if (!isSubmitPreinvoiceResponse(result.data) || result.data.id !== draft)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getOccPlanningSnapshot(
      parameters: GetOccPlanningSnapshotParams = {},
      options?: GetOccPlanningSnapshotOptions,
    ) {
      const result = await execute(
        getGetOccPlanningSnapshotUrl(validatedOccPlanningSnapshotParams(parameters)),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isOccPlanningSnapshotResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getOccAircraftTraffic(
      parameters: GetOccAircraftTrafficParams,
      options?: GetOccAircraftTrafficOptions,
    ) {
      if (!isRecord(parameters) || !isUuid(parameters.stationId) ||
          !hasOnlyKeys(parameters, ["stationId"]))
        throw new TypeError("OCC traffic request is invalid.");
      const result = await execute(getGetOccAircraftTrafficUrl(parameters),
        { ...options, method: "GET" }, true);
      if (!isOccAircraftTrafficResponse(result.data))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getManualTurnaroundOptions(
      parameters: GetManualTurnaroundOptionsParams,
      options?: GetManualTurnaroundOptionsOptions,
    ) {
      const query = validatedManualTurnaroundOptionsParams(parameters);
      const result = await execute(getGetManualTurnaroundOptionsUrl(query),
        { ...options, method: "GET" }, true);
      if (!isManualTurnaroundOptionsResponse(result.data) ||
          result.data.station.id !== query.stationId || result.data.date !== query.date)
        throw malformedResponse(result.status);
      return result.data;
    },
    async createManualTurnaround(
      request: CreateManualTurnaroundRequest,
      options?: CreateManualTurnaroundOptions,
    ) {
      const body = validatedManualTurnaroundRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getCreateManualTurnaroundUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (!isManualTurnaroundResponse(result.data) ||
          result.data.turnaroundId !== body.turnaroundId ||
          ![200, 201].includes(result.status) || result.data.replayed !== (result.status === 200))
        throw malformedResponse(result.status);
      return result.data;
    },
    async programOccShift(
      turnaroundId: string,
      request: ProgramOccShiftRequest,
      options?: ProgramOccShiftOptions,
    ) {
      if (!isUuid(turnaroundId))
        throw new TypeError("turnaroundId must be a canonical UUID.");
      const body = validatedOccShiftRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getProgramOccShiftUrl(turnaroundId),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (!isProgramOccShiftResponse(result.data) ||
          result.data.turnaroundId !== turnaroundId ||
          ![200, 201].includes(result.status) ||
          result.data.replayed !== (result.status === 200))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getOccPlanningOptions(
      turnaroundId: string,
      options?: GetOccPlanningOptionsOptions,
    ) {
      const result = await execute(
        getGetOccPlanningOptionsUrl(
          validatedOccPlanningOptionsParams(turnaroundId),
        ),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isOccPlanningOptionsResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getOccPlanningOptionsWithMetadata(
      turnaroundId: string,
      options?: GetOccPlanningOptionsOptions,
    ) {
      const result = await execute(
        getGetOccPlanningOptionsUrl(
          validatedOccPlanningOptionsParams(turnaroundId),
        ),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isOccPlanningOptionsResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      if (!isStrongEtag(result.etag)) {
        throw malformedResponse(result.status);
      }
      return { options: result.data, etag: result.etag };
    },
    async getOccReviewQueue(stationId: string, options?: GetOccReviewOptions) {
      const station = validatedUuid(stationId, "stationId");
      const result = await execute(
        getGetOccReviewQueueUrl({ stationId: station }),
        { ...options, method: "GET" }, true);
      if (!isOccReviewQueueResponse(result.data, station)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOccReviewDetail(operationId: string, options?: GetOccReviewOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(
        getGetOccReviewDetailUrl(operation), { ...options, method: "GET" }, true);
      if (!isOccReviewDetailResponse(result.data, operation) ||
          result.data.reviewVersion !== result.etag) throw malformedResponse(result.status);
      return result.data;
    },
    async getOccReviewSubmissionDetail(
      operationId: string, submissionId: string, options?: GetOccReviewOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const submission = validatedUuid(submissionId, "submissionId");
      const result = await execute(
        getGetOccReviewSubmissionDetailUrl(operation, submission),
        { ...options, method: "GET" }, true);
      if (!isOccReviewDetailResponse(result.data, operation) ||
          result.data.submissionId.toLowerCase() !== submission)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getOccReviewSubmissionHistory(
      operationId: string, options?: GetOccReviewOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(
        getGetOccReviewSubmissionHistoryUrl(operation),
        { ...options, method: "GET" }, true);
      if (!isOccReviewSubmissionHistoryResponse(result.data, operation))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getOperationalPresence(operationIds: string[], options?: GetOperationalCommunicationOptions) {
      if (!Array.isArray(operationIds) || operationIds.length < 1 || operationIds.length > 100)
        throw new TypeError("Presence requires between 1 and 100 operations.");
      const ids = [...new Set(operationIds.map(id => validatedUuid(id, "operationId")))];
      const query = new URLSearchParams();
      ids.forEach(id => query.append("operationIds", id));
      const result = await execute("/api/v1/chat/presence?" + query.toString(), { ...options, method: "GET" }, true);
      const body = result.data;
      if (!isRecord(body) || !hasOnlyKeys(body, ["asOf", "operations"]) || !isDateTimeOffset(body.asOf) ||
          !Array.isArray(body.operations) || !body.operations.every(operation =>
            isRecord(operation) && hasOnlyKeys(operation, ["operationId", "participants"]) &&
            isUuid(operation.operationId) && ids.includes(operation.operationId.toLowerCase()) &&
            Array.isArray(operation.participants) && operation.participants.every(person =>
              isRecord(person) && hasOnlyKeys(person, ["accountId", "name", "role", "state", "lastActivityAt", "availability", "message"]) &&
              isUuid(person.accountId) && typeof person.name === "string" &&
              (person.role === "agent" || person.role === "occ") &&
              isPresenceStatus(person) &&
              (person.lastActivityAt === null || isDateTimeOffset(person.lastActivityAt)))))
        throw malformedResponse(result.status);
      return body as unknown as OperationalPresenceList;
    },
    async getOwnOperationalPresence(options?: GetOperationalCommunicationOptions) {
      const result = await execute("/api/v1/chat/presence/status", { ...options, method: "GET" }, true);
      if (!isOwnPresence(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async putOwnOperationalPresenceStatus(status: PresenceStatusUpdate, options?: GetOperationalCommunicationOptions) {
      const message = typeof status.message === "string" && status.message.trim() ? status.message.trim() : null;
      if (!(status.availability === null || PRESENCE_AVAILABILITIES.includes(status.availability)) ||
          (message !== null && (message.length > PRESENCE_MESSAGE_MAX_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(message))))
        throw new TypeError("Presence status is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute("/api/v1/chat/presence/status", { ...options, method: "PUT", headers,
        body: JSON.stringify({ availability: status.availability, message }) }, true);
      if (!isOwnPresence(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async putOperationalPresence(heartbeat: PresenceHeartbeat, options?: GetOperationalCommunicationOptions) {
      const clientId = validatedUuid(heartbeat.clientId, "clientId");
      if (!Number.isSafeInteger(heartbeat.sequence) || heartbeat.sequence < 0 ||
          !["foreground", "background", "closed"].includes(heartbeat.mode) || typeof heartbeat.activityObserved !== "boolean")
        throw new TypeError("Presence heartbeat is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      await execute("/api/v1/chat/presence", { ...options, method: "PUT", headers,
        body: JSON.stringify({ ...heartbeat, clientId }) }, true);
    },
    async getOperationalConversations(
      stationId?: string, options?: GetOperationalChatOptions,
    ) {
      const station = stationId === undefined ? undefined : validatedUuid(stationId, "stationId");
      const { offset: requestedOffset, ...requestOptions } = options ?? {};
      const offset = validatedChatOffset(requestedOffset);
      const parameters = station === undefined && offset === undefined ? undefined : {
        ...(station === undefined ? {} : { stationId: station }),
        ...(offset === undefined ? {} : { offset }),
      };
      const result = await execute(getGetOperationalConversationsUrl(parameters),
        { ...requestOptions, method: "GET" }, true);
      if (!isOperationConversationListResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOperationalMessages(
      operationId: string, options?: GetOperationalChatOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const { offset: requestedOffset, ...requestOptions } = options ?? {};
      const offset = validatedChatOffset(requestedOffset);
      const result = await execute(getGetOperationalMessagesUrl(operation,
        offset === undefined ? undefined : { offset }),
        { ...requestOptions, method: "GET" }, true);
      if (!isOperationMessageListResponse(result.data, operation)) throw malformedResponse(result.status);
      return result.data;
    },
    async sendOperationalMessage(
      operationId: string, request: SendOperationMessageRequest,
      idempotencyKey: string, installationId?: string,
      options?: GetOperationalCommunicationOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const key = validatedUuid(idempotencyKey, "idempotencyKey");
      if (!isRecord(request) || !hasOnlyKeys(request, ["content"]) ||
          typeof request.content !== "string" || request.content.trim().length === 0 ||
          request.content.length > 2_000 ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request.content))
        throw new TypeError("Operational message is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", key);
      if (installationId !== undefined) headers.set("x-elevant-installation-id",
        validatedUuid(installationId, "installationId"));
      const result = await execute(getSendOperationalMessageUrl(operation),
        { ...options, method: "POST", headers, body: JSON.stringify({ content: request.content.trim() }) }, true);
      if (!isOperationMessageResponse(result.data, operation)) throw malformedResponse(result.status);
      return result.data;
    },
    async markOperationalConversationRead(
      operationId: string, messageId: string, options?: GetOperationalCommunicationOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const message = validatedUuid(messageId, "messageId");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      await execute(getMarkOperationalConversationReadUrl(operation),
        { ...options, method: "PUT", headers, body: JSON.stringify({ messageId: message }) }, true);
    },
    async getOperationalNotifications(options?: GetOperationalCommunicationOptions) {
      const result = await execute(getGetOperationalNotificationsUrl(),
        { ...options, method: "GET" }, true);
      if (!isOperationalNotificationListResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async setOperationalNotificationRead(
      notificationId: string, read: boolean,
      options?: GetOperationalCommunicationOptions,
    ) {
      const notification = validatedUuid(notificationId, "notificationId");
      if (typeof read !== "boolean") throw new TypeError("read must be a boolean.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getSetOperationalNotificationReadUrl(notification),
        { ...options, method: "PUT", headers, body: JSON.stringify({ read }) }, true);
      if (!isOperationalNotificationResponse(result.data) || result.data.id.toLowerCase() !== notification ||
          (read && result.data.readAt == null) || (!read && result.data.readAt != null))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getDepartmentNotifications(options?: GetOperationalCommunicationOptions) {
      const result = await execute(getGetDepartmentNotificationsUrl(), { ...options, method: "GET" }, true);
      if (!isDepartmentNotificationListResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async setDepartmentNotificationRead(
      notificationId: string, read: boolean,
      options?: GetOperationalCommunicationOptions,
    ) {
      const notification = validatedUuid(notificationId, "notificationId");
      if (typeof read !== "boolean") throw new TypeError("read must be a boolean.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getSetDepartmentNotificationReadUrl(notification),
        { ...options, method: "PUT", headers, body: JSON.stringify({ read }) }, true);
      if (!isDepartmentNotificationResponse(result.data) || result.data.id.toLowerCase() !== notification ||
          (read && result.data.readAt == null) || (!read && result.data.readAt != null))
        throw malformedResponse(result.status);
      return result.data;
    },
    async addOccReviewCharge(operationId: string, command: AddOccReviewChargeCommand, etag: string,
      options?: DecideOccReviewOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const body = normalizedAddCharge(command);
      if (body === null) throw new TypeError("The charge adjustment is invalid.");
      return reviewChargeWrite(getAddOccReviewChargeUrl(operation), body, etag, options);
    },
    async removeOccReviewCharge(operationId: string, markId: string, command: RemoveOccReviewChargeCommand,
      etag: string, options?: DecideOccReviewOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const mark = validatedUuid(markId, "markId");
      const body = normalizedRemoveCharge(command);
      if (body === null) throw new TypeError("The charge adjustment is invalid.");
      return reviewChargeWrite(getRemoveOccReviewChargeUrl(operation, mark), body, etag, options);
    },
    async setOccReviewServiceBillingExclusion(operationId: string, serviceId: string,
      command: SetOccReviewServiceBillingExclusionCommand, etag: string, idempotencyKey: string,
      options?: GetOccReviewOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const service = validatedUuid(serviceId, "serviceId");
      const body = normalizedBillingExclusion(command);
      if (body === null) throw new TypeError("The billing exclusion is invalid.");
      return reviewChargeWrite(getSetOccReviewServiceBillingExclusionUrl(operation, service), body, etag,
        { ...options, idempotencyKey: validatedUuid(idempotencyKey, "idempotencyKey") });
    },
    async reopenOccReview(operationId: string, command: ReopenOccReviewCommand, etag: string, idempotencyKey: string,
      options?: GetOccReviewOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const body = normalizedReopenReview(command);
      if (body === null) throw new TypeError("The reopening is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("if-match", validatedStrongEtag(etag));
      headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getReopenOccReviewUrl(operation),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (!isOccReviewReopenResponse(result.data, operation) || result.data.reviewVersion !== result.etag)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getOccOperationIncidents(operationId: string, options?: GetOccReviewOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(getGetOccOperationIncidentsUrl(operation), { ...options, method: "GET" }, true);
      if (!isOccIncidentList(result.data, operation)) throw malformedResponse(result.status);
      return result.data;
    },
    async reportOccIncident(operationId: string, command: ReportOccIncidentCommand, idempotencyKey: string,
      options?: GetOccReviewOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const body = normalizedOccIncidentReport(command);
      if (body === null) throw new TypeError("The incident report is invalid.");
      return masterDataCommand("POST", getReportOccIncidentUrl(operation), body, idempotencyKey, options,
        (value): value is OccIncidentResponse => isOccIncident(value));
    },
    async changeOccIncidentStatus(incidentId: string, command: ChangeOccIncidentStatusCommand, version: string,
      idempotencyKey: string, options?: GetOccReviewOptions) {
      const incident = validatedUuid(incidentId, "incidentId");
      const body = normalizedOccIncidentStatus(command);
      if (body === null || typeof version !== "string" || version.length < 1 || version.length > 64 ||
          version.includes("\""))
        throw new TypeError("The incident change is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      headers.set("if-match", "\"" + version + "\"");
      const result = await execute(getChangeOccIncidentStatusUrl(incident),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (result.status !== 200 || !isOccIncident(result.data) || result.data.id.toLowerCase() !== incident)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getFinanceCloseRules(options?: GetHumanResourcesReportOptions) {
      const result = await execute(getGetFinanceCloseRulesUrl(), { ...options, method: "GET" }, true);
      if (!isFinanceCloseRulesResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async setGroundTimeAllowance(category: AircraftSizeCategory, command: SetGroundTimeAllowanceCommand,
      options?: GetHumanResourcesReportOptions) {
      if (!(AIRCRAFT_SIZE_CATEGORIES as readonly string[]).includes(category))
        throw new TypeError("The aircraft category is invalid.");
      const body = normalizedAllowance(command);
      if (body === null) throw new TypeError("The ground time is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getSetGroundTimeAllowanceUrl(category),
        { ...options, method: "PUT", headers, body: JSON.stringify(body) }, true);
      if (!isGroundTimeAllowanceResponse(result.data) || result.data.category !== category)
        throw malformedResponse(result.status);
      return result.data;
    },
    async addFinanceHoliday(command: AddFinanceHolidayCommand, options?: GetHumanResourcesReportOptions) {
      const body = normalizedHoliday(command);
      if (body === null) throw new TypeError("The holiday is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getAddFinanceHolidayUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (!isFinanceHolidayResponse(result.data) || result.data.date !== body.date) throw malformedResponse(result.status);
      return result.data;
    },
    async removeFinanceHoliday(holidayId: string, options?: GetHumanResourcesReportOptions) {
      const holiday = validatedUuid(holidayId, "holidayId");
      await execute(getRemoveFinanceHolidayUrl(holiday), { ...options, method: "DELETE" }, true);
    },
    async decideOccReview(
      operationId: string,
      request: DecideOccReviewRequest,
      etag: string,
      options?: DecideOccReviewOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const decision = validatedOccReviewDecisionRequest(request);
      const { idempotencyKey, ...init } = options ?? {};
      const headers = headersFrom(init.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("if-match", validatedStrongEtag(etag));
      if (idempotencyKey != null) headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getDecideOccReviewUrl(operation),
        { ...init, method: "POST", headers, body: JSON.stringify(decision) }, true);
      if (!isOccReviewDecisionResponse(result.data, operation, decision))
        throw malformedResponse(result.status);
      return result.data;
    },
    async assignOccPlanningOperation(
      turnaroundId: string,
      request: AssignOccOperationRequest,
      etag: string,
      options?: AssignOccPlanningOperationOptions,
    ) {
      const result = await executeOccAssignment(
        turnaroundId,
        request,
        etag,
        options,
      );
      return result.assignment;
    },
    async assignOccPlanningOperationWithMetadata(
      turnaroundId: string,
      request: AssignOccOperationRequest,
      etag: string,
      options?: AssignOccPlanningOperationOptions,
    ) {
      const result = await executeOccAssignment(
        turnaroundId,
        request,
        etag,
        options,
      );
      if (!isStrongEtag(result.etag)) {
        throw malformedResponse(result.status);
      }
      return { assignment: result.assignment, etag: result.etag };
    },
    async getRampAssignedOperations(options?: GetRampAssignedOperationsOptions) {
      const result = await execute(
        getGetRampAssignedOperationsUrl(),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isRampAssignedOperationsResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async registerMobileDevice(
      request: RegisterMobileDeviceRequest,
      options?: RegisterMobileDeviceOptions,
    ) {
      const registration = validatedMobileDeviceRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(
        getRegisterMobileDeviceUrl(),
        {
          ...options,
          method: "PUT",
          headers,
          body: JSON.stringify(registration),
        },
        true,
      );
      if (!isRegisterMobileDeviceResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async startRampOperation(
      operationId: string,
      installationId: string,
      idempotencyKey: string,
      options?: StartRampOperationOptions,
      request?: StartRampOperationRequest,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const start = request === undefined ? undefined : validatedStartRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      // Without a tapped time the request stays the first version's: no body and no content type.
      if (start?.startedAt !== undefined) headers.set("content-type", "application/json");
      const result = await execute(
        getStartRampOperationUrl(operation),
        {
          ...options,
          method: "POST",
          headers,
          ...(start?.startedAt === undefined ? {} : { body: JSON.stringify(start) }),
        },
        true,
      );
      if (!isRampOperationStartResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getRampOperationChecklist(
      operationId: string,
      options?: GetRampOperationChecklistOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(
        getGetRampOperationChecklistUrl(operation),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isGetRampOperationChecklistResponse(result.data, operation)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getRampIncidents(
      operationId: string,
      options?: GetRampIncidentsOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(
        getGetRampIncidentsUrl(operation),
        { ...options, method: "GET" },
        true,
      );
      if (!isGetRampIncidentsResponse(result.data, operation)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getOperationAttendanceDraft(
      operationId: string,
      assignmentId: string,
      options?: GetOperationAttendanceDraftOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const assignment = validatedUuid(assignmentId, "assignmentId");
      const { installationId, ...requestOptions } = options ?? {};
      const headers = headersFrom(requestOptions.headers, "Request headers");
      headers.delete("x-elevant-installation-id");
      if (installationId !== undefined) {
        headers.set("x-elevant-installation-id",
          validatedUuid(installationId, "installationId"));
      }
      const result = await execute(
        getGetOperationAttendanceDraftUrl(operation, assignment),
        { ...requestOptions, method: "GET", headers }, true,
      );
      if (!isAttendanceSnapshot(result.data, operation, assignment)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getOccAttendanceAssignments(turnaroundId: string, options?: GetHumanResourcesReportOptions) {
      const turnaround = validatedUuid(turnaroundId, "turnaroundId");
      const result = await execute(getGetOccAttendanceAssignmentsUrl(turnaround), { ...options, method: "GET" }, true);
      if (result.status !== 200 || !isOccAttendanceAssignments(result.data, turnaround))
        throw malformedResponse(result.status);
      return result.data;
    },
    async saveOccAttendanceDraft(
      operationId: string, assignmentId: string,
      request: SaveAttendanceDraftRequest, idempotencyKey: string,
      options?: SaveAttendanceDraftOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const assignment = validatedUuid(assignmentId, "assignmentId");
      const draft = validatedAttendanceDraftRequest(request);
      const key = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.delete("x-elevant-installation-id");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", key);
      const result = await execute(
        getSaveOccAttendanceDraftUrl(operation, assignment),
        { ...options, method: "PUT", headers, body: JSON.stringify(draft) }, true,
      );
      if (!isAttendanceWriteResult(result.data, draft)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async saveRampAttendanceDraft(
      operationId: string, assignmentId: string,
      request: SaveAttendanceDraftRequest, idempotencyKey: string,
      installationId: string, options?: SaveAttendanceDraftOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const assignment = validatedUuid(assignmentId, "assignmentId");
      const draft = validatedAttendanceDraftRequest(request);
      const key = validatedUuid(idempotencyKey, "idempotencyKey");
      const installation = validatedUuid(installationId, "installationId");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", key);
      headers.set("x-elevant-installation-id", installation);
      const result = await execute(
        getSaveRampAttendanceDraftUrl(operation, assignment),
        { ...options, method: "PUT", headers, body: JSON.stringify(draft) }, true,
      );
      if (!isAttendanceWriteResult(result.data, draft)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getHumanResourcesAttendance(
      query: GetHumanResourcesAttendanceParams,
      options?: GetHumanResourcesAttendanceOptions,
    ) {
      const scope = validatedHumanResourcesAttendanceQuery(query);
      const result = await execute(getGetHumanResourcesAttendanceUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isHumanResourcesAttendancePage(result.data, scope))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getHumanResourcesReport(kind: HumanResourcesReportKind,
      query: HumanResourcesReportQuery, options?: GetHumanResourcesReportOptions,
    ) {
      const scope = validatedHumanResourcesReportQuery(kind, query);
      const url = kind === "expirations" ? getListHumanResourcesExpirationsUrl(scope) :
        kind === "account-movements" ? getListHumanResourcesAccountMovementsUrl(scope) :
        kind === "staff-distribution" ? getListHumanResourcesStaffDistributionUrl(scope) :
        getListHumanResourcesQualificationCoverageUrl(scope);
      const result = await execute(url, { ...options, method: "GET" }, true);
      if (!isHumanResourcesReportPage(result.data, kind, scope))
        throw malformedResponse(result.status);
      return result.data;
    },
    exportHumanResourcesReport(kind: HumanResourcesReportKind,
      query: HumanResourcesReportQuery, format: "pdf" | "xlsx",
      options?: GetHumanResourcesReportOptions,
    ) {
      const scope = validatedHumanResourcesReportQuery(kind, query);
      if (scope.page !== undefined || scope.limit !== undefined ||
        (format !== "pdf" && format !== "xlsx"))
        throw new TypeError("Human Resources export query is invalid.");
      return executeReportDocument(getExportHumanResourcesReportUrl(kind,
          { stationId: scope.stationId, from: scope.from, to: scope.to, format,
            ...(scope.documentKind && { documentKind: scope.documentKind }),
            ...(scope.validity && { validity: scope.validity }) }),
      format, options);
    },
    async getContractDocument(versionId: string, options?: GetHumanResourcesReportOptions) {
      const version = validatedUuid(versionId, "versionId");
      const result = await execute(getGetContractDocumentUrl(version), { ...options, method: "GET" }, true);
      if (!isContractDocument(result.data, version)) throw malformedResponse(result.status);
      return result.data;
    },
    downloadContractDocument(versionId: string, options?: GetHumanResourcesReportOptions) {
      return executeReportDocument(getDownloadContractDocumentUrl(validatedUuid(versionId, "versionId")), "pdf", options);
    },
    async getAirlinePermits(options?: GetHumanResourcesReportOptions) {
      const result = await execute(getGetAirlinePermitsUrl(), { ...options, method: "GET" }, true);
      if (!Array.isArray(result.data) || !result.data.every(isAirlinePermit)) throw malformedResponse(result.status);
      return result.data;
    },
    async submitAirlinePermit(input: SubmitAirlinePermitInput, idempotencyKey?: string | null,
      options?: GetHumanResourcesReportOptions) {
      const body = validatedPermitInput(input);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      if (idempotencyKey != null) headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getSubmitAirlinePermitUrl(), { ...options, method: "POST", headers,
        body: JSON.stringify(body) }, true);
      if (result.status !== 201 || !isAirlinePermit(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async getContractsAirlinePermits(review?: AirlinePermitReview | null, options?: GetHumanResourcesReportOptions) {
      if (review != null && !(AIRLINE_PERMIT_REVIEWS as readonly string[]).includes(review))
        throw new TypeError("review must be Submitted, Verified, Rejected or Revoked.");
      const result = await execute(getGetContractsAirlinePermitsUrl(review == null ? undefined : { review }),
        { ...options, method: "GET" }, true);
      if (!Array.isArray(result.data) || !result.data.every(isAirlinePermit) ||
          review != null && !result.data.every(permit => permit.review === review)) throw malformedResponse(result.status);
      return result.data;
    },
    async reviewAirlinePermit(permitId: string, command: ReviewAirlinePermitCommand, idempotencyKey?: string | null,
      options?: GetHumanResourcesReportOptions) {
      const permit = validatedUuid(permitId, "permitId");
      const body = normalizedPermitReview(command);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      if (idempotencyKey != null) headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getReviewAirlinePermitUrl(permit), { ...options, method: "POST", headers,
        body: JSON.stringify(body) }, true);
      // A replay answers the permit as it is now: a verification revoked later reads Revoked.
      if (result.status !== 200 || !isAirlinePermitDecision(result.data, permit) ||
          result.data.review !== (body.verified ? "Verified" : "Rejected") && result.data.review !== "Revoked")
        throw malformedResponse(result.status);
      return result.data;
    },
    async revokeAirlinePermit(permitId: string, command: RevokeAirlinePermitCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const permit = validatedUuid(permitId, "permitId");
      const revoked = await catalogCommand("POST", getRevokeAirlinePermitUrl(permit), normalizedPermitRevocation(command),
        idempotencyKey, options, (value): value is AirlinePermitDecisionData => isAirlinePermitDecision(value, permit));
      if (revoked.review !== "Revoked") throw malformedResponse(200);
      return revoked;
    },
    async getAirlinePortalStanding(options?: GetHumanResourcesReportOptions) {
      const result = await execute(getGetAirlinePortalStandingUrl(), { ...options, method: "GET" }, true);
      if (!isAirlinePortalStanding(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async releaseMobileDevice(command: ReleaseMobileDeviceCommand, idempotencyKey: string,
      options?: RegisterMobileDeviceOptions) {
      const body = normalizedReleaseMobileDevice(command);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getReleaseMobileDeviceUrl(), {
        ...options, method: "POST", headers, body: JSON.stringify(body),
      }, true);
      if (result.status !== 204) throw malformedResponse(result.status);
    },
    async getOccMobileDevices(stationId: string, options?: GetHumanResourcesReportOptions) {
      const station = validatedUuid(stationId, "stationId");
      const result = await execute(getListOccMobileDevicesUrl({ stationId: station }), { ...options, method: "GET" }, true);
      if (!isOccMobileDevices(result.data, station)) throw malformedResponse(result.status);
      return result.data;
    },
    async unbindOccMobileDevice(deviceId: string, command: UnbindOccMobileDeviceCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const device = validatedUuid(deviceId, "deviceId");
      return catalogCommand("POST", getUnbindOccMobileDeviceUrl(device), normalizedUnbindOccMobileDevice(command),
        idempotencyKey, options, (value): value is OccMobileDeviceData => isOccMobileDevice(value, device));
    },
    async revokeOccMobileDevice(deviceId: string, command: RevokeOccMobileDeviceCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const device = validatedUuid(deviceId, "deviceId");
      const revoked = await catalogCommand("POST", getRevokeOccMobileDeviceUrl(device),
        normalizedRevokeOccMobileDevice(command), idempotencyKey, options,
        (value): value is OccMobileDeviceData => isOccMobileDevice(value, device));
      if (revoked.status !== "Revoked") throw malformedResponse(200);
      return revoked;
    },
    async getAirlinePortalUsers(options?: GetHumanResourcesReportOptions) {
      const result = await execute(getGetAirlinePortalUsersUrl(), { ...options, method: "GET" }, true);
      if (!isAirlinePortalUsers(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async inviteAirlinePortalUser(command: InviteAirlinePortalUserCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const body = normalizedInviteAirlinePortalUser(command);
      const invited = await masterDataCommand("POST", getInviteAirlinePortalUserUrl(), body, idempotencyKey, options,
        (value): value is AirlinePortalUserData => isAirlinePortalUser(value));
      if (invited.email.toLowerCase() !== body.email.toLowerCase()) throw malformedResponse(201);
      return invited;
    },
    async setAirlinePortalUserStatus(userId: string, command: SetAirlinePortalUserStatusCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const user = validatedUuid(userId, "userId");
      return catalogCommand("POST", getSetAirlinePortalUserStatusUrl(user), normalizedAirlinePortalUserStatus(command),
        idempotencyKey, options, (value): value is AirlinePortalUserData => isAirlinePortalUser(value, user));
    },
    async setAirlinePortalUserSigner(userId: string, command: SetAirlinePortalUserSignerCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const user = validatedUuid(userId, "userId");
      return catalogCommand("POST", getSetAirlinePortalUserSignerUrl(user), normalizedAirlinePortalUserSigner(command),
        idempotencyKey, options, (value): value is AirlinePortalUserData => isAirlinePortalUser(value, user));
    },
    async uploadAirlinePermitDocument(file: Blob, options?: GetHumanResourcesReportOptions) {
      if (!(file instanceof Blob) || file.size === 0 || file.size > 8 * 1024 * 1024 ||
          !["application/pdf", "image/jpeg", "image/png"].includes(file.type))
        throw new TypeError("The permit document must be a PDF, JPG or PNG of up to 8 MB.");
      const form = new FormData();
      form.append("purpose", "airline-permit");
      form.append("file", file);
      const result = await execute(getUploadCommercialMediaUrl(), {
        ...options, method: "POST", headers: Object.fromEntries(headersFrom(options?.headers, "Request headers")), body: form,
      }, true);
      if (!isRecord(result.data) || typeof result.data.url !== "string" || !/^\/api\/v1\/media\/[0-9a-f-]{36}$/i.test(result.data.url))
        throw malformedResponse(result.status);
      return result.data.url;
    },
    async getContractTimeline(versionId: string, options?: GetHumanResourcesReportOptions) {
      const result = await execute(getGetContractTimelineUrl(validatedUuid(versionId, "versionId")), { ...options, method: "GET" }, true);
      // 2-N14: the history carries the scheduled termination or the earliest date of a new one.
      if (!isContractTimeline(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    downloadContractDraftPdf(versionId: string, options?: GetHumanResourcesReportOptions) {
      return executeReportDocument(getDownloadContractDraftPdfUrl(validatedUuid(versionId, "versionId")), "pdf", options);
    },
    async signContractVersion(versionId: string, request: SignContractRequest, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const version = validatedUuid(versionId, "versionId");
      const key = validatedUuid(idempotencyKey, "idempotencyKey");
      const name = typeof request?.signerName === "string" ? request.signerName.trim() : "";
      const title = typeof request?.signerTitle === "string" ? request.signerTitle.trim() : "";
      if (name.length < 3 || name.length > 160 || title.length < 2 || title.length > 120 ||
          typeof request.documentSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(request.documentSha256) ||
          request.accepted !== true)
        throw new TypeError("The contract signature is invalid.");
      const signatureImagePng = validatedSignaturePng(request.signatureImagePng);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", key);
      const result = await execute(getSignContractVersionUrl(version), { ...options, method: "POST", headers,
        body: JSON.stringify({ signerName: name, signerTitle: title, documentSha256: request.documentSha256.toLowerCase(),
          accepted: true, signatureImagePng }) }, true);
      if (!isContractDocument(result.data, version)) throw malformedResponse(result.status);
      return result.data;
    },
    async getCommercialRequestInbox(query?: CommercialInboxQuery, options?: GetHumanResourcesReportOptions) {
      const params = normalizedCommercialInboxQuery(query);
      const result = await execute(getListCommercialRequestInboxUrl(params), { ...options, method: "GET" }, true);
      if (!isCommercialInboxData(result.data, params)) throw malformedResponse(result.status);
      return result.data;
    },
    async verifyCommercialRequestAirline(requestId: string, command: VerifyCommercialRequestAirlineCommand,
      idempotencyKey: string, options?: GetHumanResourcesReportOptions) {
      return commercialCommand(getVerifyCommercialRequestAirlineUrl(validatedUuid(requestId, "requestId")),
        normalizedAirlineVerification(command), idempotencyKey, options, requestId);
    },
    async confirmCommercialRepresentative(requestId: string, command: ConfirmCommercialRepresentativeCommand,
      idempotencyKey: string, options?: GetHumanResourcesReportOptions) {
      return commercialCommand(getConfirmCommercialRepresentativeUrl(validatedUuid(requestId, "requestId")),
        normalizedRepresentativeConfirmation(command), idempotencyKey, options, requestId);
    },
    async cancelCommercialRequest(requestId: string, command: CancelCommercialRequestCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      return commercialCommand(getCancelCommercialRequestUrl(validatedUuid(requestId, "requestId")),
        normalizedRequestCancellation(command), idempotencyKey, options, requestId);
    },
    async decideCommercialRequest(requestId: string, command: DecideCommercialRequestCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const body = normalizedCommercialDecision(command);
      // An approval answers with the new draft contract; a rejection with the request itself.
      return commercialCommand(getDecideCommercialRequestUrl(validatedUuid(requestId, "requestId")), body,
        idempotencyKey, options, body.approve ? undefined : requestId);
    },
    async getContractDraftReadiness(versionId: string, options?: GetHumanResourcesReportOptions) {
      const version = validatedUuid(versionId, "versionId");
      const result = await execute(getGetManagedContractDraftReadinessUrl(version), { ...options, method: "GET" }, true);
      if (!isContractDraftReadiness(result.data, version)) throw malformedResponse(result.status);
      return result.data;
    },
    async getContractDraftScope(versionId: string, options?: GetHumanResourcesReportOptions) {
      const version = validatedUuid(versionId, "versionId");
      const result = await execute(getGetManagedContractDraftScopeUrl(version), { ...options, method: "GET" }, true);
      if (!isContractDraftScope(result.data, version)) throw malformedResponse(result.status);
      return result.data;
    },
    async setContractDraftScope(versionId: string, command: SetContractDraftScopeCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const version = validatedUuid(versionId, "versionId");
      return draftCommand("PUT", getSetManagedContractDraftScopeUrl(version), normalizedDraftScope(command), idempotencyKey,
        options, 200, version);
    },
    async updateManagedContractDraft(versionId: string, command: UpdateManagedContractDraftCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const version = validatedUuid(versionId, "versionId");
      return draftCommand("PUT", getUpdateManagedContractDraftUrl(version), normalizedDraftUpdate(command), idempotencyKey,
        options, 200, version);
    },
    async submitManagedContractDraft(versionId: string, command: SubmitManagedContractDraftCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      // The submission answers the draft's contract, not the version.
      return draftCommand("POST", getActivateManagedContractDraftUrl(validatedUuid(versionId, "versionId")),
        normalizedDraftSubmission(command), idempotencyKey, options, 200, undefined);
    },
    async discardContractDraft(versionId: string, command: DiscardContractDraftCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const version = validatedUuid(versionId, "versionId");
      return draftCommand("POST", getDiscardManagedContractDraftUrl(version), normalizedDraftDiscard(command),
        idempotencyKey, options, 200, version);
    },
    async replyContractDraft(versionId: string, command: ContractDraftMessageCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      return draftCommand("POST", getReplyManagedContractDraftUrl(validatedUuid(versionId, "versionId")),
        normalizedDraftMessage(command), idempotencyKey, options, 201, undefined);
    },
    async commentAirlineContractDraft(versionId: string, command: ContractDraftMessageCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      return draftCommand("POST", getCommentAirlineContractDraftUrl(validatedUuid(versionId, "versionId")),
        normalizedDraftMessage(command), idempotencyKey, options, 201, undefined);
    },
    async createContractAmendment(versionId: string, command: CreateContractAmendmentCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      // The amendment answers its own new version, not the version in the route.
      return packageCommand(getCreateContractAmendmentUrl(validatedUuid(versionId, "versionId")),
        normalizedContractAmendment(command), idempotencyKey, options, 201, undefined);
    },
    async discardFinancePackage(packageId: string, command: FinancePackageLifecycleCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const id = validatedUuid(packageId, "packageId");
      return packageCommand(getDiscardFinancePackageUrl(id), normalizedPackageLifecycle(command), idempotencyKey, options,
        200, id);
    },
    async retireFinancePackage(packageId: string, command: FinancePackageLifecycleCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const id = validatedUuid(packageId, "packageId");
      return packageCommand(getRetireFinancePackageUrl(id), normalizedPackageLifecycle(command), idempotencyKey, options,
        200, id);
    },
    async updateManagedService(serviceId: string, command: UpdateManagedServiceCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const id = validatedUuid(serviceId, "serviceId");
      return catalogCommand("PUT", getUpdateCommercialServiceUrl(id), normalizedManagedServiceUpdate(command),
        idempotencyKey, options, (value): value is ManagedServiceData => isManagedService(value, id));
    },
    async retireManagedService(serviceId: string, command: RetireManagedServiceCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const id = validatedUuid(serviceId, "serviceId");
      return catalogCommand("POST", getRetireCommercialServiceUrl(id), normalizedServiceRetirement(command),
        idempotencyKey, options, (value): value is ManagedServiceData => isManagedService(value, id));
    },
    async decideServiceClosure(closureId: string, command: DecideServiceClosureCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const id = validatedUuid(closureId, "closureId");
      return catalogCommand("POST", getDecideServiceClosureUrl(id), normalizedClosureDecision(command),
        idempotencyKey, options, (value): value is ServiceClosureData => isServiceClosure(value, { id }));
    },
    async reopenService(serviceId: string, command: ReopenServiceCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      // The reopening answers the closure it reopened, for the service in the route.
      const id = validatedUuid(serviceId, "serviceId");
      return catalogCommand("POST", getReopenServiceUrl(id), normalizedServiceReopen(command),
        idempotencyKey, options, (value): value is ServiceClosureData => isServiceClosure(value, { serviceId: id }));
    },
    async setContractValidity(versionId: string, request: SetContractValidityRequest, idempotencyKey?: string | null,
      options?: GetHumanResourcesReportOptions) {
      const version = validatedUuid(versionId, "versionId");
      const key = idempotencyKey == null ? null : validatedUuid(idempotencyKey, "idempotencyKey");
      if (!isRecord(request) || !isDateOnly(request.validFrom) || !isDateOnly(request.validTo) ||
          request.validTo <= request.validFrom || !RENEWAL_MODES.has(request.renewalMode) ||
          (request.renewalTermMonths != null && (!Number.isInteger(request.renewalTermMonths) ||
            request.renewalTermMonths < 1 || request.renewalTermMonths > 60)) ||
          (request.renewalMode === "Automatic" && request.renewalTermMonths == null) ||
          !Number.isInteger(request.renewalNoticeDays) || request.renewalNoticeDays < 0 || request.renewalNoticeDays > 180 ||
          !Number.isInteger(request.terminationNoticeDays) || request.terminationNoticeDays < 0 ||
          request.terminationNoticeDays > 180 ||
          (request.terminationTerms != null && (typeof request.terminationTerms !== "string" ||
            request.terminationTerms.length > 4000)) ||
          typeof request.expectedDocumentSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(request.expectedDocumentSha256))
        throw new TypeError("The contract validity is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      if (key) headers.set("idempotency-key", key);
      const result = await execute(getSetContractValidityUrl(version), { ...options, method: "PUT", headers,
        body: JSON.stringify({ validFrom: request.validFrom, validTo: request.validTo, renewalMode: request.renewalMode,
          renewalTermMonths: request.renewalTermMonths ?? null, renewalNoticeDays: request.renewalNoticeDays,
          terminationNoticeDays: request.terminationNoticeDays,
          terminationTerms: request.terminationTerms?.trim() || null,
          expectedDocumentSha256: request.expectedDocumentSha256.toLowerCase() }) }, true);
      if (!isContractDocument(result.data, version)) throw malformedResponse(result.status);
      return result.data;
    },
    async withdrawContractVersion(versionId: string, command: WithdrawContractVersionCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      // The withdrawal answers the version of the route; a new draft is another version.
      const version = validatedUuid(versionId, "versionId");
      return catalogCommand("POST", getWithdrawContractVersionUrl(version), normalizedContractWithdrawal(command),
        idempotencyKey, options, (value): value is ContractWithdrawalResponse => isContractWithdrawal(value, version));
    },
    async getContractPricingTerms(versionId: string, options?: GetHumanResourcesReportOptions) {
      const version = validatedUuid(versionId, "versionId");
      const result = await execute(getGetContractPricingTermsUrl(version), { ...options, method: "GET" }, true);
      if (!isContractPricingTerms(result.data, version)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOccPositions(stationId: string, date: string, options?: GetHumanResourcesReportOptions) {
      const station = validatedUuid(stationId, "stationId");
      if (!isDateOnly(date)) throw new TypeError("date must be an ISO date.");
      const result = await execute(getGetOccPositionsUrl({ stationId: station, date }), { ...options, method: "GET" }, true);
      if (!isOccPositionBoard(result.data, station)) throw malformedResponse(result.status);
      return result.data;
    },
    async recordOccArrival(turnaroundId: string,
      request: { aircraftRegistration: string; arrivedAt?: string | null; aircraftTypeId?: string | null; reason?: string | null },
      options?: GetHumanResourcesReportOptions & OccPositionCommandHeaders) {
      const turnaround = validatedUuid(turnaroundId, "turnaroundId");
      const registration = typeof request?.aircraftRegistration === "string" ? request.aircraftRegistration.trim().toUpperCase() : "";
      if (!/^[A-Z0-9-]{2,10}$/.test(registration) ||
          (request.arrivedAt != null && !isDateTimeOffset(request.arrivedAt)) ||
          (request.aircraftTypeId != null && !isUuid(request.aircraftTypeId)))
        throw new TypeError("The arrival is invalid.");
      // An older body keeps its two fields; the type and the correction reason travel only when given.
      const body: Record<string, unknown> = { aircraftRegistration: registration, arrivedAt: request.arrivedAt ?? null };
      if (request.aircraftTypeId != null) body.aircraftTypeId = request.aircraftTypeId;
      if (request.reason != null) body.reason = normalizedTurnaroundReason(request.reason);
      return positionCommand(getRecordOccArrivalUrl(turnaround), body, options);
    },
    async assignOccStand(turnaroundId: string, request: { standId: string; reason?: string | null },
      options?: GetHumanResourcesReportOptions & OccPositionCommandHeaders) {
      const turnaround = validatedUuid(turnaroundId, "turnaroundId");
      const reason = typeof request?.reason === "string" && request.reason.trim() ? request.reason.trim() : null;
      if (reason && reason.length > 500) throw new TypeError("The reason is too long.");
      return positionCommand(getAssignOccStandUrl(turnaround),
        { standId: validatedUuid(request?.standId, "standId"), reason }, options);
    },
    async releaseOccStand(turnaroundId: string, options?: GetHumanResourcesReportOptions & OccPositionCommandHeaders) {
      return positionCommand(getReleaseOccStandUrl(validatedUuid(turnaroundId, "turnaroundId")), undefined, options);
    },
    async getOccTurnaround(turnaroundId: string, options?: GetHumanResourcesReportOptions) {
      const turnaround = validatedUuid(turnaroundId, "turnaroundId");
      const result = await execute(getGetOccTurnaroundUrl(turnaround), { ...options, method: "GET" }, true);
      return turnaroundWithMetadata(result, turnaround);
    },
    async rescheduleOccTurnaround(turnaroundId: string, command: RescheduleOccTurnaroundCommand,
      headers: OccTurnaroundCommandHeaders, options?: GetHumanResourcesReportOptions) {
      const turnaround = validatedUuid(turnaroundId, "turnaroundId");
      return turnaroundCommand("PUT", getRescheduleOccTurnaroundUrl(turnaround), turnaround,
        normalizedTurnaroundReschedule(command), headers, options);
    },
    async changeOccTurnaroundStatus(turnaroundId: string, command: ChangeOccTurnaroundStatusCommand,
      headers: OccTurnaroundCommandHeaders, options?: GetHumanResourcesReportOptions) {
      const turnaround = validatedUuid(turnaroundId, "turnaroundId");
      return turnaroundCommand("POST", getChangeOccTurnaroundStatusUrl(turnaround), turnaround,
        normalizedTurnaroundStatusChange(command), headers, options);
    },
    async createOccCharterAirline(command: CreateOccCharterAirlineCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const body = normalizedCharterAirline(command);
      const created = await masterDataCommand("POST", getCreateOccCharterAirlineUrl(), body, idempotencyKey, options,
        (value): value is OccCharterAirlineResponse => isOccCharterAirline(value));
      if (created.icaoCode !== body.icaoCode) throw malformedResponse(201);
      return created;
    },
    async getRampAircraftTypes(options?: GetHumanResourcesReportOptions) {
      const result = await execute(getGetRampAircraftTypesUrl(), { ...options, method: "GET" }, true);
      if (!isRampAircraftTypes(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async locateOccStand(standId: string,
      request: { latitude: number | null; longitude: number | null; operationDate: string },
      options?: GetHumanResourcesReportOptions) {
      const stand = validatedUuid(standId, "standId");
      const latitude = request?.latitude ?? null;
      const longitude = request?.longitude ?? null;
      if ((latitude === null) !== (longitude === null) || (latitude !== null && !isLatitude(latitude)) ||
          (longitude !== null && !isLongitude(longitude)) || !isDateOnly(request?.operationDate))
        throw new TypeError("The stand location is invalid.");
      return positionCommand(getLocateOccStandUrl(stand),
        { latitude, longitude, operationDate: request.operationDate }, options, "PUT");
    },
    async getOccCoverage(stationId: string, date: string, options?: GetHumanResourcesReportOptions) {
      const station = validatedUuid(stationId, "stationId");
      if (!isDateOnly(date)) throw new TypeError("date must be an ISO date.");
      const result = await execute(getGetOccCoverageUrl({ stationId: station, date }), { ...options, method: "GET" }, true);
      if (!isOccCoverageBoard(result.data, station)) throw malformedResponse(result.status);
      return result.data;
    },
    async createOccCoverage(request: OccCoverageCommand, options?: OccCoverageCommandOptions) {
      const standIds = Array.isArray(request?.standIds) ? request.standIds.map(id => validatedUuid(id, "standId")) : [];
      const vehicleCode = typeof request?.vehicleCode === "string" && request.vehicleCode.trim() ? request.vehicleCode.trim() : null;
      const startsAt = request?.startsAt ?? null;
      const endsAt = request?.endsAt ?? null;
      if (standIds.length === 0 || standIds.length > 6 || new Set(standIds).size !== standIds.length ||
          !isDateOnly(request?.date) || (startsAt === null) !== (endsAt === null) ||
          (startsAt !== null && !isDateTimeOffset(startsAt)) || (endsAt !== null && !isDateTimeOffset(endsAt)) ||
          (vehicleCode !== null && vehicleCode.length > 32) || typeof request.isReinforcement !== "boolean")
        throw new TypeError("The coverage is invalid.");
      return coverageCommand(getCreateOccCoverageUrl(), {
        stationId: validatedUuid(request.stationId, "stationId"), date: request.date,
        agentId: validatedUuid(request.agentId, "agentId"), terminalId: validatedUuid(request.terminalId, "terminalId"),
        standIds, startsAt, endsAt,
        mentorAgentId: request.mentorAgentId ? validatedUuid(request.mentorAgentId, "mentorAgentId") : null,
        vehicleCode, isReinforcement: request.isReinforcement }, options);
    },
    async releaseOccCoverage(coverageId: string, date: string, options?: OccCoverageCommandOptions) {
      if (!isDateOnly(date)) throw new TypeError("date must be an ISO date.");
      return coverageCommand(getReleaseOccCoverageUrl(validatedUuid(coverageId, "coverageId"), { date }), undefined, options);
    },
    async updateOccStandAttributes(standId: string, request: OccStandAttributesCommand,
      options?: GetHumanResourcesReportOptions) {
      if (!isDateOnly(request?.date) || typeof request.hasBoardingBridge !== "boolean" || typeof request.isRemote !== "boolean" ||
          typeof request.isActive !== "boolean" ||
          (request.maxAircraftSize !== null && !AIRCRAFT_SIZES.has(request.maxAircraftSize)))
        throw new TypeError("The stand attributes are invalid.");
      return coverageCommand(getUpdateOccStandAttributesUrl(validatedUuid(standId, "standId")), {
        date: request.date, hasBoardingBridge: request.hasBoardingBridge, isRemote: request.isRemote,
        maxAircraftSize: request.maxAircraftSize, isActive: request.isActive }, options, "PUT");
    },
    async updateOccTerminalRules(terminalId: string,
      request: { date: string; maxStandsPerAgent: number | null; requiresBridgeQualification: boolean },
      options?: GetHumanResourcesReportOptions) {
      const max = request?.maxStandsPerAgent ?? null;
      if (!isDateOnly(request?.date) || (max !== null && (!Number.isInteger(max) || max < 1 || max > 6)) ||
          typeof request.requiresBridgeQualification !== "boolean")
        throw new TypeError("The terminal rules are invalid.");
      return coverageCommand(getUpdateOccTerminalRulesUrl(validatedUuid(terminalId, "terminalId")), {
        date: request.date, maxStandsPerAgent: max, requiresBridgeQualification: request.requiresBridgeQualification },
        options, "PUT");
    },
    async addOccStandConstraint(request: { date: string; standId: string; affectedStandId: string; kind: "Cancels" | "NarrowbodyOnly" },
      options?: GetHumanResourcesReportOptions) {
      const standId = validatedUuid(request?.standId, "standId");
      const affectedStandId = validatedUuid(request?.affectedStandId, "affectedStandId");
      if (!isDateOnly(request.date) || !STAND_CONSTRAINT_KINDS.has(request.kind) || standId === affectedStandId)
        throw new TypeError("The stand rule is invalid.");
      return coverageCommand(getAddOccStandConstraintUrl(), { date: request.date, standId, affectedStandId, kind: request.kind },
        options);
    },
    async removeOccStandConstraint(constraintId: string, date: string, options?: GetHumanResourcesReportOptions) {
      if (!isDateOnly(date)) throw new TypeError("date must be an ISO date.");
      return coverageCommand(getRemoveOccStandConstraintUrl(validatedUuid(constraintId, "constraintId"), { date }),
        undefined, options, "DELETE");
    },
    async releaseOccOperationAgent(turnaroundId: string, options?: ReleaseOccOperationAgentOptions) {
      const { expectedAssignmentId, idempotencyKey, ...init } = options ?? {};
      const turnaround = validatedUuid(turnaroundId, "turnaroundId");
      const expected = expectedAssignmentId == null ? null : validatedUuid(expectedAssignmentId, "expectedAssignmentId");
      // A key needs the assignment on screen, like the server asks (expected_version_required).
      if (idempotencyKey != null && expected === null)
        throw new TypeError("A keyed agent release needs the assignment on screen.");
      const headers = headersFrom(init.headers, "Request headers");
      if (idempotencyKey != null) headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getReleaseOccOperationAgentUrl(turnaround,
        expected === null ? undefined : { expectedAssignmentId: expected }), { ...init, method: "POST", headers }, true);
      if (result.status !== 204) throw malformedResponse(result.status);
    },
    async getOccHandoverOptions(turnaroundId: string, options?: GetHumanResourcesReportOptions) {
      const turnaround = validatedUuid(turnaroundId, "turnaroundId");
      const result = await execute(getGetOccHandoverOptionsUrl(turnaround), { ...options, method: "GET" }, true);
      if (result.status !== 200 || !isOccHandoverOptions(result.data, turnaround)) throw malformedResponse(result.status);
      return result.data;
    },
    async handOverOccOperation(turnaroundId: string, command: HandOverOccOperationCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const turnaround = validatedUuid(turnaroundId, "turnaroundId");
      const body = validatedHandoverCommand(command);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getHandOverOccOperationUrl(turnaround),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (result.status !== 200 || !isOccOperationHandover(result.data, turnaround, body.agentId))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getOccAgentShift(turnaroundId: string, agentId: string, options?: GetHumanResourcesReportOptions) {
      const turnaround = validatedUuid(turnaroundId, "turnaroundId");
      const agent = validatedUuid(agentId, "agentId");
      const result = await execute(getGetOccAgentShiftUrl(turnaround, agent), { ...options, method: "GET" }, true);
      if (result.status !== 200 || !isOccAgentShift(result.data, agent)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOwnRampCoverage(options?: GetOperationalCommunicationOptions) {
      const result = await execute(getGetOwnRampCoverageUrl(), { ...options, method: "GET" }, true);
      if (!isOwnRampCoverage(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOccFlightFeed(stationId: string, date: string,
      options?: GetHumanResourcesReportOptions & { readonly view?: OccFlightFeedView }) {
      const station = validatedUuid(stationId, "stationId");
      if (!isDateOnly(date)) throw new TypeError("date must be an ISO date.");
      const { view, ...init } = options ?? {};
      if (view !== undefined && !isOccFlightFeedView(view)) throw new TypeError("view must be Contracted, Charter or Dismissed.");
      const result = await execute(getGetOccFlightFeedUrl(view === undefined ? { stationId: station, date }
        : { stationId: station, date, view }), { ...init, method: "GET" }, true);
      if (!isOccFlightFeed(result.data, station, date, view)) throw malformedResponse(result.status);
      return result.data;
    },
    async refreshOccFlightFeed(stationId: string, options?: GetHumanResourcesReportOptions) {
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getRefreshOccFlightFeedUrl(), { ...options, method: "POST", headers,
        body: JSON.stringify({ stationId: validatedUuid(stationId, "stationId") }) }, true);
      if (!isRefreshOccFlightFeed(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async importOccFlight(arrivalProposalId: string, departureProposalId: string, options?: GetHumanResourcesReportOptions) {
      const arrival = validatedUuid(arrivalProposalId, "arrivalProposalId");
      const departure = validatedUuid(departureProposalId, "departureProposalId");
      if (arrival === departure) throw new TypeError("An arrival and a departure are required.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getImportOccFlightUrl(), { ...options, method: "POST", headers,
        body: JSON.stringify({ arrivalProposalId: arrival, departureProposalId: departure }) }, true);
      if (!isImportedFlight(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async dismissOccFlightProposal(proposalId: string, options?: GetHumanResourcesReportOptions) {
      const result = await execute(getDismissOccFlightProposalUrl(validatedUuid(proposalId, "proposalId")),
        { ...options, method: "POST" }, true);
      if (result.status !== 204) throw malformedResponse(result.status);
    },
    async importOccFlightProposals(command: ImportOccFlightCommand, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      return catalogCommand("POST", getImportOccFlightUrl(), normalizedFlightImport(command), idempotencyKey, options,
        isImportedFlight);
    },
    async restoreOccFlightProposal(proposalId: string, expectedVersion: string, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const proposal = validatedUuid(proposalId, "proposalId");
      if (!isNonEmptyString(expectedVersion) || expectedVersion.length > 64) throw new TypeError("expectedVersion is required.");
      return catalogCommand("POST", getRestoreOccFlightProposalUrl(proposal), { expectedVersion }, idempotencyKey, options,
        (value): value is RestoreOccFlightProposalResponse => isRestoredFlightProposal(value, proposal));
    },
    async listGovernanceStations(options?: GetHumanResourcesReportOptions) {
      const result = await execute(getListGovernanceStationsUrl(), { ...options, method: "GET" }, true);
      if (!isStationCatalog(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async createGovernanceStation(input: CreateStationInput, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const body = normalizedStationCreate(input);
      const created = await masterDataCommand("POST", getCreateGovernanceStationUrl(), body, idempotencyKey, options,
        (value): value is StationCatalogItemData => isStationCatalogItem(value));
      if (created.code !== body.code) throw malformedResponse(201);
      return created;
    },
    async updateGovernanceStation(stationId: string, input: UpdateStationInput, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const station = validatedUuid(stationId, "stationId");
      return masterDataCommand("PUT", getUpdateGovernanceStationUrl(station), normalizedStationUpdate(input), idempotencyKey,
        options, (value): value is StationCatalogItemData => isStationCatalogItem(value, station));
    },
    async getOccMasterData(stationId: string, options?: GetHumanResourcesReportOptions) {
      const station = validatedUuid(stationId, "stationId");
      const result = await execute(getGetOccMasterDataUrl({ stationId: station }), { ...options, method: "GET" }, true);
      if (!isOccMasterData(result.data, station)) throw malformedResponse(result.status);
      return result.data;
    },
    async createOccTerminal(input: CreateTerminalInput, idempotencyKey: string, options?: GetHumanResourcesReportOptions) {
      const body = normalizedTerminalCreate(input);
      const created = await masterDataCommand("POST", getCreateOccTerminalUrl(), body, idempotencyKey, options,
        (value): value is MasterTerminalData => isMasterTerminal(value));
      if (created.code !== body.code) throw malformedResponse(201);
      return created;
    },
    async updateOccTerminal(terminalId: string, input: UpdateTerminalInput, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const terminal = validatedUuid(terminalId, "terminalId");
      return masterDataCommand("PUT", getUpdateOccTerminalUrl(terminal), normalizedTerminalUpdate(input), idempotencyKey,
        options, (value): value is MasterTerminalData => isMasterTerminal(value, terminal));
    },
    async createOccStand(input: CreateStandInput, idempotencyKey: string, options?: GetHumanResourcesReportOptions) {
      const body = normalizedStandCreate(input);
      const created = await masterDataCommand("POST", getCreateOccStandUrl(), body, idempotencyKey, options,
        (value): value is MasterStandData => isMasterStand(value));
      if (created.code !== body.code) throw malformedResponse(201);
      return created;
    },
    async updateOccStand(standId: string, input: UpdateStandInput, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const stand = validatedUuid(standId, "standId");
      return masterDataCommand("PUT", getUpdateOccStandUrl(stand), normalizedStandUpdate(input), idempotencyKey, options,
        (value): value is MasterStandData => isMasterStand(value, stand));
    },
    async createOccAircraftType(input: CreateAircraftTypeInput, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const body = normalizedAircraftTypeCreate(input);
      const created = await masterDataCommand("POST", getCreateOccAircraftTypeUrl(), body, idempotencyKey, options,
        (value): value is MasterAircraftTypeData => isMasterAircraftType(value));
      if (created.icaoCode !== body.icaoCode) throw malformedResponse(201);
      return created;
    },
    async updateOccAircraftType(aircraftTypeId: string, input: UpdateAircraftTypeInput, idempotencyKey: string,
      options?: GetHumanResourcesReportOptions) {
      const type = validatedUuid(aircraftTypeId, "aircraftTypeId");
      return masterDataCommand("PUT", getUpdateOccAircraftTypeUrl(type), normalizedAircraftTypeUpdate(input), idempotencyKey,
        options, (value): value is MasterAircraftTypeData => isMasterAircraftType(value, type));
    },
    async listOccReadyContracts(stationId: string, date: string, options?: GetHumanResourcesReportOptions) {
      const station = validatedUuid(stationId, "stationId");
      if (!isDateOnly(date)) throw new TypeError("date must be an ISO date.");
      const result = await execute(getListOccReadyContractsUrl({ stationId: station, date }), { ...options, method: "GET" }, true);
      if (!isOccReadyContracts(result.data, station, date)) throw malformedResponse(result.status);
      return result.data;
    },
    async listOccReports(options?: GetHumanResourcesReportOptions) {
      const result = await execute(getListOccReportsUrl(), { ...options, method: "GET" }, true);
      if (!isOccReportCatalog(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOccReport(key: OccReportKey, query: OccReportQuery, options?: GetHumanResourcesReportOptions) {
      const scope = validatedOccReportQuery(key, query);
      const result = await execute(getGetOccReportUrl(key, scope), { ...options, method: "GET" }, true);
      if (!isOccReportPage(result.data, key, scope)) throw malformedResponse(result.status);
      return result.data;
    },
    exportOccReport(key: OccReportKey, query: OccReportQuery, format: OccReportFormat,
      options?: GetHumanResourcesReportOptions) {
      const scope = validatedOccReportQuery(key, query);
      if (scope.page !== undefined || scope.limit !== undefined || !OCC_REPORT_FORMATS.has(format))
        throw new TypeError("OCC report export query is invalid.");
      return executeReportDocument(getExportOccReportUrl(key, { stationId: scope.stationId, from: scope.from,
        to: scope.to, format }), format, options);
    },
    async validateHumanResourcesAttendance(
      assignmentId: string, stationId: string,
      request: ValidateAttendanceRequest, idempotencyKey: string,
      options?: ValidateHumanResourcesAttendanceOptions,
    ) {
      const assignment = validatedUuid(assignmentId, "assignmentId");
      const station = validatedUuid(stationId, "stationId");
      const body = validatedAttendanceValidationRequest(request);
      const key = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", key);
      const result = await execute(getValidateHumanResourcesAttendanceUrl(
        assignment, { stationId: station }),
      { ...options, method: "PUT", headers, body: JSON.stringify(body) }, true);
      if (!isAttendanceValidationWriteResult(result.data, assignment, body))
        throw malformedResponse(result.status);
      return result.data;
    },
    async recordRampMilestone(
      operationId: string, code: string, occurredAt: string, installationId: string, idempotencyKey: string,
      options?: ReportRampIncidentOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      if (!isFlightReportMilestoneCode(code) || !isDateTimeOffset(occurredAt))
        throw new TypeError("The Flight Report milestone is invalid.");
      return rampExecution(getRecordRampMilestoneUrl(operation, code), operation, { occurredAt },
        installationId, idempotencyKey, options);
    },
    async getRampOperationDocuments(operationId: string, options?: ReportRampIncidentOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(getGetRampOperationDocumentsUrl(operation), { ...options, method: "GET" }, true);
      if (!isOperationDocumentsResponse(result.data, operation)) throw malformedResponse(result.status);
      return result.data;
    },
    async signRampOperationDocument(
      operationId: string, kind: OperationDocumentKind, role: OperationSignatureRole, command: SignOperationDocumentCommand,
      installationId: string, idempotencyKey: string, options?: ReportRampIncidentOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const body = normalizedSignature(command);
      if (!isOperationDocumentKind(kind) || !isOperationSignatureRole(role) || body === null)
        throw new TypeError("The signature is invalid.");
      return documentWrite(getSignRampOperationDocumentUrl(operation, kind, role), operation, body, installationId,
        idempotencyKey, options);
    },
    async recordRampDamageMark(
      operationId: string, markId: string, command: RecordDamageMarkCommand, installationId: string, idempotencyKey: string,
      options?: ReportRampIncidentOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const mark = validatedUuid(markId, "markId");
      if (!isValidDamageMark(command)) throw new TypeError("The damage mark is invalid.");
      return documentWrite(getRecordRampDamageMarkUrl(operation, mark), operation, {
        x: command.x, y: command.y, note: command.note.trim(), reportedAt: command.reportedAt }, installationId,
        idempotencyKey, options);
    },
    async attachRampDamagePhoto(
      operationId: string, markId: string, photo: Blob, contentType: "image/jpeg" | "image/png", installationId: string,
      options?: ReportRampIncidentOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const mark = validatedUuid(markId, "markId");
      if (contentType !== "image/jpeg" && contentType !== "image/png") throw new TypeError("The photo type is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", contentType);
      headers.set("x-elevant-installation-id", validatedUuid(installationId, "installationId"));
      const result = await execute(getAttachRampDamagePhotoUrl(operation, mark),
        { ...options, method: "PUT", headers, body: photo }, true);
      if (!isOperationDocumentsResponse(result.data, operation)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOccOperationDocuments(operationId: string, options?: GetHumanResourcesReportOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(getGetOccOperationDocumentsUrl(operation), { ...options, method: "GET" }, true);
      if (!isOperationDocumentsResponse(result.data, operation)) throw malformedResponse(result.status);
      return result.data;
    },
    downloadOccOperationDocument(operationId: string, kind: OperationDocumentKind, options?: GetHumanResourcesReportOptions) {
      if (!isOperationDocumentKind(kind)) throw new TypeError("The form kind is invalid.");
      return executeReportDocument(getGetOccOperationDocumentPdfUrl(validatedUuid(operationId, "operationId"), kind),
        "pdf", options);
    },
    async getOccDamagePhoto(operationId: string, markId: string, options?: GetHumanResourcesReportOptions) {
      const path = getGetOccDamagePhotoUrl(validatedUuid(operationId, "operationId"), validatedUuid(markId, "markId"));
      const response = await send(path, { ...options, method: "GET" }, true);
      const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (mime !== "image/jpeg" && mime !== "image/png") throw malformedResponse(response.status);
      const declaredLength = response.headers.get("content-length");
      if (declaredLength && Number(declaredLength) > MAXIMUM_DAMAGE_PHOTO_BYTES) throw malformedResponse(response.status);
      let bytes: ArrayBuffer;
      try {
        bytes = await response.arrayBuffer();
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw malformedResponse(response.status);
      }
      // The bytes must be the image the header names: the same magic numbers the server sniffs on upload (ADR-0032).
      const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
      const signature = mime === "image/jpeg" ? [0xff, 0xd8, 0xff] : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (bytes.byteLength > MAXIMUM_DAMAGE_PHOTO_BYTES || bytes.byteLength < signature.length ||
          !signature.every((value, index) => header[index] === value))
        throw malformedResponse(response.status);
      return new Blob([bytes], { type: mime });
    },
    async getAirlineServiceOrder(operationId: string, options?: GetHumanResourcesReportOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(getGetAirlineServiceOrderUrl(operation), { ...options, method: "GET" }, true);
      if (!isAirlineServiceOrderResponse(result.data, operation)) throw malformedResponse(result.status);
      return result.data;
    },
    downloadAirlineServiceOrder(operationId: string, options?: GetHumanResourcesReportOptions) {
      return executeReportDocument(getGetAirlineServiceOrderPdfUrl(validatedUuid(operationId, "operationId")), "pdf",
        options);
    },
    async getRampCharter(operationId: string, options?: ReportRampIncidentOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(getGetRampCharterUrl(operation), { ...options, method: "GET" }, true);
      if (!isRampCharterResponse(result.data, operation)) throw malformedResponse(result.status);
      return result.data;
    },
    async addRampCharterService(operationId: string, command: AddCharterServiceCommand, installationId: string,
      idempotencyKey: string, options?: ReportRampIncidentOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const body = normalizedCharterService(command);
      if (body === null) throw new TypeError("The charter service is invalid.");
      return charterWrite(getAddRampCharterServiceUrl(operation), "POST", operation, body, installationId,
        idempotencyKey, options);
    },
    async updateRampCharterDetails(operationId: string, command: CharterDetailsCommand, installationId: string,
      idempotencyKey: string, options?: ReportRampIncidentOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const body = normalizedCharterDetails(command);
      if (body === null) throw new TypeError("The charter details are invalid.");
      return charterWrite(getUpdateRampCharterDetailsUrl(operation), "PUT", operation, body, installationId,
        idempotencyKey, options);
    },
    async getFinanceCharters(options?: GetHumanResourcesReportOptions) {
      const result = await execute(getGetFinanceChartersUrl(), { ...options, method: "GET" }, true);
      if (!isFinanceCharterListResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async confirmFinanceCharterPrepayment(charterId: string, command: ConfirmCharterPrepaymentCommand,
      options?: GetHumanResourcesReportOptions) {
      const charter = validatedUuid(charterId, "charterId");
      const body = normalizedPrepayment(command);
      if (body === null) throw new TypeError("The prepayment is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getConfirmFinanceCharterPrepaymentUrl(charter),
        { ...options, method: "PUT", headers, body: JSON.stringify(body) }, true);
      if (!isFinanceCharterResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async reopenFinanceCharterPrepayment(charterId: string, command: ReopenCharterPrepaymentCommand,
      idempotencyKey: string, options?: GetHumanResourcesReportOptions) {
      const charter = validatedUuid(charterId, "charterId");
      const body = normalizedPrepaymentReopening(command);
      if (body === null) throw new TypeError("The prepayment reopening is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", validatedUuid(idempotencyKey, "idempotencyKey"));
      const result = await execute(getReopenFinanceCharterPrepaymentUrl(charter),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (!isFinanceCharterResponse(result.data) || result.data.id.toLowerCase() !== charter)
        throw malformedResponse(result.status);
      return result.data;
    },
    async updateRampFlightData(
      operationId: string, request: RampFlightDataCommand, installationId: string, idempotencyKey: string,
      options?: ReportRampIncidentOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const registration = typeof request?.aircraftRegistration === "string" && request.aircraftRegistration.trim()
        ? request.aircraftRegistration.trim().toUpperCase() : null;
      if (!isRecord(request) || (request.passengersIn !== null && !isPassengerCount(request.passengersIn)) ||
          (request.passengersOut !== null && !isPassengerCount(request.passengersOut)) ||
          (request.mtowKg !== null && !isMtow(request.mtowKg)) ||
          (registration !== null && !/^[A-Z0-9-]{2,10}$/.test(registration)) ||
          (request.aircraftTypeId != null && !isUuid(request.aircraftTypeId)))
        throw new TypeError("The flight data is invalid.");
      // 3-B: without an aircraft type the body is the one older tablets send, so the server keeps its receipt hash.
      return rampExecution(getUpdateRampFlightDataUrl(operation), operation, {
        passengersIn: request.passengersIn, passengersOut: request.passengersOut, mtowKg: request.mtowKg,
        aircraftRegistration: registration,
        ...(typeof request.aircraftTypeId === "string" && { aircraftTypeId: request.aircraftTypeId }) },
        installationId, idempotencyKey, options);
    },
    async reportRampIncident(
      operationId: string,
      request: ReportRampIncidentRequest,
      installationId: string,
      idempotencyKey: string,
      options?: ReportRampIncidentOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const report = validatedIncidentReportRequest(request);
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(
        getReportRampIncidentUrl(operation),
        { ...options, method: "POST", headers, body: JSON.stringify(report) },
        true,
      );
      if (!isRampIncidentReceiptResponse(
        result.data, operation, commandKey, report.occurredAt,
      )) throw malformedResponse(result.status);
      return result.data;
    },
    async submitRampOperation(
      operationId: string,
      request: SubmitRampOperationRequest,
      installationId: string,
      idempotencyKey: string,
      options?: SubmitRampOperationOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const submission = validatedRampOperationSubmissionRequest(request);
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(
        getSubmitRampOperationUrl(operation),
        { ...options, method: "POST", headers, body: JSON.stringify(submission) },
        true,
      );
      if (!isRampOperationSubmissionResponse(
        result.data, operation, commandKey, submission.agentNote ?? null,
      )) throw malformedResponse(result.status);
      return result.data;
    },
    async reopenRampOperationCorrection(
      operationId: string, installationId: string,
      idempotencyKey: string, options?: ReopenRampOperationCorrectionOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(getReopenRampOperationCorrectionUrl(operation),
        { ...options, method: "POST", headers }, true);
      if (!isRampOperationCorrectionResponse(result.data, operation, commandKey))
        throw malformedResponse(result.status);
      return result.data;
    },
    async submitRampOperationChecklist(
      operationId: string,
      request: SubmitRampOperationChecklistRequest,
      installationId: string,
      idempotencyKey: string,
      options?: SubmitRampOperationChecklistOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const submission = validatedChecklistSubmissionRequest(request);
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(
        getSubmitRampOperationChecklistUrl(operation),
        {
          ...options,
          method: "POST",
          headers,
          body: JSON.stringify(submission),
        },
        true,
      );
      if (
        !isRampChecklistSubmissionResponse(
          result.data,
          submission.checklistId,
          submission.answers.length,
        )
      ) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async transitionRampOperationService(
      operationId: string,
      serviceId: string,
      request: TransitionRampOperationServiceRequest,
      installationId: string,
      idempotencyKey: string,
      options?: TransitionRampOperationServiceOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const service = validatedUuid(serviceId, "serviceId");
      const transition = validatedServiceTransitionRequest(request);
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(
        getTransitionRampOperationServiceUrl(operation, service),
        {
          ...options,
          method: "POST",
          headers,
          body: JSON.stringify(transition),
        },
        true,
      );
      if (
        !isRampOperationServiceTransitionResponse(
          result.data,
          service,
          transition.targetStatus,
        )
      ) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getRampOperationCharges(
      operationId: string,
      installationId: string,
      options?: GetRampOperationChargesOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const installation = validatedUuid(installationId, "installationId");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("x-elevant-installation-id", installation);
      const result = await execute(
        getGetRampOperationChargesUrl(operation),
        { ...options, method: "GET", headers },
        true,
      );
      if (!isRampOperationChargesResponse(result.data, operation)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async applyRampServiceCharge(
      operationId: string,
      serviceId: string,
      request: ApplyRampServiceChargeRequest,
      installationId: string,
      idempotencyKey: string,
      options?: ApplyRampServiceChargeOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const service = validatedUuid(serviceId, "serviceId");
      if (
        !isRecord(request) ||
        !hasOnlyKeys(request, ["chargeId", "action"]) ||
        (request.action !== "Apply" && request.action !== "Remove")
      ) {
        throw new TypeError("Ramp service charge request is invalid.");
      }
      const charge = validatedUuid(request.chargeId, "chargeId");
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(
        getApplyRampServiceChargeUrl(operation, service),
        {
          ...options,
          method: "POST",
          headers,
          body: JSON.stringify({ chargeId: charge, action: request.action }),
        },
        true,
      );
      if (!isRampServiceChargeCommandResponse(result.data, service)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getSystemPing(options?: GetSystemPingOptions) {
      const result = await execute(getGetSystemPingUrl(), {
        ...options,
        method: "GET",
      });
      if (!isSystemPingResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
  });
}
