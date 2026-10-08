import type {
  RampAssignedOperationResponse,
  RampFlightLegResponse,
  RampGroundOperationResponse,
  RampOperationServiceResponse,
} from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Card, PrimaryButton, StatusPill } from '../../components/ui';
import { AttendanceDraftCard } from '../../components/attendance-draft-card';
import {
  RampServiceExecutionCard,
  type ServiceExecutionNotice,
} from '../../components/ramp-service-execution-card';
import { RampOperationChargesCard } from '../../components/ramp-operation-charges-card';
import {
  flightLegTimeLabel,
  formatOperationDate,
  formatOperationTime,
  operationAircraftLabel,
  operationFlightLabel,
  operationStandLabel,
  operationStatusLabel,
  operationStatusTone,
  serviceStatusLabel,
} from '../../features/assigned-operations/presentation';
import { getAssignedOperations } from '../../services/assigned-operations';
import { MobileServiceError } from '../../services/mobile-auth';
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
  readRampOperationServicePendingTransition,
  transitionRampOperationService,
  type RampOperationServiceExecutionResponse,
  type RampOperationServiceTargetStatus,
  type RampServicePendingTransition,
  type TransitionRampOperationServiceRequest,
} from '../../services/ramp-operation-service-execution';
import { colors } from '../../theme/colors';
import { resetToLogin } from '../../utils/session-navigation';
import { dateTimeFormat } from '../../utils/date-format';

type DetailState = 'loading' | 'ready' | 'not-found' | 'offline' | 'unavailable';
type StartNotice = Readonly<{
  tone: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}>;

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
  const [serviceReconciliationRequired, setServiceReconciliationRequired] = useState(false);
  const [serviceNotices, setServiceNotices] = useState<Readonly<Record<string, ServiceExecutionNotice>>>({});
  const [pendingServiceCommands, setPendingServiceCommands] = useState<Readonly<Record<string, RampServicePendingTransition>>>({});
  const [pendingSubmission, setPendingSubmission] = useState<RampOperationPendingSubmission | null>(null);
  const [submissionNote, setSubmissionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submissionNotice, setSubmissionNotice] = useState<StartNotice | null>(null);
  const [submissionReconciliationRequired, setSubmissionReconciliationRequired] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correctionPending, setCorrectionPending] = useState(false);
  const [correctionNotice, setCorrectionNotice] = useState<StartNotice | null>(null);
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
      setPendingServiceCommands({});
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
      let pendingCommands: Readonly<Record<string, RampServicePendingTransition>> | undefined;
      let pendingHandoff: RampOperationPendingSubmission | null = null;
      if (found && snapshot.source === 'network') {
        pendingCommands = await findPendingServiceCommands(
          found.operation.id,
          found.services,
        );
      }
      if (found) {
        pendingHandoff = await readRampOperationPendingSubmission(found.operation.id);
        setCorrectionPending(await readPendingRampCorrection(found.operation.id));
      }
      if (request.signal.aborted) return;
      setOperation(found);
      setCached(snapshot.source === 'cache');
      setState(found ? 'ready' : 'not-found');
      loadedOperationIdRef.current = found ? id ?? null : null;
      if (snapshot.source === 'network') {
        setServiceReconciliationRequired(false);
      }
      if (pendingCommands) setPendingServiceCommands(pendingCommands);
      else if (!found) setPendingServiceCommands({});
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

  useFocusEffect(useCallback(() => {
    setFocused(true);
    void load(loadedOperationIdRef.current === id ? 'silent' : false);
    return () => {
      setFocused(false);
      requestRef.current?.abort();
      startRequestRef.current?.abort();
      serviceRequestRef.current?.abort();
      submissionRequestRef.current?.abort();
      correctionRequestRef.current?.abort();
      startInFlightRef.current = false;
      serviceInFlightRef.current = false;
      submissionInFlightRef.current = false;
      correctionInFlightRef.current = false;
    };
  }, [id, load]));

  const startOperation = useCallback(async () => {
    if (
      startInFlightRef.current ||
      !operation ||
      cached ||
      operation.operation.status !== 'Assigned'
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
      const response = await startAssignedRampOperation(operation.operation.id, {
        signal: request.signal,
      });
      if (request.signal.aborted) return;

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
  }, [cached, load, operation]);

  const transitionService = useCallback(async (
    service: RampOperationServiceResponse,
    transitionRequest: TransitionRampOperationServiceRequest,
  ) => {
    if (
      serviceInFlightRef.current ||
      !operation ||
      cached ||
      operation.operation.status !== 'InProgress' ||
      (isTerminalServiceStatus(service.status) &&
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
    setServiceNotices((current) => {
      const next = { ...current };
      delete next[service.id];
      return next;
    });

    try {
      const response = await transitionRampOperationService(
        operation.operation.id,
        service.id,
        transitionRequest,
        { signal: request.signal },
      );
      if (request.signal.aborted) return;

      lastServiceExecutionsRef.current.set(service.id, response.service);
      setServiceReconciliationRequired(false);
      setOperation((current) => current
        ? {
            ...current,
            services: current.services.map((candidate) =>
              candidate.id === response.service.id
                ? { ...candidate, ...response.service }
                : candidate),
          }
        : current);
      setPendingServiceCommands((current) => {
        const next = { ...current };
        delete next[service.id];
        return next;
      });
      setServiceNotices((current) => ({
        ...current,
        [service.id]: {
          tone: 'success',
          title: 'Servicio actualizado',
          message: `${service.name} quedó en estado ${serviceStatusLabel(response.service.status).toLowerCase()}.`,
        },
      }));
      await load(true);
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof MobileServiceError) {
        if (error.code === 'unauthenticated' || error.code === 'session_expired') {
          resetToLogin('session_expired');
          return;
        }
        if (error.code === 'forbidden') {
          resetToLogin('access_revoked');
          return;
        }
        let reservedPending: RampServicePendingTransition | null = null;
        let pendingReadFailed = false;
        try {
          reservedPending = await readRampOperationServicePendingTransition(
            operation.operation.id,
            service.id,
            transitionRequest.targetStatus,
          );
          setPendingServiceCommands((current) => {
            const next = { ...current };
            if (reservedPending) next[service.id] = reservedPending;
            else delete next[service.id];
            return next;
          });
          setServiceReconciliationRequired(false);
        } catch {
          pendingReadFailed = true;
          setServiceReconciliationRequired(true);
        }
        if (pendingReadFailed) {
          setServiceNotices((current) => ({
            ...current,
            [service.id]: {
              tone: 'error',
              title: 'Estado local por conciliar',
              message: 'No pudimos verificar el comando reservado. Actualiza el detalle; mientras tanto, todos los comandos de servicio permanecen bloqueados.',
            },
          }));
          return;
        }
        if (error.code === 'cancelled') {
          setServiceNotices((current) => ({
            ...current,
            [service.id]: {
              tone: 'warning',
              title: 'Sesión actualizada',
              message: 'La revisión de sesión cambió durante el comando. Verificaremos el estado canónico y el replay reservado.',
            },
          }));
          await load(true);
          return;
        }
        if (error.code === 'network_unavailable' || error.code === 'request_timeout') {
          setServiceNotices((current) => ({
            ...current,
            [service.id]: serviceTransitionErrorNotice(error),
          }));
          return;
        }
        setServiceNotices((current) => ({
          ...current,
          [service.id]: serviceTransitionErrorNotice(error),
        }));
        if (error.code === 'not_found' || error.code === 'conflict') {
          await load(true);
        }
        if (
          reservedPending &&
          error.code !== 'not_found' &&
          error.code !== 'conflict' &&
          error.code !== 'device_conflict'
        ) {
          setServiceNotices((current) => ({
            ...current,
            [service.id]: {
              tone: 'warning',
              title: 'Respuesta no confirmada',
              message: 'El payload quedó reservado. El próximo intento reutilizará exactamente el mismo comando.',
            },
          }));
        }
        return;
      }
      setServiceNotices((current) => ({
        ...current,
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
  }, [cached, load, operation]);

  const handoffOperation = useCallback(async () => {
    if (
      submissionInFlightRef.current || !operation || cached ||
      busyServiceId !== null || Object.keys(pendingServiceCommands).length > 0 ||
      serviceReconciliationRequired || submissionReconciliationRequired ||
      (!pendingSubmission && (
        operation.operation.status !== 'InProgress' ||
        operation.services.length === 0 ||
        operation.services.some(service => !isTerminalServiceStatus(service.status))
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
          title: 'Entrega por conciliar',
          message: 'No pudimos verificar el comando reservado. Actualiza el detalle antes de volver a enviar.',
        });
      }
    } finally {
      if (submissionRequestRef.current === request) {
        submissionRequestRef.current = null;
        submissionInFlightRef.current = false;
        if (!request.signal.aborted) setSubmitting(false);
      }
    }
  }, [busyServiceId, cached, operation, pendingServiceCommands, pendingSubmission,
    serviceReconciliationRequired, submissionNote, submissionReconciliationRequired]);

  const confirmHandoff = useCallback(() => {
    if (pendingSubmission) {
      void handoffOperation();
      return;
    }
    Alert.alert(
      'Entregar operación a OCC',
      'Confirma que el checklist está enviado, los servicios terminaron y las incidencias pendientes están sincronizadas. Una vez entregada, la ejecución queda cerrada para revisión.',
      [
        { text: 'Seguir revisando', style: 'cancel' },
        { text: 'Entregar a OCC', onPress: () => void handoffOperation() },
      ],
    );
  }, [handoffOperation, pendingSubmission]);

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
            ? 'La respuesta no se confirmó. Reintenta con la misma clave sin cerrar sesión.'
            : 'Actualiza el detalle y comprueba que OCC devolvió la operación.',
        });
      } catch {
        setCorrectionNotice({ tone: 'error', title: 'Estado local por conciliar',
          message: 'Actualiza el detalle antes de intentar otro comando.' });
      }
    } finally {
      if (correctionRequestRef.current === request) {
        correctionRequestRef.current = null;
        correctionInFlightRef.current = false;
        if (!request.signal.aborted) setCorrecting(false);
      }
    }
  }, [cached, correctionPending, load, operation]);

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

  if (state !== 'ready' || !operation) {
    return <DetailStateScreen onRetry={() => void load()} state={state} />;
  }

  const { assignment, turnaround } = operation;
  const timeZone = turnaround.station.ianaTimeZone;
  const pendingServiceId = Object.keys(pendingServiceCommands)[0] ?? null;
  const hasOperationalChecklist = operation.services.some(
    service => service.code === 'PASSENGER-BRIDGE',
  );

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: 38 + insets.bottom }]}
      refreshControl={(
        <RefreshControl
          accessibilityLabel="Actualizar detalle de la operación"
          colors={[colors.navy]}
          onRefresh={() => void load(true)}
          refreshing={refreshing}
          tintColor={colors.navy}
        />
      )}
    >
      {cached && (
        <View accessibilityLiveRegion="polite" style={styles.cachedBanner}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.warning} />
          <Text style={styles.cachedText}>Vista guardada · desliza hacia abajo para reconectar.</Text>
        </View>
      )}

      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroTitle}>
            <Text style={styles.eyebrow}>OPERACIÓN {turnaround.operationCode}</Text>
            <Text style={styles.flight}>{operationFlightLabel(operation)}</Text>
            <Text style={styles.airline}>{turnaround.airline.name}</Text>
          </View>
          <StatusPill
            text={operationStatusLabel(operation.operation.status)}
            tone={operationStatusTone(operation.operation.status)}
          />
        </View>

        <View style={styles.heroMeta}>
          <Meta icon="calendar-outline" label={formatOperationDate(turnaround.operationDate)} />
          <Meta icon="location-outline" label={`${turnaround.station.code} · ${turnaround.station.name}`} />
          <Meta icon="navigate-outline" label={operationStandLabel(operation)} />
          <Meta icon="airplane-outline" label={operationAircraftLabel(operation)} />
        </View>
      </Card>

      <OperationStartControl
        cached={cached}
        notice={startNotice}
        onStart={() => void startOperation()}
        operation={operation.operation}
        starting={starting}
        timeZone={timeZone}
      />

      {operation.operation.id && assignment.id && (
        <AttendanceDraftCard
          key={`${operation.operation.id}:${assignment.id}`}
          operationId={operation.operation.id}
          assignmentId={assignment.id}
          active={focused}
        />
      )}

      {(operation.review?.status === 'Returned' || correctionPending) && (
        <View style={styles.handoffCard}>
          <Text accessibilityRole="header" style={styles.handoffTitle}>
            {operation.operation.status === 'Returned' ? 'Devuelta por OCC' : 'Corrección en curso'}
          </Text>
          <Text style={styles.startDescription}>
            Revisión {operation.review?.revisionNumber ?? '—'} · Motivo de devolución:
          </Text>
          <Text style={styles.nextPhaseWarning}>
            {operation.review?.returnReason ?? 'Actualiza el detalle para consultar el motivo.'}
          </Text>
          <Text style={styles.startDescription}>
            El checklist y los servicios enviados anteriormente se conservan como historial.
          </Text>
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
      )}

      <SectionTitle title="Movimiento aéreo" subtitle={`Horario local · ${timeZone}`} />
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

      <SectionTitle
        title="Servicios contratados"
        subtitle={`${operation.services.length} ${operation.services.length === 1 ? 'línea' : 'líneas'} de servicio`}
      />
      <View style={styles.servicesList}>
        {operation.services.length > 0 ? operation.services.map((service) => (
          <RampServiceExecutionCard
            actionable={
              !cached &&
              !serviceReconciliationRequired &&
              operation.operation.status === 'InProgress' &&
              (pendingServiceId === null || pendingServiceId === service.id) &&
              (busyServiceId === null || busyServiceId === service.id)
            }
            busy={busyServiceId === service.id}
            correctionMode={operation.operation.status === 'InProgress' &&
              operation.review?.status === 'Returned'}
            disabledReason={
              cached
                ? 'Reconecta y actualiza el detalle antes de registrar un cambio.'
                : serviceReconciliationRequired
                  ? 'Actualiza el detalle para conciliar el comando local antes de continuar.'
                : operation.operation.status !== 'InProgress'
                  ? 'Inicia la operación antes de ejecutar sus servicios.'
                  : pendingServiceId && pendingServiceId !== service.id
                    ? 'Confirma primero el comando pendiente del otro servicio.'
                  : busyServiceId && busyServiceId !== service.id
                    ? 'Espera a que termine el comando del otro servicio.'
                    : undefined
            }
            key={service.id}
            notice={serviceNotices[service.id]}
            onTransition={serviceTransitionHandlers.get(service.id)!}
            pending={pendingServiceCommands[service.id]}
            service={service}
          />
        )) : (
          <Card style={styles.noServices}>
            <Ionicons name="construct-outline" size={23} color={colors.muted} />
            <Text style={styles.noServicesText}>No hay servicios asociados a esta operación.</Text>
          </Card>
        )}
      </View>
      {!cached && operation.services.length > 0 && (
        <RampOperationChargesCard
          operationId={operation.operation.id}
          refreshKey={`${operation.operation.status}:${operation.review?.status ?? ''}:${operation.services.map(service => service.status).join(',')}`}
          services={operation.services}
        />
      )}

      {operation.operation.status === 'InProgress' && (
        <View style={styles.nextPhase}>
          <View style={styles.nextPhaseIcon}>
            <Ionicons name="alert-circle-outline" size={26} color={colors.navy} />
          </View>
          <View style={styles.nextPhaseCopy}>
            <Text style={styles.nextPhaseTitle}>Incidencias</Text>
            <Text style={styles.nextPhaseText}>
              Registra eventos operativos, de seguridad, equipo o documentación. El reporte se conserva localmente si pierdes la conexión.
            </Text>
            <PrimaryButton
              icon="alert-circle-outline"
              onPress={() => router.push({ pathname: '/incident/[id]', params: { id: operation.operation.id } })}
              title="ABRIR INCIDENCIAS"
            />
          </View>
        </View>
      )}

      {hasOperationalChecklist && (
        <View style={styles.nextPhase}>
          <View style={styles.nextPhaseIcon}>
            <Ionicons name="shield-checkmark-outline" size={26} color={colors.navy} />
          </View>
          <View style={styles.nextPhaseCopy}>
            <Text style={styles.nextPhaseTitle}>Checklist operativo</Text>
            <Text style={styles.nextPhaseText}>
              Completa las secciones vigentes para esta operación. El envío del checklist no finaliza ni remite la operación a OCC.
            </Text>
            {cached && (
              <Text style={styles.nextPhaseWarning}>
                Reconecta y actualiza el detalle para abrir el checklist canónico.
              </Text>
            )}
            {operation.operation.status === 'Assigned' && (
              <Text style={styles.nextPhaseWarning}>
                Inicia la operación antes de completar el checklist.
              </Text>
            )}
            {pendingServiceId && (
              <Text style={styles.nextPhaseWarning}>
                Confirma primero el comando de servicio pendiente.
              </Text>
            )}
            {serviceReconciliationRequired && (
              <Text style={styles.nextPhaseWarning}>
                Actualiza el detalle para conciliar el comando local antes de abrir el checklist.
              </Text>
            )}
            <PrimaryButton
              disabled={
                cached ||
                operation.operation.status !== 'InProgress' ||
                busyServiceId !== null ||
                pendingServiceId !== null ||
                serviceReconciliationRequired
              }
              icon="clipboard-outline"
              onPress={() => router.push({
                pathname: '/checklist/[id]',
                params: { id: operation.operation.id },
              })}
              title="ABRIR CHECKLIST"
            />
          </View>
        </View>
      )}

      {(hasOperationalChecklist || pendingSubmission || operation.operation.status === 'PendingReview') && (
        <OperationSubmissionControl
          blocked={
            cached || busyServiceId !== null || pendingServiceId !== null ||
            serviceReconciliationRequired || submissionReconciliationRequired
          }
          note={submissionNote}
          notice={submissionNotice}
          onChangeNote={setSubmissionNote}
          onSubmit={confirmHandoff}
          operation={operation.operation}
          correctionRevision={operation.review?.status === 'Returned'
            ? operation.review.revisionNumber + 1 : null}
          pending={pendingSubmission}
          servicesReady={operation.services.length > 0 && operation.services.every(
            service => isTerminalServiceStatus(service.status))}
          submitting={submitting}
        />
      )}

      <SectionTitle title="Asignación" />
      <Card style={styles.assignmentCard}>
        <Meta icon="briefcase-outline" label={assignment.assignmentRole} dark />
        <Meta
          icon="ribbon-outline"
          label={assignment.position ? `${assignment.position.code} · ${assignment.position.name}` : 'Posición operativa no especificada'}
          dark
        />
        <Meta
          icon="time-outline"
          label={`Asignada ${formatDateTime(assignment.assignedAt, timeZone)}`}
          dark
        />
      </Card>

    </ScrollView>
  );
}

function OperationStartControl({
  cached,
  notice,
  onStart,
  operation,
  starting,
  timeZone,
}: {
  readonly cached: boolean;
  readonly notice: StartNotice | null;
  readonly onStart: () => void;
  readonly operation: RampGroundOperationResponse;
  readonly starting: boolean;
  readonly timeZone: string;
}) {
  const isAssigned = operation.status === 'Assigned';
  const isInProgress = operation.status === 'InProgress';

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.startControl,
        isInProgress && styles.startControlActive,
      ]}
    >
      <View style={styles.startRail} />
      <View style={styles.startBody}>
        <View style={styles.startHeading}>
          <View
            style={[
              styles.startIcon,
              isInProgress && styles.startIconActive,
            ]}
          >
            <Ionicons
              name={isInProgress ? 'play' : 'flag-outline'}
              size={22}
              color={isInProgress ? colors.success : colors.orange}
            />
          </View>
          <View style={styles.startCopy}>
            <Text style={styles.startEyebrow}>CONTROL DE OPERACIÓN</Text>
            <Text accessibilityRole="header" style={styles.startTitle}>
              {isInProgress
                ? 'Operación en atención'
                : isAssigned
                  ? 'Lista para iniciar'
                  : 'Inicio no disponible'}
            </Text>
          </View>
        </View>

        {isInProgress ? (
          <View style={styles.startedAtRow}>
            <Ionicons name="checkmark-circle" size={19} color={colors.success} />
            <Text style={styles.startedAtText}>
              {operation.actualStartAt
                ? `Inicio registrado ${formatDateTime(operation.actualStartAt, timeZone)}`
                : 'Inicio confirmado por ELEVANT'}
            </Text>
          </View>
        ) : isAssigned ? (
          <>
            <Text style={styles.startDescription}>
              Confirma que estás en posición y listo para atender esta operación.
            </Text>
            {cached && (
              <View style={styles.startOfflineHint}>
                <Ionicons name="cloud-offline-outline" size={18} color={colors.warning} />
                <Text style={styles.startOfflineText}>
                  Reconecta y actualiza el detalle antes de iniciar.
                </Text>
              </View>
            )}
            <PrimaryButton
              disabled={cached || starting}
              icon="play"
              onPress={onStart}
              title={starting ? 'INICIANDO…' : 'INICIAR OPERACIÓN'}
            />
          </>
        ) : (
          <Text style={styles.startDescription}>
            El estado actual no permite registrar un nuevo inicio.
          </Text>
        )}

        {notice && (
          <View
            accessibilityLiveRegion={notice.tone === 'error' ? 'assertive' : 'polite'}
            style={[
              styles.startNotice,
              notice.tone === 'success' && styles.startNoticeSuccess,
              notice.tone === 'warning' && styles.startNoticeWarning,
              notice.tone === 'error' && styles.startNoticeError,
            ]}
          >
            <Ionicons
              name={notice.tone === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
              size={20}
              color={notice.tone === 'success' ? colors.success : notice.tone === 'warning' ? colors.warning : colors.danger}
            />
            <View style={styles.startNoticeCopy}>
              <Text style={styles.startNoticeTitle}>{notice.title}</Text>
              <Text style={styles.startNoticeText}>{notice.message}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function OperationSubmissionControl({
  blocked,
  note,
  notice,
  onChangeNote,
  onSubmit,
  operation,
  correctionRevision,
  pending,
  servicesReady,
  submitting,
}: {
  readonly blocked: boolean;
  readonly note: string;
  readonly notice: StartNotice | null;
  readonly onChangeNote: (value: string) => void;
  readonly onSubmit: () => void;
  readonly operation: RampGroundOperationResponse;
  readonly correctionRevision: number | null;
  readonly pending: RampOperationPendingSubmission | null;
  readonly servicesReady: boolean;
  readonly submitting: boolean;
}) {
  const delivered = operation.status === 'PendingReview' && !pending;
  const canSubmit = !blocked && !submitting && (
    pending !== null || (operation.status === 'InProgress' && servicesReady));

  return (
    <View style={[styles.handoffCard, delivered && styles.handoffDelivered]}>
      <View style={styles.handoffHeader}>
        <View style={styles.handoffIcon}>
          <Ionicons
            name={delivered ? 'checkmark-done-outline' : 'send-outline'}
            size={22}
            color={delivered ? colors.success : colors.orange}
          />
        </View>
        <View style={styles.handoffCopy}>
          <Text style={styles.startEyebrow}>CIERRE DE EJECUCIÓN</Text>
          <Text accessibilityRole="header" style={styles.handoffTitle}>
            {delivered ? 'Pendiente de revisión OCC' : correctionRevision
              ? `Reenviar corrección ${correctionRevision} a OCC` : 'Entregar operación a OCC'}
          </Text>
        </View>
      </View>
      <Text style={styles.startDescription}>
        {delivered
          ? 'La ejecución quedó cerrada. OCC revisará el checklist, los servicios y las incidencias registradas.'
          : 'Antes de entregar, envía el checklist y termina todos los servicios. Las incidencias pendientes deben sincronizarse.'}
      </Text>
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
        <Text style={styles.nextPhaseWarning}>
          Hay un envío reservado con nota fija. Reconecta y reintenta; no se creará una segunda entrega.
        </Text>
      )}
      {!servicesReady && operation.status === 'InProgress' && !pending && (
        <Text style={styles.nextPhaseWarning}>Termina todos los servicios antes de entregar.</Text>
      )}
      {blocked && !delivered && (
        <Text style={styles.nextPhaseWarning}>
          Actualiza en línea y concilia los comandos pendientes antes de entregar.
        </Text>
      )}
      {(operation.status === 'InProgress' || pending) && (
        <PrimaryButton
          disabled={!canSubmit}
          icon={pending ? 'refresh-outline' : 'send-outline'}
          onPress={onSubmit}
          title={submitting ? 'ENVIANDO…' : pending ? 'REINTENTAR ENTREGA' : 'ENTREGAR A OCC'}
        />
      )}
      {notice && (
        <View
          accessibilityLiveRegion={notice.tone === 'error' ? 'assertive' : 'polite'}
          style={[
            styles.startNotice,
            notice.tone === 'success' && styles.startNoticeSuccess,
            notice.tone === 'warning' && styles.startNoticeWarning,
            notice.tone === 'error' && styles.startNoticeError,
          ]}
        >
          <Ionicons
            name={notice.tone === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            size={20}
            color={notice.tone === 'success' ? colors.success : notice.tone === 'warning' ? colors.warning : colors.danger}
          />
          <View style={styles.startNoticeCopy}>
            <Text style={styles.startNoticeTitle}>{notice.title}</Text>
            <Text style={styles.startNoticeText}>{notice.message}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

async function findPendingServiceCommands(
  operationId: string,
  services: readonly RampOperationServiceResponse[],
) {
  const pending: Record<string, RampServicePendingTransition> = {};
  for (const service of services) {
    const targets = allowedServiceTargets(service.status);
    for (const target of targets) {
      const command = await readRampOperationServicePendingTransition(
        operationId,
        service.id,
        target,
      );
      if (command) {
        pending[service.id] = command;
        break;
      }
    }
  }
  return pending;
}

function allowedServiceTargets(
  status: string,
): readonly RampOperationServiceTargetStatus[] {
  if (status === 'Planned') {
    return ['InProgress', 'NotPerformed', 'Exception'];
  }
  if (status === 'InProgress') {
    return ['Completed', 'NotPerformed', 'Exception'];
  }
  if (isTerminalServiceStatus(status)) return ['InProgress'];
  return [];
}

function isTerminalServiceStatus(status: string) {
  return status === 'Completed' || status === 'NotPerformed' || status === 'Exception';
}

function serviceTransitionErrorNotice(
  error: MobileServiceError,
): ServiceExecutionNotice {
  if (error.code === 'network_unavailable') {
    return {
      tone: 'warning',
      title: 'Estado pendiente de confirmación',
      message: 'La conexión se perdió antes de confirmar el resultado. Sin cerrar sesión, reintenta: ELEVANT reutilizará exactamente el mismo payload y la misma clave.',
    };
  }
  if (error.code === 'request_timeout') {
    return {
      tone: 'warning',
      title: 'Estado pendiente de confirmación',
      message: 'La respuesta tardó demasiado y el resultado es incierto. Sin cerrar sesión, reintenta: ELEVANT reutilizará exactamente el mismo payload y la misma clave.',
    };
  }
  if (error.code === 'conflict') {
    return {
      tone: 'warning',
      title: 'El servicio cambió',
      message: 'Actualizamos el estado canónico. Revísalo antes de registrar otro resultado.',
    };
  }
  if (error.code === 'not_found') {
    return {
      tone: 'warning',
      title: 'Servicio no disponible',
      message: 'El servicio o la asignación ya no están disponibles para esta cuenta.',
    };
  }
  if (error.code === 'device_conflict') {
    return {
      tone: 'error',
      title: 'Dispositivo no autorizado',
      message: 'Cierra sesión y solicita a AVIAM revisar el vínculo de esta instalación.',
    };
  }
  if (error.code === 'storage_unavailable') {
    return {
      tone: 'error',
      title: 'Comando no protegido',
      message: 'No pudimos guardar el payload idempotente. Desbloquea el dispositivo y vuelve a intentar.',
    };
  }
  return {
    tone: 'error',
    title: 'Servicio no actualizado',
    message: error.retryable
      ? 'No pudimos confirmar el cambio. Actualiza el detalle y vuelve a intentarlo.'
      : 'El cambio fue rechazado. Revisa el estado canónico antes de continuar.',
  };
}

function submissionErrorNotice(error: unknown, pending: boolean): StartNotice {
  if (pending) {
    return {
      tone: 'warning',
      title: 'Entrega pendiente de confirmación',
      message: 'El comando quedó protegido. Reintenta con la misma sesión y la misma clave; no edites la nota ni crees otra entrega.',
    };
  }
  if (error instanceof MobileServiceError) {
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
        title: 'Comando no protegido',
        message: 'No pudimos guardar la entrega en el dispositivo. Desbloquéalo y vuelve a intentar.',
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
      title: 'Asignación no disponible',
      message: 'La operación ya no pertenece a tu lista. Estamos actualizando el detalle.',
    };
  }
  if (error.code === 'conflict') {
    return {
      tone: 'warning',
      title: 'La operación cambió',
      message: 'Actualizamos el estado canónico. Revísalo antes de volver a intentar.',
    };
  }
  if (error.code === 'network_unavailable') {
    return {
      tone: 'warning',
      title: 'Inicio pendiente de confirmación',
      message: 'Se perdió la conexión antes de confirmar el estado. Sin cerrar sesión, reconecta y vuelve a intentar: ELEVANT reutilizará el mismo comando sin duplicar el inicio.',
    };
  }
  if (error.code === 'request_timeout') {
    return {
      tone: 'warning',
      title: 'Inicio pendiente de confirmación',
      message: 'La respuesta tardó demasiado. Sin cerrar sesión, vuelve a intentar: ELEVANT reutilizará el mismo comando sin duplicar el inicio.',
    };
  }
  if (error.code === 'storage_unavailable') {
    return {
      tone: 'error',
      title: 'Dispositivo no disponible',
      message: 'No pudimos proteger la identidad del dispositivo. Desbloquéalo y vuelve a intentar.',
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
        <Ionicons name="warning-outline" size={34} color={colors.warning} />
      </View>
      <Text accessibilityRole="header" style={styles.stateTitle}>{copy[0]}</Text>
      <Text style={styles.stateMessage}>{copy[1]}</Text>
      <PrimaryButton title="REINTENTAR" icon="refresh" onPress={onRetry} secondary />
      <PrimaryButton title="VOLVER A OPERACIONES" icon="arrow-back" onPress={() => router.replace('/home')} secondary />
    </View>
  );
}

function SectionTitle({ subtitle, title }: { readonly subtitle?: string; readonly title: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
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
  const currentTime = flightLegTimeLabel(leg);
  return (
    <Card style={styles.legCard}>
      <View style={styles.legHeader}>
        <View style={styles.legKind}>
          <Ionicons name={kind === 'Llegada' ? 'log-in-outline' : 'log-out-outline'} size={18} color={colors.navy} />
          <Text style={styles.legKindText}>{kind.toUpperCase()}</Text>
        </View>
        <Text style={styles.legFlight}>{leg.flightNumber}</Text>
      </View>
      <View style={styles.routeRow}>
        <Airport code={leg.origin.iataCode} name={leg.origin.name} />
        <View style={styles.routeLine}>
          <View style={styles.routeDot} />
          <Ionicons name="airplane" size={18} color={colors.orange} />
          <View style={styles.routeDot} />
        </View>
        <Airport align="right" code={leg.destination.iataCode} name={leg.destination.name} />
      </View>
      <View style={styles.legTime}>
        <Text style={styles.timeLabel}>{currentTime.label}</Text>
        <Text style={styles.timeValue}>{formatOperationTime(currentTime.value, timeZone)}</Text>
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
      <Ionicons name={icon} size={17} color={dark ? colors.navy : '#C5D4EB'} />
      <Text style={[styles.metaText, dark && styles.metaTextDark]}>{label}</Text>
    </View>
  );
}

function formatDateTime(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'por confirmar';
  try {
    return dateTimeFormat({ day: '2-digit', hour: '2-digit', minute: '2-digit', month: 'short', timeZone }).format(date);
  } catch {
    return 'por confirmar';
  }
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 960, alignSelf: 'center', padding: 16, paddingBottom: 38, gap: 12 },
  cachedBanner: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#F0C474',
    borderRadius: 14,
    backgroundColor: '#FFF8EA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  cachedText: { flex: 1, color: colors.warning, fontSize: 12, fontWeight: '700' },
  hero: { padding: 19, backgroundColor: colors.navy, borderColor: colors.navy },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heroTitle: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.orangeOnNavy, fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
  flight: { color: colors.white, fontSize: 26, fontWeight: '900', marginTop: 5 },
  airline: { color: '#C5D4EB', fontSize: 12, marginTop: 3 },
  heroMeta: { borderTopWidth: 1, borderTopColor: '#34558A', marginTop: 17, paddingTop: 14, gap: 9 },
  startControl: {
    borderWidth: 1,
    borderColor: '#FFD0B7',
    borderRadius: 18,
    backgroundColor: colors.white,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#081C3A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  startControlActive: { borderColor: '#B9DFC9', backgroundColor: '#F8FCFA' },
  startRail: { width: 6, backgroundColor: colors.orange },
  startBody: { flex: 1, minWidth: 0, padding: 16, gap: 12 },
  startHeading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  startIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleOrange,
  },
  startIconActive: { backgroundColor: '#E9F7EF' },
  startCopy: { flex: 1, minWidth: 0 },
  startEyebrow: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.25 },
  startTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: 2 },
  startDescription: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  startOfflineHint: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#FFF8EA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  startOfflineText: { flex: 1, color: colors.warning, fontSize: 12, fontWeight: '700' },
  startedAtRow: {
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: '#D7EBDF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  startedAtText: { flex: 1, color: colors.success, fontSize: 13, fontWeight: '800' },
  startNotice: {
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  startNoticeSuccess: { borderColor: '#B9DFC9', backgroundColor: '#E9F7EF' },
  startNoticeWarning: { borderColor: '#F0C474', backgroundColor: '#FFF8EA' },
  startNoticeError: { borderColor: '#F1BBBB', backgroundColor: '#FDECEC' },
  startNoticeCopy: { flex: 1, minWidth: 0 },
  startNoticeTitle: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  startNoticeText: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  handoffCard: {
    marginTop: 8,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FFD0B7',
    backgroundColor: colors.white,
    gap: 12,
  },
  handoffDelivered: { borderColor: '#B9DFC9', backgroundColor: '#F8FCFA' },
  handoffHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  handoffIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleOrange,
  },
  handoffCopy: { flex: 1, minWidth: 0 },
  handoffTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: 2 },
  handoffNoteGroup: { gap: 6 },
  handoffLabel: { color: colors.navy, fontSize: 13, fontWeight: '800' },
  handoffNoteInput: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.ink,
    backgroundColor: colors.white,
    fontSize: 14,
    lineHeight: 21,
  },
  handoffCounter: { alignSelf: 'flex-end', color: colors.muted, fontSize: 11 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { flex: 1, color: colors.white, fontSize: 12, fontWeight: '700' },
  metaTextDark: { color: colors.ink },
  sectionTitleRow: { marginTop: 7 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  sectionSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  legs: { gap: 10 },
  legCard: { gap: 15 },
  legHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  legKind: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legKindText: { color: colors.navy, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  legFlight: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  airport: { width: 76 },
  airportRight: { alignItems: 'flex-end' },
  airportCode: { color: colors.navy, fontSize: 20, fontWeight: '900' },
  airportName: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  textRight: { textAlign: 'right' },
  routeLine: {
    flex: 1,
    height: 23,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#CBD6E6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  routeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#9EACC0' },
  legTime: { paddingTop: 11, borderTopWidth: 1, borderTopColor: '#E7ECF3', flexDirection: 'row', justifyContent: 'space-between' },
  timeLabel: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  timeValue: { color: colors.navy, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  pendingCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pendingCopy: { flex: 1 },
  pendingTitle: { color: colors.ink, fontWeight: '900' },
  pendingText: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  servicesList: { gap: 10 },
  servicesCard: { paddingVertical: 6 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  serviceSeparator: { borderBottomWidth: 1, borderBottomColor: colors.border },
  serviceNumber: { width: 29, height: 29, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleBlue },
  serviceNumberText: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  serviceCopy: { flex: 1, minWidth: 0 },
  serviceName: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  serviceCode: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: 2 },
  serviceQuantity: { color: colors.navy, fontSize: 12, fontWeight: '700', marginTop: 4 },
  noServices: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  noServicesText: { flex: 1, color: colors.muted, fontSize: 12 },
  assignmentCard: { gap: 10 },
  nextPhase: {
    marginTop: 6,
    padding: 15,
    borderWidth: 1,
    borderColor: '#C8D7EC',
    borderRadius: 17,
    backgroundColor: '#EDF4FC',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  nextPhaseIcon: { width: 45, height: 45, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  nextPhaseCopy: { flex: 1, gap: 10 },
  nextPhaseTitle: { color: colors.navy, fontWeight: '900' },
  nextPhaseText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  nextPhaseWarning: { color: colors.warning, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  stateScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 13, backgroundColor: colors.background },
  stateIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8EA' },
  stateTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  stateMessage: { maxWidth: 360, color: colors.muted, lineHeight: 20, textAlign: 'center' },
});
