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
  getOrCreateRampChecklistSubmitCommandIfCurrent,
  readRampChecklistDraftIfCurrent,
  readRampChecklistSubmitCommandIfCurrent,
  removeRampChecklistDraftIfCurrent,
  removeRampChecklistSubmitCommandIfCurrent,
  writeRampChecklistDraftIfCurrent,
} from '../storage/mobile-session';
import {
  getMobileSessionRequestContext,
  MobileServiceError,
  rejectMobileSessionRequest,
} from './mobile-auth';
import { registerCurrentMobileDevice } from './mobile-device';
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

export async function getRampOperationChecklist(
  operationId: string,
  options: RampChecklistRequestOptions = {},
): Promise<GetRampOperationChecklistResponse> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  try {
    const value = await apiClient(context.accessToken).getRampOperationChecklist(
      operationId,
      { signal: options.signal },
    );
    await confirmSameSession(context.sessionId);
    return parseChecklistResponse(value, operationId);
  } catch (error) {
    return rejectIfUnauthorized(context.sessionId, error);
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

export async function readRampChecklistPendingSubmission(
  operationId: string,
  checklistId: string,
): Promise<RampChecklistPendingSubmission | null> {
  if (!isUuid(operationId) || !isUuid(checklistId)) {
    throw new MobileServiceError('request_failed');
  }
  const context = await getMobileSessionRequestContext();
  try {
    const result = await readRampChecklistSubmitCommandIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
      checklistId,
    );
    if (result.kind !== 'current') throw new MobileServiceError('cancelled');
    if (!result.command) return null;
    const request = parseSubmitRequest(JSON.parse(result.command.payload) as unknown);
    if (!request || request.checklistId !== checklistId.toLowerCase()) {
      throw new MobileServiceError('storage_unavailable');
    }
    return { idempotencyKey: result.command.idempotencyKey, request };
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

export async function submitRampOperationChecklist(
  operationId: string,
  request: SubmitRampOperationChecklistRequest,
  options: RampChecklistRequestOptions = {},
): Promise<RampChecklistSubmissionResponse> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const validatedRequest = parseSubmitRequest(request);
  if (!validatedRequest) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  let reservedIdempotencyKey: string | undefined;
  try {
    const command = await getOrCreateRampChecklistSubmitCommandIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
      validatedRequest.checklistId,
      JSON.stringify(validatedRequest),
    );
    if (command.kind !== 'current') throw new MobileServiceError('cancelled');
    reservedIdempotencyKey = command.idempotencyKey;
    const frozenRequest = parseSubmitRequest(JSON.parse(command.payload) as unknown);
    if (!frozenRequest || frozenRequest.checklistId !== validatedRequest.checklistId) {
      throw new MobileServiceError('storage_unavailable');
    }

    const device = await registerCurrentMobileDevice(
      { accessToken: context.accessToken },
      options,
    );
    const confirmed = await confirmSameSession(context.sessionId);
    const value = await apiClient(confirmed.accessToken).submitRampOperationChecklist(
      operationId,
      frozenRequest,
      device.installationId,
      command.idempotencyKey,
      { signal: options.signal },
    );
    await confirmSameSession(context.sessionId);
    const response = parseSubmitResponse(value, frozenRequest.checklistId);
    const removed = await removeRampChecklistDraftIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
      frozenRequest.checklistId,
    );
    if (removed !== 'removed') throw new MobileServiceError('cancelled');
    const commandRemoved = await removeRampChecklistSubmitCommandIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
      frozenRequest.checklistId,
      command.idempotencyKey,
    );
    if (commandRemoved === 'not-current') {
      throw new MobileServiceError('cancelled');
    }
    return response;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (isDeterministicWriteRejection(normalized) && reservedIdempotencyKey) {
      try {
        const removed = await removeRampChecklistSubmitCommandIfCurrent(
          context.sessionId,
          context.session.actor.accountId,
          operationId,
          validatedRequest.checklistId,
          reservedIdempotencyKey,
        );
        if (removed === 'not-current') throw new MobileServiceError('cancelled');
      } catch (removalError) {
        throw asMobileServiceError(removalError);
      }
    }
    return rejectIfUnauthorized(context.sessionId, normalized);
  }
}

function isDeterministicWriteRejection(error: MobileServiceError) {
  return (
    error.code === 'not_found' ||
    error.code === 'conflict' ||
    error.status === 400 ||
    error.status === 413 ||
    error.status === 415
  );
}
