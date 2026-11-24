import type {
  OperationDocumentsResponse,
  RampAssignedOperationResponse,
  RampFlightLegResponse,
  RampGroundOperationResponse,
  RampOperationServiceResponse,
} from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { subscribeMobileChanges } from '../../services/mobile-change-feed';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Card, Hint, Notice, PrimaryButton, SectionHeader, StatusPill } from '../../components/ui';
import { OperationHero } from '../../components/operation-hero';
import { LegTimes } from '../../components/flight-board';
import { useMinuteClock } from '../../hooks/use-minute-clock';
import { AttendanceDraftCard } from '../../components/attendance-draft-card';
import { HandoffRequirementList, HandoffSheet } from '../../components/handoff-requirements';
import {
  RampServiceExecutionCard,
  type ServiceExecutionNotice,
} from '../../components/ramp-service-execution-card';
import { RampOperationChargesCard, type ChargesExecutionClosed } from '../../components/ramp-operation-charges-card';
import { OperationTabBar } from '../../components/operation-tab-bar';
import {
  assignmentPositionLabel,
  assignmentRoleLabel,
  serviceChangeSentence,
} from '../../features/assigned-operations/presentation';
import { getAssignedOperations } from '../../services/assigned-operations';
import { MobileServiceError } from '../../services/mobile-auth';
import { explainsProblem } from '../../services/mobile-service-error';
import { startAssignedRampOperation } from '../../services/ramp-operation-start';
import {
  readPendingRampCorrection,
  reopenRampOperationCorrection,
} from '../../services/ramp-operation-correction';
import {
  readRampOperationPendingSubmission,
  submitRampOperation,
  type RampOperationPendingSubmission,
} from '../../services/ramp-operation-submission';
import {
  checklistQueuedFor,
  checklistStanding,
  flightDataQueuedFor,
  handoffHoldsFor,
  handoffRequirements,
  isHandoffHold,
  isServiceFinished,
  serviceOrderHasSignature,
  type ChecklistStanding,
  type HandoffChecklistRead,
  type HandoffRequirement,
} from '../../features/assigned-operations/handoff';
import { operationTabProgress, type OperationTab } from '../../features/assigned-operations/operation-tabs';
import { isPushbackRecorded } from '../../features/assigned-operations/pushback-recorded';
import { getRampOperationChecklist } from '../../services/ramp-operation-checklist';
import { countUnsentRampIncidents } from '../../services/ramp-incidents';
import {
  transitionRampOperationService,
  type RampOperationServiceExecutionResponse,
  type TransitionRampOperationServiceRequest,
} from '../../services/ramp-operation-service-execution';
import { subscribeFlightReport } from '../../services/flight-report';
import type { FlightReportOutboxItem } from '../../synchronization/flight-report-outbox';
import { projectRampOperation } from '../../synchronization/ramp-command-projection';
import { colors } from '../../theme/colors';
import { radius, space, type } from '../../theme/tokens';
import { resetToLogin } from '../../utils/session-navigation';
import { formatStationDateTime, stationTimeTitle } from '../../utils/date-format';
import { ConnectionBadge } from '../../components/flight-report/connection-badge';
import { DocumentsPanel, WalkaroundCard } from '../../components/documents/operation-documents';
import { CharterCard } from '../../components/documents/charter-card';
import { DeviationAction, FlightDataCard, FlightReportPanel } from '../../components/flight-report/flight-report-panel';

type DetailState = 'loading' | 'ready' | 'not-found' | 'offline' | 'unavailable';
type StartNotice = Readonly<{
  tone: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}>;

/** N6: what the agent does when the tablet could not keep a command; the lock of the device is never the cause. */
const LOCAL_SAVE_WAY_OUT = 'Vuelve a intentarlo; si sigue fallando, cierra la app, ábrela de nuevo y avisa a OCC.';

/**
 * N13 (D-N13): the service notices that stay when a service's change starts or ELEVANT confirms it: the warnings and
 * errors of the other services. Confirmations do not pile up, and the service's own notice is replaced.
 */
function withoutConfirmations(
  notices: Readonly<Record<string, ServiceExecutionNotice>>,
  serviceId: string,
): Readonly<Record<string, ServiceExecutionNotice>> {
  return Object.fromEntries(Object.entries(notices)
    .filter(([id, notice]) => id !== serviceId && notice.tone !== 'success'));
}

export default function OperationDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <OperationDetail operationId={id} />;
}

/** Manifiesto de una operación; la ruta lo usa a pantalla completa y el inicio en tablet lo muestra junto a la lista. */
export function OperationDetail({ operationId: id }: Readonly<{ operationId?: string }>) {
  const [operation, setOperation] = useState<RampAssignedOperationResponse | null>(null);
  const [focused, setFocused] = useState(false);
  const [state, setState] = useState<DetailState>('loading');
  const [cached, setCached] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startNotice, setStartNotice] = useState<StartNotice | null>(null);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [serviceNotices, setServiceNotices] = useState<Readonly<Record<string, ServiceExecutionNotice>>>({});
  // 3-I: what the agent left in the device's queue; the screen shows it applied on ELEVANT's view.
  const [queueItems, setQueueItems] = useState<readonly FlightReportOutboxItem[]>([]);
  const [queueRevision, setQueueRevision] = useState(0);
  // 3-N06: the last forms read for this operation, so the hand-off waits for the signed Service Order.
  const [documents, setDocuments] = useState<OperationDocumentsResponse | undefined>(undefined);
  // CN-24: the milestones of ELEVANT's last answer the device kept, so the forms know whether the push-back is recorded.
  const [confirmedMilestones, setConfirmedMilestones] = useState<readonly Readonly<{ code: string }>[] | undefined>(
    undefined);
  const [pendingSubmission, setPendingSubmission] = useState<RampOperationPendingSubmission | null>(null);
  const [submissionNote, setSubmissionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submissionNotice, setSubmissionNotice] = useState<StartNotice | null>(null);
  const [submissionReconciliationRequired, setSubmissionReconciliationRequired] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correctionPending, setCorrectionPending] = useState(false);
  const [correctionNotice, setCorrectionNotice] = useState<StartNotice | null>(null);
  // N1: the last read of the operation's checklist (null when it failed) and how many of its incident reports are
  // still on the device (null when they could not be read), each with the operation it belongs to.
  const [checklistRead, setChecklistRead] = useState<Readonly<{
    operationId: string;
    read: HandoffChecklistRead | null;
  }> | null>(null);
  const [unsentIncidents, setUnsentIncidents] = useState<Readonly<{
    operationId: string;
    count: number | null;
  }> | null>(null);
  const checklistRequestRef = useRef<AbortController | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const startRequestRef = useRef<AbortController | null>(null);
  const serviceRequestRef = useRef<AbortController | null>(null);
  const submissionRequestRef = useRef<AbortController | null>(null);
  const correctionRequestRef = useRef<AbortController | null>(null);
  const startInFlightRef = useRef(false);
  const serviceInFlightRef = useRef(false);
  const submissionInFlightRef = useRef(false);
  const correctionInFlightRef = useRef(false);
  const lastStartedOperationRef = useRef<RampGroundOperationResponse | null>(null);
  const lastServiceExecutionsRef = useRef(new Map<string, RampOperationServiceExecutionResponse>());
  const loadedOperationIdRef = useRef<string | null>(null);

  // `silent` revalida al volver a la pantalla sin spinner ni reinicio de la vista;
  // `true` es el gesto de actualizar y `false` la primera carga de la operación.
  const load = useCallback(async (refresh: boolean | 'silent' = false) => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    if (refresh === true) setRefreshing(true);
    else if (refresh !== 'silent') {
      setState('loading');
      setStarting(false);
      setStartNotice(null);
      setBusyServiceId(null);
      setServiceNotices({});
      setPendingSubmission(null);
      setSubmissionNote('');
      setSubmissionNotice(null);
      setSubmissionReconciliationRequired(false);
      setCorrectionPending(false);
      setCorrectionNotice(null);
      lastStartedOperationRef.current = null;
      lastServiceExecutionsRef.current.clear();
    }

    try {
      const snapshot = await getAssignedOperations({ signal: request.signal });
      if (request.signal.aborted) return;

      let found = snapshot.operations.find(item => item.operation.id === id) ?? null;
      const lastStartedOperation = lastStartedOperationRef.current;
      if (
        found &&
        snapshot.source === 'cache' &&
        lastStartedOperation?.id === found.operation.id
      ) {
        found = { ...found, operation: lastStartedOperation };
      }
      if (found && snapshot.source === 'cache' && lastServiceExecutionsRef.current.size > 0) {
        found = {
          ...found,
          services: found.services.map((service) => {
            const execution = lastServiceExecutionsRef.current.get(service.id);
            return execution ? { ...service, ...execution } : service;
          }),
        };
      }
      if (snapshot.source === 'network') {
        lastStartedOperationRef.current = null;
        lastServiceExecutionsRef.current.clear();
      }
      let pendingHandoff: RampOperationPendingSubmission | null = null;
      let incidents: number | null = null;
      if (found) {
        pendingHandoff = await readRampOperationPendingSubmission(found.operation.id);
        setCorrectionPending(await readPendingRampCorrection(found.operation.id));
        // N1: the reports still on the device hold the hand-off. They are read from the device, so every reload has
        // them; one that cannot be read leaves them unknown, which holds nothing.
        incidents = await countUnsentRampIncidents(found.operation.id).catch(() => null);
      }
      if (request.signal.aborted) return;
      setUnsentIncidents(found ? { operationId: found.operation.id, count: incidents } : null);
      setOperation(found);
      setCached(snapshot.source === 'cache');
      setState(found ? 'ready' : 'not-found');
      loadedOperationIdRef.current = found ? id ?? null : null;
      setPendingSubmission(pendingHandoff);
      if (pendingHandoff) setSubmissionNote(pendingHandoff.request.agentNote ?? '');
      setSubmissionReconciliationRequired(false);
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof MobileServiceError) {
        if (error.code === 'cancelled') return;
        if (error.code === 'unauthenticated' || error.code === 'session_expired') {
          setOperation(null);
          resetToLogin('session_expired');
          return;
        }
        if (error.code === 'forbidden') {
          setOperation(null);
          resetToLogin('access_revoked');
          return;
        }
        if (
          error.code === 'network_unavailable' ||
          error.code === 'request_timeout'
        ) {
          if (refresh === 'silent' && loadedOperationIdRef.current === id) return;
          setState('offline');
          return;
        }
      }
      if (refresh === 'silent' && loadedOperationIdRef.current === id) return;
      setState('unavailable');
    } finally {
      if (!request.signal.aborted) setRefreshing(false);
    }
  }, [id]);

  /**
   * N1: reads the operation's checklist for the close and its card: when the screen gains focus, when the queue moves
   * and after the correction opens, never with each reload of the feed. A read that fails leaves the checklist unknown,
   * which holds nothing; a session that ended goes to the access screen.
   */
  const readChecklist = useCallback(async () => {
    if (!id) return;
    checklistRequestRef.current?.abort();
    const request = new AbortController();
    checklistRequestRef.current = request;
    try {
      const result = await getRampOperationChecklist(id, { signal: request.signal });
      if (request.signal.aborted) return;
      setChecklistRead({ operationId: id, read: { status: result.checklist.status, fromCache: result.fromCache === true } });
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof MobileServiceError) {
        if (error.code === 'cancelled') return;
        if (error.code === 'unauthenticated' || error.code === 'session_expired') {
          resetToLogin('session_expired');
          return;
        }
        if (error.code === 'forbidden') {
          resetToLogin('access_revoked');
          return;
        }
      }
      setChecklistRead({ operationId: id, read: null });
    } finally {
      if (checklistRequestRef.current === request) checklistRequestRef.current = null;
    }
  }, [id]);

  useFocusEffect(useCallback(() => subscribeMobileChanges(resources => {
    if (resources.includes('ramp_operations')) void load('silent');
  }), [load]));

  // 3-I: the queue as the device holds it; when ELEVANT confirms a start, service, charge or checklist of this
  // operation that went out on its own, the view is read again.
  useEffect(() => subscribeFlightReport(snapshot => {
    setQueueItems(snapshot.items);
    setQueueRevision(id ? snapshot.revisions[id.toLowerCase()] ?? snapshot.revisions[id] ?? 0 : 0);
    setDocuments(id ? snapshot.documents?.[id] ?? snapshot.documents?.[id.toLowerCase()] : undefined);
    setConfirmedMilestones(id
      ? (snapshot.confirmed?.[id] ?? snapshot.confirmed?.[id.toLowerCase()])?.milestones
      : undefined);
  }), [id]);
  const seenRevisionRef = useRef(queueRevision);
  useEffect(() => {
    if (queueRevision === seenRevisionRef.current) return;
    seenRevisionRef.current = queueRevision;
    if (loadedOperationIdRef.current !== id) return;
    void load('silent');
    // N1: what ELEVANT just confirmed may be the checklist itself.
    void readChecklist();
  }, [id, load, queueRevision, readChecklist]);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    void load(loadedOperationIdRef.current === id ? 'silent' : false);
    void readChecklist();
    return () => {
      setFocused(false);
      requestRef.current?.abort();
      checklistRequestRef.current?.abort();
      startRequestRef.current?.abort();
      serviceRequestRef.current?.abort();
      submissionRequestRef.current?.abort();
      correctionRequestRef.current?.abort();
      startInFlightRef.current = false;
      serviceInFlightRef.current = false;
      submissionInFlightRef.current = false;
      correctionInFlightRef.current = false;
    };
  }, [id, load, readChecklist]));

  const startOperation = useCallback(async () => {
    // 3-I: with or without signal, the tap is saved on the device with its time and goes out on its own.
    if (
      startInFlightRef.current ||
      !operation ||
      operation.operation.status !== 'Assigned' ||
      queueItems.some(item => item.state === 'pending' && item.command.kind === 'start' &&
        item.command.operationId.toLowerCase() === operation.operation.id.toLowerCase())
    ) {
      return;
    }

    startRequestRef.current?.abort();
    const request = new AbortController();
    startRequestRef.current = request;
    startInFlightRef.current = true;
    setStarting(true);
    setStartNotice(null);

    try {
      const outcome = await startAssignedRampOperation(operation.operation.id, {
        signal: request.signal,
        timeZone: operation.turnaround.station.ianaTimeZone,
      });
      if (request.signal.aborted) return;
      if (outcome.state === 'queued') {
        setStartNotice(queuedStartNotice(outcome.issue));
        return;
      }
      const response = outcome.response;

      lastStartedOperationRef.current = response.operation;
      setOperation(current => {
        if (!current || current.operation.id !== response.operation.id) {
          return current;
        }
        return { ...current, operation: response.operation };
      });
      setCached(false);
      setStartNotice({
        tone: 'success',
        title: 'Operación iniciada',
        message: 'El inicio quedó registrado y la operación ya está en atención.',
      });
      await load(true);
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof MobileServiceError) {
        if (error.code === 'cancelled') return;
        if (error.code === 'unauthenticated' || error.code === 'session_expired') {
          resetToLogin('session_expired');
          return;
        }
        if (error.code === 'forbidden') {
          resetToLogin('access_revoked');
          return;
        }

        setStartNotice(startErrorNotice(error));
        if (error.code === 'not_found' || error.code === 'conflict') {
          await load(true);
        }
        return;
      }
      setStartNotice({
        tone: 'error',
        title: 'Inicio no confirmado',
        message: 'No pudimos iniciar la operación. Actualiza el detalle y vuelve a intentarlo.',
      });
    } finally {
      if (startRequestRef.current === request) {
        startRequestRef.current = null;
        startInFlightRef.current = false;
        if (!request.signal.aborted) setStarting(false);
      }
    }
  }, [load, operation, queueItems]);

  const transitionService = useCallback(async (
    service: RampOperationServiceResponse,
    transitionRequest: TransitionRampOperationServiceRequest,
  ) => {
    // 3-I: the operation and the service as the agent left them on the device (a start or a transition may still wait
    // in the queue); the tap is saved with its time and goes out on its own, with or without signal.
    const projected = operation ? projectRampOperation(operation, queueItems).view : null;
    const current = projected?.services.find(candidate => candidate.id === service.id) ?? service;
    if (
      serviceInFlightRef.current ||
      !operation ||
      !projected ||
      projected.operation.status !== 'InProgress' ||
      (isServiceFinished(current.status) &&
        !(operation.review?.status === 'Returned' &&
          transitionRequest.targetStatus === 'InProgress'))
    ) {
      return;
    }

    serviceRequestRef.current?.abort();
    const request = new AbortController();
    serviceRequestRef.current = request;
    serviceInFlightRef.current = true;
    setBusyServiceId(service.id);
    // N13: the agent's next action clears the confirmations on screen, without a timer; warnings stay.
    setServiceNotices((notices) => withoutConfirmations(notices, service.id));
    // N13: a finished service goes back to «en ejecución» only to be corrected, in a round OCC returned.
    const reopening = isServiceFinished(current.status) && transitionRequest.targetStatus === 'InProgress';

    try {
      const outcome = await transitionRampOperationService(
        operation.operation.id,
        service.id,
        transitionRequest,
        { signal: request.signal, serviceName: service.name, timeZone: operation.turnaround.station.ianaTimeZone },
      );
      if (request.signal.aborted) return;
      if (outcome.state === 'queued') {
        setServiceNotices((notices) => ({
          ...notices,
          [service.id]: queuedServiceNotice(service.name, outcome.issue),
        }));
        return;
      }
      const response = outcome.response;

      lastServiceExecutionsRef.current.set(service.id, response.service);
      setOperation((value) => value
        ? {
            ...value,
            services: value.services.map((candidate) =>
              candidate.id === response.service.id
                ? { ...candidate, ...response.service }
                : candidate),
          }
        : value);
      // N13 (D-N13): one natural sentence with the tapped time at the station; it replaces the other confirmations.
      setServiceNotices((notices) => ({
        ...withoutConfirmations(notices, service.id),
        [service.id]: {
          tone: 'success',
          title: serviceChangeSentence(service.name, response.service.status, outcome.occurredAt,
            operation.turnaround.station.ianaTimeZone, reopening),
        },
      }));
      await load(true);
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof MobileServiceError) {
        if (error.code === 'cancelled') return;
        if (error.code === 'unauthenticated' || error.code === 'session_expired') {
          resetToLogin('session_expired');
          return;
        }
        if (error.code === 'forbidden') {
          resetToLogin('access_revoked');
          return;
        }
        setServiceNotices((notices) => ({
          ...notices,
          [service.id]: serviceTransitionErrorNotice(error),
        }));
        if (error.code === 'not_found' || error.code === 'conflict') {
          await load(true);
        }
        return;
      }
      setServiceNotices((notices) => ({
        ...notices,
        [service.id]: {
          tone: 'error',
          title: 'Servicio no actualizado',
          message: 'No pudimos registrar el cambio. Actualiza el detalle y vuelve a intentarlo.',
        },
      }));
    } finally {
      if (serviceRequestRef.current === request) {
        serviceRequestRef.current = null;
        serviceInFlightRef.current = false;
        if (!request.signal.aborted) setBusyServiceId(null);
      }
    }
  }, [load, operation, queueItems]);

  const handoffOperation = useCallback(async () => {
    if (
      submissionInFlightRef.current || !operation || cached ||
      busyServiceId !== null || submissionReconciliationRequired ||
      (!pendingSubmission && (
        operation.operation.status !== 'InProgress' ||
        operation.services.length === 0 ||
        operation.services.some(service => !isServiceFinished(service.status))
      ))
    ) return;

    submissionRequestRef.current?.abort();
    const request = new AbortController();
    submissionRequestRef.current = request;
    submissionInFlightRef.current = true;
    setSubmitting(true);
    setSubmissionNotice(null);
    try {
      const response = await submitRampOperation(
        operation.operation.id,
        pendingSubmission?.request ?? { agentNote: submissionNote.trim() || undefined },
        { signal: request.signal },
      );
      if (request.signal.aborted) return;
      setOperation(current => current?.operation.id === response.operationId
        ? {
            ...current,
            operation: {
              ...current.operation,
              status: response.status,
              actualEndAt: response.actualEndAt,
            },
            review: {
              submissionId: response.submissionId,
              revisionNumber: response.revisionNumber,
              status: response.status,
              returnReason: null,
            },
          }
        : current);
      setPendingSubmission(null);
      setSubmissionReconciliationRequired(false);
      setSubmissionNotice({
        tone: 'success',
        title: 'Entregada a OCC',
        message: `La revisión de la operación quedó solicitada. Revisión ${response.revisionNumber}.`,
      });
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof MobileServiceError &&
          (error.code === 'unauthenticated' || error.code === 'session_expired')) {
        resetToLogin('session_expired');
        return;
      }
      if (error instanceof MobileServiceError && error.code === 'forbidden') {
        resetToLogin('access_revoked');
        return;
      }
      // N1: the service found a requirement the close had as met or unknown; reading them again shows which.
      if (error instanceof MobileServiceError && isHandoffHold(error.problemCode)) {
        void load('silent');
        void readChecklist();
      }
      try {
        const pending = await readRampOperationPendingSubmission(operation.operation.id);
        setPendingSubmission(pending);
        if (pending) setSubmissionNote(pending.request.agentNote ?? '');
        setSubmissionReconciliationRequired(false);
        setSubmissionNotice(submissionErrorNotice(error, Boolean(pending)));
      } catch {
        setSubmissionReconciliationRequired(true);
        setSubmissionNotice({
          tone: 'error',
          title: 'Entrega por confirmar',
          message: 'No pudimos confirmar la entrega guardada en esta tablet. Actualiza el detalle antes de volver a ' +
            'enviarla.',
        });
      }
    } finally {
      if (submissionRequestRef.current === request) {
        submissionRequestRef.current = null;
        submissionInFlightRef.current = false;
        if (!request.signal.aborted) setSubmitting(false);
      }
    }
  }, [
    busyServiceId,
    cached,
    load,
    operation,
    pendingSubmission,
    readChecklist,
    submissionNote,
    submissionReconciliationRequired,
  ]);

  const reopenCorrection = useCallback(async () => {
    if (correctionInFlightRef.current || !operation || cached ||
        (!correctionPending && (operation.operation.status !== 'Returned' ||
          operation.review?.status !== 'Returned' ||
          !operation.review.returnReason))) return;
    correctionRequestRef.current?.abort();
    const request = new AbortController();
    correctionRequestRef.current = request;
    correctionInFlightRef.current = true;
    setCorrecting(true);
    setCorrectionNotice(null);
    try {
      const result = await reopenRampOperationCorrection(
        operation.operation.id, { signal: request.signal });
      if (request.signal.aborted) return;
      setCorrectionPending(false);
      setOperation(current => current?.operation.id === result.operationId
        ? { ...current, operation: {
          ...current.operation, status: result.status, actualEndAt: null,
        } }
        : current);
      await load(true);
      // N1: the correction brings a new checklist, which the close waits for again.
      void readChecklist();
      setCorrectionNotice({
        tone: 'success', title: `Corrección ${result.revisionNumber} abierta`,
        message: 'El checklist nuevo está listo. El envío anterior permanece intacto.',
      });
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof MobileServiceError &&
          (error.code === 'unauthenticated' || error.code === 'session_expired')) {
        resetToLogin('session_expired'); return;
      }
      if (error instanceof MobileServiceError && error.code === 'forbidden') {
        resetToLogin('access_revoked'); return;
      }
      try {
        const pending = await readPendingRampCorrection(operation.operation.id);
        setCorrectionPending(pending);
        setCorrectionNotice({
          tone: 'warning', title: pending ? 'Corrección por confirmar' : 'No se abrió la corrección',
          message: pending
            ? 'ELEVANT no confirmó la corrección. Vuelve a intentarlo sin cerrar sesión: no se abre dos veces.'
            : 'Actualiza el detalle y comprueba que OCC devolvió la operación.',
        });
      } catch {
        setCorrectionNotice({ tone: 'error', title: 'Corrección sin confirmar',
          message: 'No pudimos confirmar la corrección guardada en esta tablet. Actualiza el detalle antes de ' +
            'volver a intentarlo.' });
      }
    } finally {
      if (correctionRequestRef.current === request) {
        correctionRequestRef.current = null;
        correctionInFlightRef.current = false;
        if (!request.signal.aborted) setCorrecting(false);
      }
    }
  }, [cached, correctionPending, load, operation, readChecklist]);

  const confirmCorrection = useCallback(() => {
    if (correctionPending) { void reopenCorrection(); return; }
    Alert.alert('Abrir corrección',
      'Se creará un checklist nuevo. El envío anterior, sus respuestas y la decisión de OCC permanecerán intactos.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Abrir corrección', onPress: () => void reopenCorrection() },
      ]);
  }, [correctionPending, reopenCorrection]);

  // Un handler estable por servicio: escribir la nota de traspaso u otros campos
  // no vuelve a renderizar las tarjetas de servicio memoizadas.
  const insets = useContext(SafeAreaInsetsContext) ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const transitionServiceRef = useRef(transitionService);
  useEffect(() => { transitionServiceRef.current = transitionService; }, [transitionService]);
  const serviceTransitionHandlers = useMemo(() => new Map((operation?.services ?? []).map(service => [
    service.id,
    (transitionRequest: TransitionRampOperationServiceRequest) => void transitionServiceRef.current(service, transitionRequest),
  ] as const)), [operation?.services]);

  // 3-I: ELEVANT's view (network or saved copy) with what still waits in the device's queue applied on top: a start or
  // a service transition saved without signal already shows, marked «En el dispositivo». Memoized, so typing the note
  // for OCC does not render the memoized service cards again.
  const projection = useMemo(
    () => (operation ? projectRampOperation(operation, queueItems) : null),
    [operation, queueItems],
  );
  const serviceQueues = useMemo(() => new Map((projection?.view.services ?? []).map(service => [
    service.id,
    projection?.servicesRefused.has(service.id)
      ? { tone: 'blocked' as const, message: projection.servicesRefused.get(service.id)?.lastError }
      : projection?.servicesOnDevice.has(service.id) ? { tone: 'device' as const } : undefined,
  ] as const)), [projection]);
  const existingServiceIds = useMemo(
    () => (operation?.services ?? []).map(service => service.serviceDefinitionId),
    [operation?.services],
  );

  // CN-22: the tab shown once the operation started; each operation opens on its summary.
  const [tab, setTab] = useState<OperationTab>('resumen');
  const now = useMinuteClock();
  useEffect(() => { setTab('resumen'); }, [id]);
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const tabsTopRef = useRef(0);
  const selectTab = useCallback((next: OperationTab) => {
    setTab(next);
    // The new tab starts at its top, right under the fixed bar, instead of where the last one was scrolled to.
    if (scrollYRef.current > tabsTopRef.current) {
      scrollRef.current?.scrollTo({ y: tabsTopRef.current, animated: false });
    }
  }, []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  }, []);
  const onBeforeTabsLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    tabsTopRef.current = y + height;
  }, []);

  if (state !== 'ready' || !operation || !projection) {
    return <DetailStateScreen onRetry={() => void load()} state={state} />;
  }

  const { assignment, turnaround } = operation;
  const timeZone = turnaround.station.ianaTimeZone;
  // N9 (D-N9): «Agente principal»; a role this version does not know is left out, never shown as its code.
  const assignmentRole = assignmentRoleLabel(assignment.assignmentRole);
  const shown = projection.view;
  // Every operation carries an execution checklist (ADR-0031): the bridge one or the Flight Report.
  const hasOperationalChecklist = true;
  const executing = shown.operation.status === 'InProgress';
  const notStarted = shown.operation.status === 'Assigned' || shown.operation.status === 'Planned';
  // N1: once it ran, an operation that is no longer in progress is closed for the agent: handed off to OCC, approved,
  // or returned and waiting for the correction to open.
  const executionClosed: ChargesExecutionClosed | undefined = shown.operation.status === 'Returned'
    ? 'returned' : !executing && !notStarted ? 'closed' : undefined;
  // CN-24: whether the push-back is recorded, confirmed or waiting on the device; the forms warn until it is.
  const pushbackRecorded = isPushbackRecorded({
    milestones: shown.milestones,
    confirmed: confirmedMilestones,
    items: queueItems,
    operationId: operation.operation.id,
  });
  // N1: where the checklist stands, and everything a new hand-off needs (3-N06): the services as the agent left them,
  // the checklist, the incident reports still on the device, the flight data on the Service Order (S1, a warning only),
  // the signed Service Order and the queue.
  const checklist = checklistStanding(
    checklistRead && checklistRead.operationId === id ? checklistRead.read : null,
    checklistQueuedFor(queueItems, operation.operation.id),
  );
  const requirements = handoffRequirements({
    services: shown.services,
    checklist,
    unsentIncidents: unsentIncidents?.operationId === operation.operation.id ? unsentIncidents.count : null,
    documents,
    flightDataQueued: flightDataQueuedFor(queueItems, operation.operation.id),
    // The push-back's rule (N2): a signature of the Order waiting in the queue counts as signed.
    orderSigned: serviceOrderHasSignature(documents, queueItems, operation.operation.id),
    waitingRecords: projection.pending + projection.blocked,
    pushbackRecorded,
  });
  const openChecklist = () => router.push({ pathname: '/checklist/[id]', params: { id: operation.operation.id } });
  const openIncidents = () => router.push({ pathname: '/incident/[id]', params: { id: operation.operation.id } });

  // CN-22: before the start the screen is the one it always was; once the operation started, its sections go in tabs
  // under its card. Every section stays mounted and the hidden ones are only not displayed, so switching tabs never
  // loses what the agent typed or drew (a draft, a signature, a note) and the flow is the same.
  const tabbed = shown.operation.status !== 'Assigned';
  const progress = operationTabProgress({
    requirements,
    services: shown.services,
    returned: operation.review?.status === 'Returned' || correctionPending,
    closed: !executing && !notStarted && shown.operation.status !== 'Returned',
  });

  const cachedBanner = cached && (
    <Notice icon="cloud-offline-outline" message="Desliza hacia abajo para reconectar." title="Vista guardada"
      tone="warning" />
  );

  // The flight board: everything the tablet knows about the flight and how far the operation is, with the sync state.
  const hero = (
    <OperationHero
      checklist={checklist}
      connection={<ConnectionBadge />}
      now={now}
      operation={shown}
      requirements={requirements}
      started={!notStarted}
    />
  );

  const startControl = (
    <OperationStartControl
      notice={startNotice}
      onDevice={projection.startOnDevice}
      onStart={() => void startOperation()}
      operation={shown.operation}
      refusal={projection.startRefused?.lastError}
      starting={starting}
      timeZone={timeZone}
    />
  );

  const flightCards = shown.operation.status !== 'Assigned' && (
    <>
      <FlightReportPanel operation={shown} timeZone={timeZone} editable={executing} />
      <DeviationAction operationId={operation.operation.id} editable={executing} />
      <FlightDataCard key={operation.operation.id} operation={shown} editable={executing} />
      <WalkaroundCard operationId={operation.operation.id} editable={executing} />
      <CharterCard operationId={operation.operation.id} editable={executing}
        existingServiceIds={existingServiceIds} />
    </>
  );

  const documentsPanel = shown.operation.status !== 'Assigned' && (
    <DocumentsPanel operationId={operation.operation.id} editable={executing || shown.operation.status === 'PendingReview' ||
      shown.operation.status === 'Returned'} executionOpen={executing} pushbackRecorded={pushbackRecorded} />
  );

  const attendance = operation.operation.id && assignment.id && (
    <AttendanceDraftCard
      key={`${operation.operation.id}:${assignment.id}`}
      operationId={operation.operation.id}
      assignmentId={assignment.id}
      active={focused}
      stationCode={turnaround.station.code}
      timeZone={timeZone}
      operationDate={turnaround.operationDate}
    />
  );

  const returnedBlock = (operation.review?.status === 'Returned' || correctionPending) && (
    <View style={[styles.handoffCard, styles.returnedCard]}>
      <View style={styles.handoffHeader}>
        <View style={[styles.handoffIcon, styles.returnedIcon]}>
          <Ionicons name="arrow-undo-outline" size={22} color={colors.danger} />
        </View>
        <View style={styles.handoffCopy}>
          <Text accessibilityRole="header" style={styles.handoffTitle}>
            {operation.operation.status === 'Returned' ? 'Devuelta por OCC' : 'Corrección en curso'}
          </Text>
          <Text style={styles.startDescription}>
            Revisión {operation.review?.revisionNumber ?? '—'} · Motivo de devolución:
          </Text>
        </View>
      </View>
      <Text style={styles.returnReason}>
        {operation.review?.returnReason ?? 'Actualiza el detalle para consultar el motivo.'}
      </Text>
      <Hint>El checklist y los servicios enviados se conservan como historial.</Hint>
      {(operation.operation.status === 'Returned' || correctionPending) && (
        <PrimaryButton
          disabled={cached || correcting ||
            (!correctionPending && !operation.review?.returnReason)}
          icon={correctionPending ? 'refresh-outline' : 'create-outline'}
          onPress={confirmCorrection}
          title={correcting ? 'ABRIENDO…' : correctionPending
            ? 'REINTENTAR CORRECCIÓN' : 'ABRIR CORRECCIÓN'}
        />
      )}
      {correctionNotice && (
        <Text accessibilityLiveRegion="polite" style={styles.nextPhaseWarning}>
          {correctionNotice.title}. {correctionNotice.message}
        </Text>
      )}
    </View>
  );

  const movement = (
    <>
      {/* S6 (D-S6): whose clock the times use, «Hora local de PUJ», never the zone's IANA id. */}
      <SectionHeader icon="swap-horizontal-outline" title="Movimiento aéreo"
        subtitle={stationTimeTitle(turnaround.station.code)} />
      <View style={styles.legs}>
        {turnaround.arrival && (
          <FlightLegCard kind="Llegada" leg={turnaround.arrival} timeZone={timeZone} />
        )}
        {turnaround.departure && (
          <FlightLegCard kind="Salida" leg={turnaround.departure} timeZone={timeZone} />
        )}
        {!turnaround.arrival && !turnaround.departure && (
          <Card style={styles.pendingCard}>
            <Ionicons name="time-outline" size={24} color={colors.warning} />
            <View style={styles.pendingCopy}>
              <Text style={styles.pendingTitle}>Movimiento por confirmar</Text>
              <Text style={styles.pendingText}>OCC todavía no ha asociado una llegada o salida.</Text>
            </View>
          </Card>
        )}
      </View>
    </>
  );

  const correctionMode = executing && operation.review?.status === 'Returned';
  const services = (
    <>
      <SectionHeader
        icon="construct-outline"
        title="Servicios contratados"
        subtitle={`${shown.services.length} ${shown.services.length === 1 ? 'línea' : 'líneas'} de servicio`}
      />
      <View style={styles.servicesList}>
        {shown.services.length > 0 ? shown.services.map((service) => (
          <RampServiceExecutionCard
            actionable={
              executing &&
              (busyServiceId === null || busyServiceId === service.id)
            }
            busy={busyServiceId === service.id}
            correctionMode={correctionMode}
            disabledReason={
              !executing
                ? 'Inicia la operación antes de ejecutar sus servicios.'
                : busyServiceId && busyServiceId !== service.id
                  ? 'Espera a que termine el cambio del otro servicio.'
                  : undefined
            }
            key={service.id}
            notice={serviceNotices[service.id]}
            onTransition={serviceTransitionHandlers.get(service.id)!}
            queue={serviceQueues.get(service.id)}
            service={service}
          />
        )) : (
          <Card style={styles.noServices}>
            <Ionicons name="construct-outline" size={23} color={colors.muted} />
            <Text style={styles.noServicesText}>No hay servicios asociados a esta operación.</Text>
          </Card>
        )}
      </View>
      {shown.services.length > 0 && (
        <RampOperationChargesCard
          executionClosed={executionClosed}
          operationId={operation.operation.id}
          refreshKey={`${shown.operation.status}:${operation.review?.status ?? ''}:${shown.services.map(service => service.status).join(',')}`}
          services={shown.services}
        />
      )}
    </>
  );

  const incidents = executing && (
    <View style={styles.nextPhase}>
      <View style={styles.nextPhaseIcon}>
        <Ionicons name="alert-circle-outline" size={26} color={colors.navy} />
      </View>
      <View style={styles.nextPhaseCopy}>
        <Text accessibilityRole="header" style={styles.nextPhaseTitle}>Incidencias</Text>
        <Hint>Seguridad, equipo, documentación u operación. Sin señal se guarda en la tablet.</Hint>
        <PrimaryButton
          icon="alert-circle-outline"
          onPress={openIncidents}
          secondary
          title="ABRIR INCIDENCIAS"
        />
      </View>
    </View>
  );

  const checklistCard = hasOperationalChecklist && (
    <View style={styles.nextPhase}>
      <View style={styles.nextPhaseIcon}>
        <Ionicons name="shield-checkmark-outline" size={26} color={colors.navy} />
      </View>
      <View style={styles.nextPhaseCopy}>
        <View style={styles.nextPhaseHead}>
          <Text accessibilityRole="header" style={styles.nextPhaseTitle}>Checklist operativo</Text>
          {/* N1: where the checklist stands, once the operation started; nothing while the tablet cannot tell. */}
          {!notStarted && <ChecklistStandingPill standing={checklist} />}
        </View>
        <Hint>
          {executionClosed
            ? 'La ejecución está cerrada: el checklist se consulta tal como se envió.'
            : 'Enviar el checklist no entrega la operación a OCC.'}
        </Hint>
        {notStarted && (
          <Hint icon="lock-closed-outline" tone="warning">
            Inicia la operación antes de completar el checklist.
          </Hint>
        )}
        {cached && executing && (
          <Hint icon="cloud-offline-outline" tone="warning">
            Sin señal se abre la última copia guardada; el envío sale al reconectar.
          </Hint>
        )}
        {/* N1: after the hand-off the sent checklist still opens, read-only; only an operation not started keeps
            it off. */}
        <PrimaryButton
          disabled={notStarted || busyServiceId !== null}
          icon={executionClosed ? 'eye-outline' : 'clipboard-outline'}
          onPress={openChecklist}
          title={executionClosed ? 'VER CHECKLIST' : 'ABRIR CHECKLIST'}
        />
      </View>
    </View>
  );

  const submission = (hasOperationalChecklist || pendingSubmission || operation.operation.status === 'PendingReview') && (
    <OperationSubmissionControl
      blocked={cached || busyServiceId !== null || submissionReconciliationRequired}
      note={submissionNote}
      notice={submissionNotice}
      onChangeNote={setSubmissionNote}
      onOpenChecklist={openChecklist}
      onOpenIncidents={openIncidents}
      onSubmit={() => void handoffOperation()}
      operation={operation.operation}
      correctionRevision={operation.review?.status === 'Returned'
        ? operation.review.revisionNumber + 1 : null}
      pending={pendingSubmission}
      requirements={requirements}
      serviceBusy={busyServiceId !== null}
      submitting={submitting}
    />
  );

  const assignmentSection = (
    <>
      <SectionHeader icon="person-outline" title="Asignación" />
      <Card style={styles.assignmentCard}>
        {assignmentRole ? <Meta icon="briefcase-outline" label={assignmentRole} dark /> : null}
        {/* N9: the position by its name only; its code («RAMP-AGENT») is for OCC. CN-25: in Spanish when the
            catalog still names it in English. */}
        <Meta
          icon="ribbon-outline"
          label={assignmentPositionLabel(assignment.position) ?? 'Posición operativa no especificada'}
          dark
        />
        <Meta
          icon="time-outline"
          label={`Asignada ${formatStationDateTime(assignment.assignedAt, timeZone)}`}
          dark
        />
      </Card>
    </>
  );

  // The tab bar's slot is always there, so the sections keep their place in the tree when the operation starts and
  // nothing the agent typed before the start is lost; before the start it is empty.
  const tabBar = tabbed
    ? <OperationTabBar onSelect={selectTab} progress={progress} selected={tab} />
    : <View />;

  const sections: readonly ScreenSection[] = tabbed
    ? [
        { key: 'cached', node: cachedBanner },
        { key: 'hero', node: hero },
        { key: 'tabs', node: tabBar },
        { key: 'start', node: startControl, tab: 'resumen' },
        { key: 'attendance', node: attendance, tab: 'resumen' },
        { key: 'returned', node: returnedBlock, tab: 'resumen' },
        { key: 'assignment', node: assignmentSection, tab: 'resumen' },
        { key: 'movement', node: movement, tab: 'vuelo' },
        { key: 'flight', node: flightCards, tab: 'vuelo' },
        { key: 'services', node: services, tab: 'servicios' },
        { key: 'documents', node: documentsPanel, tab: 'documentos' },
        { key: 'incidents', node: incidents, tab: 'cierre' },
        { key: 'checklist', node: checklistCard, tab: 'cierre' },
        { key: 'submission', node: submission, tab: 'cierre' },
      ]
    : [
        { key: 'cached', node: cachedBanner },
        { key: 'hero', node: hero },
        { key: 'start', node: startControl },
        { key: 'tabs', node: tabBar },
        { key: 'flight', node: flightCards },
        { key: 'documents', node: documentsPanel },
        { key: 'attendance', node: attendance },
        { key: 'returned', node: returnedBlock },
        { key: 'movement', node: movement },
        { key: 'services', node: services },
        { key: 'incidents', node: incidents },
        { key: 'checklist', node: checklistCard },
        { key: 'submission', node: submission },
        { key: 'assignment', node: assignmentSection },
      ];
  const present = sections.filter(section => Boolean(section.node));
  const tabsIndex = present.findIndex(section => section.key === 'tabs');

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: 38 + insets.bottom }]}
      onScroll={onScroll}
      ref={scrollRef}
      refreshControl={(
        <RefreshControl
          accessibilityLabel="Actualizar detalle de la operación"
          colors={[colors.navy]}
          onRefresh={() => {
            void load(true);
            void readChecklist();
          }}
          refreshing={refreshing}
          tintColor={colors.navy}
        />
      )}
      scrollEventThrottle={64}
      stickyHeaderIndices={[tabsIndex]}
    >
      {present.map((section, index) => (
        <View
          key={section.key}
          onLayout={index === tabsIndex - 1 ? onBeforeTabsLayout : undefined}
          style={[
            styles.section,
            // The bar's own padding spaces it; the empty slot before the start takes no room.
            index > 0 && section.key !== 'tabs' && styles.sectionSpaced,
            section.tab && section.tab !== tab && styles.sectionHidden,
          ]}
        >
          {section.node}
        </View>
      ))}
    </ScrollView>
  );
}

/** CN-22: one section of the operation's screen; `tab` is where it goes once the operation started. */
type ScreenSection = Readonly<{ key: string; node: ReactNode; tab?: OperationTab }>;

function OperationStartControl({
  notice,
  onDevice,
  onStart,
  operation,
  refusal,
  starting,
  timeZone,
}: {
  readonly notice: StartNotice | null;
  /** 3-I: the start waits in the device's queue; the operation already runs from the tapped time. */
  readonly onDevice: boolean;
  readonly onStart: () => void;
  readonly operation: RampGroundOperationResponse;
  /** 3-I: why ELEVANT refused the start saved on the device, until the agent taps «Iniciar» again. */
  readonly refusal?: string;
  readonly starting: boolean;
  readonly timeZone: string;
}) {
  const isAssigned = operation.status === 'Assigned';
  const isInProgress = operation.status === 'InProgress';
  const closed = CLOSED_TITLES[operation.status];
  const tone = isInProgress ? 'active' : isAssigned ? 'ready' : closed ? 'closed' : 'idle';

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.startControl, START_LOOKS[tone].box]}
    >
      <View style={styles.startHeading}>
        <View style={[styles.startIcon, { backgroundColor: START_LOOKS[tone].iconBg }]}>
          <Ionicons
            name={isInProgress ? 'play' : isAssigned ? 'flag' : closed ? 'checkmark-done' : 'pause'}
            size={22}
            color={START_LOOKS[tone].icon}
          />
        </View>
        <View style={styles.startCopy}>
          <Text accessibilityRole="header" style={styles.startTitle}>
            {isInProgress
              ? 'Operación en atención'
              : isAssigned
                ? 'Lista para iniciar'
                : closed ?? 'Inicio no disponible'}
          </Text>
          {isAssigned && !refusal && (
            <Text style={styles.startDescription}>Confirma que estás en posición antes de iniciar.</Text>
          )}
          {!isAssigned && !isInProgress && !closed && (
            <Text style={styles.startDescription}>El estado actual no permite registrar un nuevo inicio.</Text>
          )}
        </View>
        {isAssigned && (
          <View style={styles.startAction}>
            <PrimaryButton
              disabled={starting}
              icon="play"
              onPress={onStart}
              title={starting ? 'INICIANDO…' : 'INICIAR OPERACIÓN'}
              variant="accent"
            />
          </View>
        )}
      </View>

      {(isInProgress || closed) && (
        <View style={styles.startedAtRow}>
          <View style={styles.startedAtItem}>
            <Ionicons name={onDevice ? 'phone-portrait-outline' : 'time-outline'} size={17}
              color={onDevice ? colors.warning : colors.success} />
            <Text style={[styles.startedAtText, onDevice && { color: colors.warning }]}>
              {onDevice
                ? `Inicio guardado en el dispositivo ${operation.actualStartAt
                  ? formatStationDateTime(operation.actualStartAt, timeZone) : ''} · se envía a ELEVANT en cuanto haya señal`
                : operation.actualStartAt
                  ? `Inicio registrado ${formatStationDateTime(operation.actualStartAt, timeZone)}`
                  : 'Inicio confirmado por ELEVANT'}
            </Text>
          </View>
          {operation.actualEndAt ? (
            <View style={styles.startedAtItem}>
              <Ionicons name="stop-circle-outline" size={17} color={colors.inkSoft} />
              <Text style={[styles.startedAtText, { color: colors.inkSoft }]}>
                {`Fin registrado ${formatStationDateTime(operation.actualEndAt, timeZone)}`}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {isAssigned && refusal && (
        <Notice tone="danger" title="ELEVANT rechazó el inicio guardado en el dispositivo"
          message={`${refusal} Si corresponde, vuelve a iniciar.`} />
      )}

      {notice && (
        <Notice
          message={notice.message}
          title={notice.title}
          tone={notice.tone === 'success' ? 'success' : notice.tone === 'warning' ? 'warning' : 'danger'}
        />
      )}
    </View>
  );
}

/** The hand-off card's title once the operation left the agent's hands. */
const DELIVERED_TITLES: Readonly<Record<string, string>> = {
  PendingReview: 'Pendiente de revisión OCC',
  InReview: 'En revisión de OCC',
  Approved: 'Aprobada por OCC',
};

/** What the start's card says once the execution closed for the agent. */
const CLOSED_TITLES: Readonly<Record<string, string>> = {
  PendingReview: 'Entregada a OCC',
  InReview: 'En revisión de OCC',
  Approved: 'Aprobada por OCC',
};

const START_LOOKS = {
  ready: { box: { borderColor: colors.orangeLine }, iconBg: colors.paleOrange, icon: colors.orange },
  active: { box: { borderColor: colors.greenLine }, iconBg: colors.paleGreen, icon: colors.success },
  closed: { box: { borderColor: colors.border }, iconBg: colors.paleGreen, icon: colors.success },
  idle: { box: { borderColor: colors.border }, iconBg: colors.surfaceSunken, icon: colors.muted },
} as const;

function OperationSubmissionControl({
  blocked,
  note,
  notice,
  onChangeNote,
  onOpenChecklist,
  onOpenIncidents,
  onSubmit,
  operation,
  correctionRevision,
  pending,
  requirements,
  serviceBusy,
  submitting,
}: {
  readonly blocked: boolean;
  readonly note: string;
  readonly notice: StartNotice | null;
  readonly onChangeNote: (value: string) => void;
  readonly onOpenChecklist: () => void;
  readonly onOpenIncidents: () => void;
  /** Sends the hand-off; a new one first passes through the confirmation sheet, a reserved one goes straight. */
  readonly onSubmit: () => void;
  readonly operation: RampGroundOperationResponse;
  readonly correctionRevision: number | null;
  readonly pending: RampOperationPendingSubmission | null;
  /** N1 (3-N06): everything a new hand-off needs, with its state; what is missing holds it. */
  readonly requirements: readonly HandoffRequirement[];
  /** A service command is in flight: the checklist does not open meanwhile, as on its card. */
  readonly serviceBusy: boolean;
  readonly submitting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  // Handed off: waiting for OCC, in its review or approved; the card says where it stands instead of asking again.
  const delivered = ['PendingReview', 'InReview', 'Approved'].includes(operation.status) && !pending;
  const awaitingHandoff = operation.status === 'InProgress' && !pending;
  const canSubmit = !blocked && !submitting && (
    pending !== null || (operation.status === 'InProgress' && handoffHoldsFor(requirements).length === 0));
  const title = delivered ? DELIVERED_TITLES[operation.status] ?? 'Pendiente de revisión OCC' : correctionRevision
    ? `Reenviar corrección ${correctionRevision} a OCC` : 'Entregar operación a OCC';
  // N1: the tablet's own sheet confirms a new hand-off; REINTENTAR ENTREGA resends the reserved one without it.
  const submit = () => {
    if (pending) onSubmit();
    else setConfirming(true);
  };
  /**
   * The button a missing requirement offers. Its title is the one of the card that leads to the same place, so its
   * spoken label names what is missing: a screen reader tells the two apart.
   */
  const actionFor = (requirement: HandoffRequirement) => {
    if (requirement.state !== 'missing') return null;
    if (requirement.kind === 'checklist') {
      return (
        <PrimaryButton accessibilityLabel="Abrir el checklist que falta para entregar" disabled={serviceBusy}
          icon="clipboard-outline" onPress={onOpenChecklist} secondary title="ABRIR CHECKLIST" />
      );
    }
    if (requirement.kind === 'incidents') {
      return (
        <PrimaryButton accessibilityLabel="Abrir las incidencias que faltan por enviar" icon="alert-circle-outline"
          onPress={onOpenIncidents} secondary title="ABRIR INCIDENCIAS" />
      );
    }
    if (requirement.kind === 'queue') {
      return <PrimaryButton icon="sync" onPress={() => router.push('/sync')} secondary title="ABRIR SINCRONIZACIÓN" />;
    }
    return null;
  };

  return (
    <View style={[styles.handoffCard, delivered && styles.handoffDelivered]}>
      <View style={styles.handoffHeader}>
        <View style={[styles.handoffIcon, delivered && styles.handoffIconDelivered]}>
          <Ionicons
            name={delivered ? 'checkmark-done-outline' : 'send-outline'}
            size={22}
            color={delivered ? colors.success : colors.orange}
          />
        </View>
        <View style={styles.handoffCopy}>
          <Text style={styles.handoffKicker}>Cierre de ejecución</Text>
          <Text accessibilityRole="header" style={styles.handoffTitle}>{title}</Text>
        </View>
      </View>
      <Hint>
        {delivered
          ? operation.status === 'Approved'
            ? 'OCC aprobó la ejecución: checklist, servicios e incidencias quedaron registrados.'
            : 'La ejecución quedó cerrada. OCC revisará el checklist, los servicios y las incidencias.'
          : 'Para entregar: checklist enviado, servicios terminados, Orden de Servicio firmada y todo sincronizado.'}
      </Hint>
      {operation.status === 'InProgress' && !pending && (
        <View style={styles.handoffNoteGroup}>
          <Text style={styles.handoffLabel}>Nota para OCC · opcional</Text>
          <TextInput
            accessibilityLabel="Nota opcional para OCC"
            editable={!blocked && !submitting}
            maxLength={2000}
            multiline
            onChangeText={onChangeNote}
            placeholder="Agrega un dato útil para la revisión"
            placeholderTextColor={colors.muted}
            style={styles.handoffNoteInput}
            textAlignVertical="top"
            value={note}
          />
          <Text style={styles.handoffCounter}>{note.length}/2000</Text>
        </View>
      )}
      {pending && (
        <Hint icon="lock-closed-outline" tone="warning">
          Hay un envío reservado con nota fija. Reconecta y reintenta; no se creará una segunda entrega.
        </Hint>
      )}
      {/* N1: what the hand-off needs, each with its state, instead of asking the agent to confirm it. */}
      {awaitingHandoff && <HandoffRequirementList actionFor={actionFor} requirements={requirements} />}
      {blocked && !delivered && (
        <Hint icon="cloud-offline-outline" tone="warning">
          Para entregar, actualiza el detalle con señal y espera a que terminen los cambios en curso.
        </Hint>
      )}
      {(operation.status === 'InProgress' || pending) && (
        <PrimaryButton
          disabled={!canSubmit}
          icon={pending ? 'refresh-outline' : 'send-outline'}
          onPress={submit}
          title={submitting ? 'ENVIANDO…' : pending ? 'REINTENTAR ENTREGA' : 'ENTREGAR A OCC'}
          variant="accent"
        />
      )}
      {confirming && awaitingHandoff && (
        <HandoffSheet
          canConfirm={canSubmit}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onSubmit();
          }}
          requirements={requirements}
          title={title}
        />
      )}
      {notice && (
        <Notice
          message={notice.message}
          title={notice.title}
          tone={notice.tone === 'success' ? 'success' : notice.tone === 'warning' ? 'warning' : 'danger'}
        />
      )}
    </View>
  );
}

/** N1: where the checklist stands, on its card; nothing while the tablet cannot tell. */
const CHECKLIST_STANDINGS: Readonly<Partial<Record<ChecklistStanding, Readonly<{
  text: string;
  tone: 'green' | 'orange' | 'blue';
}>>>> = {
  submitted: { text: 'Enviado a ELEVANT', tone: 'green' },
  queued: { text: 'Envío guardado en el dispositivo', tone: 'orange' },
  'not-submitted': { text: 'Sin enviar', tone: 'blue' },
};

function ChecklistStandingPill({ standing }: { readonly standing: ChecklistStanding }) {
  const pill = CHECKLIST_STANDINGS[standing];
  return pill ? <StatusPill text={pill.text} tone={pill.tone} /> : null;
}

/** 3-I: «Iniciar» saved on the device: it goes out on its own with the tapped time. */
function queuedStartNotice(issue?: MobileServiceError): StartNotice {
  if (issue && (issue.code === 'device_revoked' || issue.code === 'device_in_use' || issue.code === 'device_conflict')) {
    return startErrorNotice(issue);
  }
  return {
    tone: 'warning',
    title: 'Inicio guardado en el dispositivo',
    message: 'Se envía a ELEVANT en cuanto haya señal, con la hora en que lo tocaste. Puedes registrar los tiempos y los servicios mientras tanto.',
  };
}

/** 3-I: a service transition saved on the device: it goes out on its own, in its order, with the tapped time. */
function queuedServiceNotice(serviceName: string, issue?: MobileServiceError): ServiceExecutionNotice {
  if (issue && (issue.code === 'device_revoked' || issue.code === 'device_in_use' || issue.code === 'device_conflict')) {
    return serviceTransitionErrorNotice(issue);
  }
  return {
    tone: 'warning',
    title: 'Guardado en el dispositivo',
    message: `${serviceName} se envía a ELEVANT en cuanto haya señal, con la hora en que lo tocaste.`,
  };
}

function serviceTransitionErrorNotice(
  error: MobileServiceError,
): ServiceExecutionNotice {
  // Phase 3 block C: a refusal with a code the tablet explains (a time out of order, outside the operation's window…).
  if (error.code === 'conflict' && explainsProblem(error)) {
    return {
      tone: 'error',
      title: 'Servicio rechazado',
      message: error.message,
    };
  }
  if (error.code === 'conflict') {
    return {
      tone: 'warning',
      title: 'El servicio cambió',
      message: 'Actualizamos el servicio con lo que tiene ELEVANT. Revísalo antes de registrar otro resultado.',
    };
  }
  if (error.code === 'not_found') {
    return {
      tone: 'warning',
      title: 'Se liberó tu asignación',
      message: 'El servicio o la operación ya no están a tu cargo. Estamos actualizando el detalle.',
    };
  }
  if (error.code === 'device_revoked') {
    return {
      tone: 'error',
      title: 'Tablet revocada',
      message: 'OCC revocó esta tablet. Entrégala a OCC y continúa en otra tablet.',
    };
  }
  if (error.code === 'device_in_use') {
    return {
      tone: 'error',
      title: 'Tablet en uso',
      message: 'Otro agente tiene esta tablet en una operación en curso. Solicita a OCC que la libere.',
    };
  }
  if (error.code === 'device_conflict') {
    return {
      tone: 'error',
      title: 'Dispositivo no autorizado',
      message: 'Cierra sesión y solicita a AVIAM revisar el vínculo de esta instalación.',
    };
  }
  // N6: the device's storage failed; the lock is never the cause, so the agent is told what to do instead.
  if (error.code === 'storage_unavailable') {
    return {
      tone: 'error',
      title: 'Cambio no guardado',
      message: `La tablet no pudo guardar el cambio del servicio. ${LOCAL_SAVE_WAY_OUT}`,
    };
  }
  return {
    tone: 'error',
    title: 'Servicio no actualizado',
    message: error.retryable
      ? 'No pudimos confirmar el cambio. Actualiza el detalle y vuelve a intentarlo.'
      : 'No pudimos registrar el cambio. Actualiza el detalle y revisa el servicio antes de continuar.',
  };
}

function submissionErrorNotice(error: unknown, pending: boolean): StartNotice {
  if (pending) {
    return {
      tone: 'warning',
      title: 'Entrega pendiente de confirmación',
      message: 'La entrega quedó guardada en esta tablet. Vuelve a intentarlo sin cerrar sesión: se envía la ' +
        'misma, sin duplicarla.',
    };
  }
  if (error instanceof MobileServiceError) {
    // 3-N06, N1: one of the tablet's own reasons to wait, which the requirement list names.
    if (error.code === 'conflict' && isHandoffHold(error.problemCode)) {
      return { tone: 'warning', title: 'Entrega en espera', message: error.message };
    }
    if (error.code === 'conflict' || error.code === 'not_found') {
      return {
        tone: 'warning',
        title: 'Operación por actualizar',
        message: 'El estado cambió o falta un requisito. Actualiza el detalle y revisa el checklist, los servicios y las incidencias.',
      };
    }
    if (error.code === 'storage_unavailable') {
      return {
        tone: 'error',
        title: 'Entrega no guardada',
        message: `La tablet no pudo guardar la entrega. ${LOCAL_SAVE_WAY_OUT}`,
      };
    }
  }
  return {
    tone: 'error',
    title: 'Entrega no confirmada',
    message: 'No pudimos confirmar la entrega. Actualiza el detalle antes de intentar de nuevo.',
  };
}

function startErrorNotice(error: MobileServiceError): StartNotice {
  if (error.code === 'not_found') {
    return {
      tone: 'warning',
      title: 'Se liberó tu asignación',
      message: 'La operación ya no pertenece a tu lista. Estamos actualizando el detalle.',
    };
  }
  // 3-N04: the airline's contract is no longer in force; the operation does not start until OCC decides.
  if (error.code === 'conflict' && error.problemCode === 'contract_not_in_force') {
    return {
      tone: 'error',
      title: 'Contrato no vigente',
      message: error.message,
    };
  }
  // Phase 3 block C: a start the server refuses with a code the tablet explains (before the assignment, too old…).
  if (error.code === 'conflict' && explainsProblem(error)) {
    return {
      tone: 'error',
      title: 'Inicio rechazado',
      message: error.message,
    };
  }
  if (error.code === 'conflict') {
    return {
      tone: 'warning',
      title: 'La operación cambió',
      message: 'Actualizamos la operación con lo que tiene ELEVANT. Revísala antes de volver a intentarlo.',
    };
  }
  if (error.code === 'network_unavailable') {
    return {
      tone: 'warning',
      title: 'Inicio pendiente de confirmación',
      message: 'Se perdió la conexión antes de que ELEVANT confirmara el inicio. Reconecta y vuelve a intentarlo sin ' +
        'cerrar sesión: el inicio no se duplica.',
    };
  }
  if (error.code === 'request_timeout') {
    return {
      tone: 'warning',
      title: 'Inicio pendiente de confirmación',
      message: 'ELEVANT tardó demasiado en responder. Vuelve a intentarlo sin cerrar sesión: el inicio no se duplica.',
    };
  }
  if (error.code === 'storage_unavailable') {
    return {
      tone: 'error',
      title: 'Inicio no guardado',
      message: `La tablet no pudo guardar el inicio. ${LOCAL_SAVE_WAY_OUT}`,
    };
  }
  if (error.code === 'device_revoked' || error.code === 'device_in_use') {
    return {
      tone: 'error',
      title: error.code === 'device_revoked' ? 'Tablet revocada' : 'Tablet en uso',
      message: error.code === 'device_revoked'
        ? 'OCC revocó esta tablet. Entrégala a OCC y continúa en otra tablet.'
        : 'Otro agente tiene esta tablet en una operación en curso. Solicita a OCC que la libere.',
    };
  }
  if (error.code === 'device_conflict') {
    return {
      tone: 'error',
      title: 'Registro del dispositivo en conflicto',
      message: 'Cierra la sesión, abre la aplicación nuevamente y vuelve a intentar. Si persiste, contacta a AVIAM.',
    };
  }

  return {
    tone: 'error',
    title: 'Inicio no confirmado',
    message: error.retryable
      ? 'No pudimos confirmar el inicio. Actualiza el detalle y vuelve a intentarlo.'
      : 'El inicio fue rechazado. Actualiza el detalle antes de continuar.',
  };
}

function DetailStateScreen({ onRetry, state }: { readonly onRetry: () => void; readonly state: DetailState }) {
  if (state === 'loading') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.stateScreen}>
        <ActivityIndicator accessibilityLabel="Cargando detalle" color={colors.navy} size="large" />
        <Text accessibilityRole="header" style={styles.stateTitle}>Cargando operación</Text>
      </View>
    );
  }

  const copy: readonly [string, string] = state === 'not-found'
    ? ['Operación no disponible', 'La asignación ya no existe o dejó de pertenecer a tu cuenta.']
    : state === 'offline'
      ? ['Sin conexión segura', 'No existe una copia guardada de esta operación en tu dispositivo.']
      : ['Detalle no disponible', 'No pudimos consultar esta operación en este momento.'];

  return (
    <View accessibilityLiveRegion="assertive" style={styles.stateScreen}>
      <View style={styles.stateIcon}>
        <Ionicons name={state === 'offline' ? 'cloud-offline-outline' : state === 'not-found' ? 'airplane-outline'
          : 'warning-outline'} size={34} color={colors.warning} />
      </View>
      <Text accessibilityRole="header" style={styles.stateTitle}>{copy[0]}</Text>
      <Text style={styles.stateMessage}>{copy[1]}</Text>
      <PrimaryButton title="REINTENTAR" icon="refresh" onPress={onRetry} secondary />
      <PrimaryButton title="VOLVER A OPERACIONES" icon="arrow-back" onPress={() => router.replace('/home')} secondary />
    </View>
  );
}

function FlightLegCard({
  kind,
  leg,
  timeZone,
}: {
  readonly kind: 'Llegada' | 'Salida';
  readonly leg: RampFlightLegResponse;
  readonly timeZone: string;
}) {
  return (
    <Card style={styles.legCard}>
      <View style={styles.routeRow}>
        <Airport code={leg.origin.iataCode} name={leg.origin.name} />
        <View style={styles.routeLine}>
          <Ionicons name="airplane" size={18} color={colors.orange} />
        </View>
        <Airport align="right" code={leg.destination.iataCode} name={leg.destination.name} />
      </View>
      <View style={styles.legTime}>
        <LegTimes kind={kind === 'Llegada' ? 'arrival' : 'departure'} leg={leg} timeZone={timeZone} />
      </View>
    </Card>
  );
}

function Airport({ align = 'left', code, name }: { readonly align?: 'left' | 'right'; readonly code: string; readonly name: string }) {
  return (
    <View style={[styles.airport, align === 'right' && styles.airportRight]}>
      <Text style={styles.airportCode}>{code}</Text>
      <Text numberOfLines={2} style={[styles.airportName, align === 'right' && styles.textRight]}>{name}</Text>
    </View>
  );
}

function Meta({
  dark = false,
  icon,
  label,
}: {
  readonly dark?: boolean;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
}) {
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={17} color={dark ? colors.navy : colors.onNavyMuted} />
      <Text style={[styles.metaText, dark && styles.metaTextDark]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 1100, alignSelf: 'center', padding: space.lg, paddingBottom: 38 },
  // CN-22: each section spaces itself, so an empty or hidden one takes no room.
  section: { gap: space.md },
  sectionSpaced: { marginTop: space.lg },
  sectionHidden: { display: 'none' },
  startControl: {
    padding: space.lg,
    gap: space.md,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },
  startHeading: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  startIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  startCopy: { flex: 1, minWidth: 180 },
  startTitle: { ...type.title, color: colors.ink },
  startDescription: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  startAction: { minWidth: 240, flexGrow: 1, maxWidth: 360 },
  startedAtRow: {
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.xl,
    rowGap: space.sm,
  },
  startedAtItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  startedAtText: { flexShrink: 1, color: colors.success, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  handoffCard: {
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.orangeLine,
    backgroundColor: colors.white,
    gap: space.md,
  },
  handoffDelivered: { borderColor: colors.greenLine },
  returnedCard: { borderColor: colors.redLine },
  handoffHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  handoffIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleOrange,
  },
  handoffIconDelivered: { backgroundColor: colors.paleGreen },
  returnedIcon: { backgroundColor: colors.paleRed },
  handoffCopy: { flex: 1, minWidth: 0 },
  handoffKicker: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  handoffTitle: { ...type.title, color: colors.ink, marginTop: 1 },
  returnReason: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    padding: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.paleRed,
  },
  handoffNoteGroup: { gap: 6 },
  handoffLabel: { color: colors.navy, fontSize: 13, fontWeight: '800' },
  handoffNoteInput: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    color: colors.ink,
    backgroundColor: colors.white,
    fontSize: 15,
    lineHeight: 21,
  },
  handoffCounter: { alignSelf: 'flex-end', color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  metaText: { flex: 1, color: colors.white, fontSize: 14, fontWeight: '700' },
  metaTextDark: { color: colors.ink },
  legs: { gap: space.md },
  legCard: { gap: 14 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // N11: a long name («Punta Cana Development») takes up to two lines beside the route, not a fixed 76 dp column.
  airport: { flexShrink: 1, minWidth: 76, maxWidth: '40%' },
  airportRight: { alignItems: 'flex-end' },
  airportCode: { color: colors.navy, fontSize: 24, fontWeight: '900', letterSpacing: 0.5 },
  airportName: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  textRight: { textAlign: 'right' },
  routeLine: {
    flex: 1,
    height: 23,
    marginBottom: 8,
    borderBottomWidth: 1.5,
    borderStyle: 'dashed',
    borderBottomColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legTime: { paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.divider, flexDirection: 'row' },
  pendingCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pendingCopy: { flex: 1 },
  pendingTitle: { color: colors.ink, fontWeight: '900' },
  pendingText: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 3 },
  servicesList: { gap: space.md },
  noServices: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  noServicesText: { flex: 1, color: colors.muted, fontSize: 13 },
  assignmentCard: { gap: space.md },
  nextPhase: {
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  nextPhaseIcon: {
    width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  nextPhaseCopy: { flex: 1, gap: 10 },
  nextPhaseHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  nextPhaseTitle: { ...type.title, color: colors.ink },
  nextPhaseWarning: { color: colors.warning, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  stateScreen: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14, backgroundColor: colors.background,
  },
  stateIcon: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.paleAmber,
  },
  stateTitle: { ...type.title, color: colors.ink, textAlign: 'center' },
  stateMessage: { maxWidth: 380, color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: 'center' },
});
