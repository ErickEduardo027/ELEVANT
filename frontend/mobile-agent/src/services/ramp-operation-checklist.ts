import type {
  GetRampOperationChecklistOptions,
  GetRampOperationChecklistResponse as ApiGetRampOperationChecklistResponse,
  RampChecklistAnswerRequest as ApiRampChecklistAnswerRequest,
  RampChecklistAnswerResponse as ApiRampChecklistAnswerResponse,
  RampChecklistItemResponse as ApiRampChecklistItemResponse,
  RampChecklistResponse as ApiRampChecklistResponse,
  RampChecklistSectionResponse as ApiRampChecklistSectionResponse,
  RampChecklistSubmissionResponse as ApiRampChecklistSubmissionResponse,
  RampChecklistSubmissionSummaryResponse as ApiRampChecklistSubmissionSummaryResponse,
  RampChecklistTemplateResponse,
  SubmitRampOperationChecklistRequest as ApiSubmitRampOperationChecklistRequest,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  readRampChecklistCacheIfCurrent,
  readRampChecklistDraftIfCurrent,
  removeRampChecklistDraftIfCurrent,
  writeRampChecklistCacheIfCurrent,
  writeRampChecklistDraftIfCurrent,
} from '../storage/mobile-session';
import { discardFlightReportItem, readOperationQueue, sendFlightReportCommand } from './flight-report';
import {
  getMobileSessionRequestContext,
  MobileServiceError,
  rejectMobileSessionRequest,
} from './mobile-auth';
import { asMobileServiceError } from './mobile-service-error';

const DRAFT_SCHEMA_VERSION = 1 as const;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RampChecklistAnswerValue = 'Ok' | 'NotApplicable' | 'NotOk';
export type RampChecklistStatus = 'NotStarted' | 'InProgress' | 'Submitted';

export type RampChecklistItemAnswer = Readonly<Omit<
  ApiRampChecklistAnswerResponse,
  'value' | 'note'
> & {
  value: RampChecklistAnswerValue;
  note?: string;
}>;

export type RampChecklistItem = Readonly<Omit<
  ApiRampChecklistItemResponse,
  'answer'
> & {
  answer?: RampChecklistItemAnswer;
}>;

export type RampChecklistSection = Readonly<Omit<
  ApiRampChecklistSectionResponse,
  'items'
> & {
  items: readonly RampChecklistItem[];
}>;

type RampChecklistSnapshot = Readonly<Omit<
  ApiRampChecklistResponse,
  'status' | 'startedAt' | 'submittedAt' | 'template' | 'sections'
> & {
    status: RampChecklistStatus;
    startedAt: string | null;
    submittedAt: string | null;
    template: Readonly<RampChecklistTemplateResponse>;
    sections: readonly RampChecklistSection[];
}>;

export type GetRampOperationChecklistResponse = Readonly<Omit<
  ApiGetRampOperationChecklistResponse,
  'checklist'
> & {
  checklist: RampChecklistSnapshot;
  /** True when ELEVANT could not be reached and the last copy saved on the device is shown (3-I). */
  fromCache?: boolean;
}>;

export type RampChecklistDraftAnswer = Readonly<{
  value: RampChecklistAnswerValue;
  note?: string;
}>;

export type RampChecklistDraft = Readonly<{
  schemaVersion: typeof DRAFT_SCHEMA_VERSION;
  checklistId: string;
  answers: Readonly<Record<string, RampChecklistDraftAnswer>>;
}>;

export type RampChecklistAnswerRequest = Readonly<Omit<
  ApiRampChecklistAnswerRequest,
  'value' | 'note'
> & {
  value: RampChecklistAnswerValue;
  note?: string;
}>;

export type SubmitRampOperationChecklistRequest = Readonly<Omit<
  ApiSubmitRampOperationChecklistRequest,
  'answers'
> & {
  answers: RampChecklistAnswerRequest[];
}>;

export type RampChecklistSubmissionSummaryResponse = Readonly<Omit<
  ApiRampChecklistSubmissionSummaryResponse,
  'status'
> & {
  status: 'Submitted';
}>;

export type RampChecklistSubmissionResponse = Readonly<Omit<
  ApiRampChecklistSubmissionResponse,
  'checklist'
> & {
  checklist: RampChecklistSubmissionSummaryResponse;
}>;

export type RampChecklistPendingSubmission = Readonly<{
  idempotencyKey: string;
  request: SubmitRampOperationChecklistRequest;
}>;

export type RampChecklistRequestOptions = Readonly<Omit<
  GetRampOperationChecklistOptions,
  'signal'
> & {
  signal?: AbortSignal;
}>;

function apiClient(accessToken: string) {
  return createMobileAgentApiClient({
    getAccessToken: () => accessToken,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000'
  );
}

function isNonEmptyText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  );
}

function isNullableTimestamp(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' && Number.isFinite(Date.parse(value)))
  );
}

function isAnswerValue(value: unknown): value is RampChecklistAnswerValue {
  return value === 'Ok' || value === 'NotApplicable' || value === 'NotOk';
}

function isChecklistStatus(value: unknown): value is RampChecklistStatus {
  return value === 'NotStarted' || value === 'InProgress' || value === 'Submitted';
}

function parseChecklistAnswer(value: unknown): RampChecklistItemAnswer | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['value', 'note', 'answeredAt']) ||
    !isAnswerValue(value.value) ||
    !isNullableTimestamp(value.answeredAt) ||
    value.answeredAt === null ||
    (value.note !== undefined && value.note !== null && !isNonEmptyText(value.note, 1_000))
  ) {
    return undefined;
  }
  return {
    value: value.value,
    answeredAt: value.answeredAt,
    ...(typeof value.note === 'string' ? { note: value.note } : {}),
  };
}

function parseChecklistItem(value: unknown): RampChecklistItem | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'code',
      'label',
      'sortOrder',
      'isRequired',
      'requiresNoteWhenNotOk',
      'answer',
    ]) ||
    !isUuid(value.id) ||
    !isNonEmptyText(value.code, 100) ||
    !isNonEmptyText(value.label, 500) ||
    !Number.isInteger(value.sortOrder) ||
    (value.sortOrder as number) < 0 ||
    typeof value.isRequired !== 'boolean' ||
    typeof value.requiresNoteWhenNotOk !== 'boolean'
  ) {
    return undefined;
  }
  const answer = value.answer === undefined || value.answer === null
    ? undefined
    : parseChecklistAnswer(value.answer);
  if (value.answer !== undefined && value.answer !== null && !answer) return undefined;
  return {
    id: value.id.toLowerCase(),
    code: value.code,
    label: value.label,
    sortOrder: value.sortOrder as number,
    isRequired: value.isRequired,
    requiresNoteWhenNotOk: value.requiresNoteWhenNotOk,
    ...(answer ? { answer } : {}),
  };
}

function parseChecklistResponse(
  value: unknown,
  expectedOperationId: string,
): GetRampOperationChecklistResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['operationId', 'checklist']) ||
    !isUuid(value.operationId) ||
    value.operationId.toLowerCase() !== expectedOperationId.toLowerCase() ||
    !isRecord(value.checklist)
  ) {
    throw new MobileServiceError('malformed_response');
  }
  const checklist = value.checklist;
  if (
    !hasOnlyKeys(checklist, [
      'id',
      'status',
      'startedAt',
      'submittedAt',
      'template',
      'sections',
    ]) ||
    !isUuid(checklist.id) ||
    !isChecklistStatus(checklist.status) ||
    !isNullableTimestamp(checklist.startedAt) ||
    !isNullableTimestamp(checklist.submittedAt) ||
    !isRecord(checklist.template) ||
    !hasOnlyKeys(checklist.template, ['code', 'name', 'version']) ||
    !isNonEmptyText(checklist.template.code, 100) ||
    !isNonEmptyText(checklist.template.name, 200) ||
    !Number.isInteger(checklist.template.version) ||
    (checklist.template.version as number) < 1 ||
    !Array.isArray(checklist.sections) ||
    checklist.sections.length === 0
  ) {
    throw new MobileServiceError('malformed_response');
  }

  const itemIds = new Set<string>();
  const sections: RampChecklistSection[] = [];
  for (const candidate of checklist.sections) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, ['name', 'items']) ||
      !isNonEmptyText(candidate.name, 200) ||
      !Array.isArray(candidate.items) ||
      candidate.items.length === 0
    ) {
      throw new MobileServiceError('malformed_response');
    }
    const items = candidate.items.map(parseChecklistItem);
    if (items.some((item) => item === undefined)) {
      throw new MobileServiceError('malformed_response');
    }
    for (const item of items as RampChecklistItem[]) {
      if (itemIds.has(item.id)) throw new MobileServiceError('malformed_response');
      itemIds.add(item.id);
    }
    sections.push({ name: candidate.name, items: items as RampChecklistItem[] });
  }

  return {
    operationId: value.operationId.toLowerCase(),
    checklist: {
      id: checklist.id.toLowerCase(),
      status: checklist.status,
      startedAt: checklist.startedAt,
      submittedAt: checklist.submittedAt,
      template: {
        code: checklist.template.code,
        name: checklist.template.name,
        version: checklist.template.version as number,
      },
      sections,
    },
  };
}

function parseDraftAnswer(value: unknown): RampChecklistDraftAnswer | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['value', 'note']) ||
    !isAnswerValue(value.value) ||
    (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 1_000))
  ) {
    return undefined;
  }
  return {
    value: value.value,
    ...(typeof value.note === 'string' ? { note: value.note } : {}),
  };
}

function parseDraft(raw: string | null, checklistId: string): RampChecklistDraft | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['schemaVersion', 'checklistId', 'answers']) ||
    value.schemaVersion !== DRAFT_SCHEMA_VERSION ||
    !isUuid(value.checklistId) ||
    value.checklistId.toLowerCase() !== checklistId.toLowerCase() ||
    !isRecord(value.answers)
  ) {
    return null;
  }
  const answers: Record<string, RampChecklistDraftAnswer> = {};
  for (const [itemId, candidate] of Object.entries(value.answers)) {
    const answer = parseDraftAnswer(candidate);
    if (!isUuid(itemId) || !answer) return null;
    answers[itemId.toLowerCase()] = answer;
  }
  return {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    checklistId: checklistId.toLowerCase(),
    answers,
  };
}

function parseSubmitRequest(value: unknown): SubmitRampOperationChecklistRequest | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['checklistId', 'answers']) ||
    !isUuid(value.checklistId) ||
    !Array.isArray(value.answers) ||
    value.answers.length === 0 ||
    value.answers.length > 256
  ) {
    return undefined;
  }
  const itemIds = new Set<string>();
  const answers: { itemId: string; value: RampChecklistAnswerValue; note?: string }[] = [];
  for (const candidate of value.answers) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, ['itemId', 'value', 'note']) ||
      !isUuid(candidate.itemId) ||
      !isAnswerValue(candidate.value) ||
      (candidate.note !== undefined && !isNonEmptyText(candidate.note, 1_000))
    ) {
      return undefined;
    }
    const itemId = candidate.itemId.toLowerCase();
    if (itemIds.has(itemId)) return undefined;
    itemIds.add(itemId);
    answers.push({
      itemId,
      value: candidate.value,
      ...(typeof candidate.note === 'string' ? { note: candidate.note } : {}),
    });
  }
  return { checklistId: value.checklistId.toLowerCase(), answers };
}

function parseSubmitResponse(
  value: unknown,
  expectedChecklistId: string,
): RampChecklistSubmissionResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['receiptId', 'checklist']) ||
    !isUuid(value.receiptId) ||
    !isRecord(value.checklist) ||
    !hasOnlyKeys(value.checklist, [
      'id',
      'status',
      'startedAt',
      'submittedAt',
      'answerCount',
    ]) ||
    !isUuid(value.checklist.id) ||
    value.checklist.id.toLowerCase() !== expectedChecklistId.toLowerCase() ||
    value.checklist.status !== 'Submitted' ||
    !isNullableTimestamp(value.checklist.startedAt) ||
    value.checklist.startedAt === null ||
    !isNullableTimestamp(value.checklist.submittedAt) ||
    value.checklist.submittedAt === null ||
    !Number.isInteger(value.checklist.answerCount) ||
    (value.checklist.answerCount as number) < 0
  ) {
    throw new MobileServiceError('malformed_response');
  }
  return {
    receiptId: value.receiptId.toLowerCase(),
    checklist: {
      id: value.checklist.id.toLowerCase(),
      status: 'Submitted',
      startedAt: value.checklist.startedAt,
      submittedAt: value.checklist.submittedAt,
      answerCount: value.checklist.answerCount as number,
    },
  };
}

async function confirmSameSession(sessionId: string) {
  const confirmed = await getMobileSessionRequestContext();
  if (confirmed.sessionId !== sessionId) {
    throw new MobileServiceError('cancelled');
  }
  return confirmed;
}

async function rejectIfUnauthorized(sessionId: string, error: unknown): Promise<never> {
  const normalized = asMobileServiceError(error);
  if (normalized.code === 'unauthenticated' || normalized.code === 'forbidden') {
    const cleared = await rejectMobileSessionRequest(sessionId);
    if (!cleared) throw new MobileServiceError('cancelled');
  }
  throw normalized;
}

/**
 * The operation's checklist. The last copy ELEVANT returned stays on the device for this account (3-I): without
 * signal the agent opens it from there, answers it and sends it to the queue; the copy is flagged as cached.
 */
export async function getRampOperationChecklist(
  operationId: string,
  options: RampChecklistRequestOptions = {},
): Promise<GetRampOperationChecklistResponse> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  const accountId = context.session.actor.accountId;
  try {
    const value = await apiClient(context.accessToken).getRampOperationChecklist(
      operationId,
      { signal: options.signal },
    );
    await confirmSameSession(context.sessionId);
    const checklist = parseChecklistResponse(value, operationId);
    await writeRampChecklistCacheIfCurrent(context.sessionId, accountId, operationId, JSON.stringify(value))
      .catch(() => undefined);
    return checklist;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (normalized.code === 'network_unavailable' || normalized.code === 'request_timeout') {
      const cached = await readRampChecklistCacheIfCurrent(context.sessionId, accountId, operationId)
        .catch(() => null);
      if (cached?.kind === 'current' && cached.value !== null) {
        try {
          return { ...parseChecklistResponse(JSON.parse(cached.value) as unknown, operationId), fromCache: true };
        } catch {
          // A copy that no longer reads is not shown; the screen explains it is offline.
        }
      }
    }
    return rejectIfUnauthorized(context.sessionId, normalized);
  }
}

export async function readRampOperationChecklistDraft(
  operationId: string,
  checklistId: string,
): Promise<RampChecklistDraft | null> {
  if (!isUuid(operationId) || !isUuid(checklistId)) {
    throw new MobileServiceError('request_failed');
  }
  const context = await getMobileSessionRequestContext();
  try {
    const result = await readRampChecklistDraftIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
      checklistId,
    );
    if (result.kind !== 'current') throw new MobileServiceError('cancelled');
    return parseDraft(result.value, checklistId);
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

export async function saveRampOperationChecklistDraft(
  operationId: string,
  draft: RampChecklistDraft,
): Promise<void> {
  if (!isUuid(operationId) || !isUuid(draft.checklistId)) {
    throw new MobileServiceError('request_failed');
  }
  const serialized = JSON.stringify(draft);
  if (!parseDraft(serialized, draft.checklistId)) {
    throw new MobileServiceError('request_failed');
  }
  const context = await getMobileSessionRequestContext();
  try {
    const result = await writeRampChecklistDraftIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
      draft.checklistId,
      serialized,
    );
    if (result !== 'written') throw new MobileServiceError('cancelled');
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

/** The submission of this checklist still saved on the device (3-I), or null. */
export async function readRampChecklistPendingSubmission(
  operationId: string,
  checklistId: string,
): Promise<RampChecklistPendingSubmission | null> {
  if (!isUuid(operationId) || !isUuid(checklistId)) {
    throw new MobileServiceError('request_failed');
  }
  try {
    const queued = (await readOperationQueue(operationId)).checklists.find(item =>
      item.state === 'pending' && item.command.kind === 'checklistSubmit' &&
      item.command.checklistId.toLowerCase() === checklistId.toLowerCase());
    if (!queued || queued.command.kind !== 'checklistSubmit') return null;
    const request = parseSubmitRequest({ checklistId: queued.command.checklistId, answers: queued.command.answers });
    if (!request) throw new MobileServiceError('storage_unavailable');
    return { idempotencyKey: queued.idempotencyKey, request };
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

/**
 * What happened to «Enviar checklist» (3-I): ELEVANT confirmed it, or it is saved on the device and goes out on its
 * own after the operation's earlier commands. A refusal is thrown with its Problem Details code.
 */
export type RampChecklistSubmissionOutcome =
  | Readonly<{ state: 'confirmed'; response: RampChecklistSubmissionResponse }>
  | Readonly<{ state: 'queued'; issue?: MobileServiceError }>;

/**
 * Sends the checklist through the device's queue (3-I). A submission of this checklist already waiting is sent again
 * with its key and body; one ELEVANT refused before gives way to this one. The draft is removed once ELEVANT confirms
 * the answers.
 */
export async function submitRampOperationChecklist(
  operationId: string,
  request: SubmitRampOperationChecklistRequest,
  _options: RampChecklistRequestOptions = {},
): Promise<RampChecklistSubmissionOutcome> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const validatedRequest = parseSubmitRequest(request);
  if (!validatedRequest) throw new MobileServiceError('request_failed');
  const queue = await readOperationQueue(operationId);
  const same = queue.checklists.filter(item => item.command.kind === 'checklistSubmit' &&
    item.command.checklistId.toLowerCase() === validatedRequest.checklistId);
  const waiting = same.find(item => item.state === 'pending');
  for (const refused of same.filter(item => item.state === 'blocked')) {
    await discardFlightReportItem(refused.idempotencyKey);
  }
  const command = waiting?.command.kind === 'checklistSubmit' ? waiting.command : {
    kind: 'checklistSubmit' as const,
    operationId: operationId.toLowerCase(),
    checklistId: validatedRequest.checklistId,
    answers: validatedRequest.answers.map(answer => ({ ...answer })),
  };
  const sent = await sendFlightReportCommand(command, {
    discardRefused: true,
    ...(waiting ? { idempotencyKey: waiting.idempotencyKey } : {}),
  });
  if (sent.state === 'queued') return { state: 'queued', ...(sent.issue ? { issue: sent.issue } : {}) };
  const response = parseSubmitResponse(sent.result, validatedRequest.checklistId);
  const context = await getMobileSessionRequestContext();
  await removeRampChecklistDraftIfCurrent(context.sessionId, context.session.actor.accountId, operationId,
    validatedRequest.checklistId).catch(() => undefined);
  return { state: 'confirmed', response };
}
