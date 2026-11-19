import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SessionEndedNotice, useScreenSessionNotice } from '../../components/session-ended-notice';
import { Card, PrimaryButton, StatusPill } from '../../components/ui';
import {
  getRampOperationChecklist,
  readRampChecklistPendingSubmission,
  readRampOperationChecklistDraft,
  saveRampOperationChecklistDraft,
  submitRampOperationChecklist,
  type GetRampOperationChecklistResponse,
  type RampChecklistDraft,
  type RampChecklistDraftAnswer,
  type RampChecklistItem,
  type RampChecklistPendingSubmission,
  type RampChecklistSection,
  type SubmitRampOperationChecklistRequest,
} from '../../services/ramp-operation-checklist';
import { MobileServiceError, subscribeMobileSessionEnd } from '../../services/mobile-auth';
import { colors } from '../../theme/colors';

type ChecklistScreenState =
  | 'loading'
  | 'ready'
  | 'not-found'
  | 'offline'
  | 'conflict'
  | 'unavailable'
  | 'session-ended';
/** 'not-kept': the session ended and the last answers could not be kept for the account any more (N5, N6). */
type DraftSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'not-kept';
/**
 * How one save of the draft ended (N6): on the device with the session ('saved'), kept for the account after its
 * session ended ('kept'), not kept because no session of the account remains ('not-kept'), or not saved by the
 * device's storage ('failed').
 */
type DraftWriteOutcome = 'saved' | 'kept' | 'not-kept' | 'failed';
/** The session ended without the agent signing out (N6); 'revoked' when the account lost its access to the app. */
type SessionEnd = 'ended' | 'revoked';
/** The device could not save the draft (N6): once, or again after REINTENTAR GUARDADO or another answer. */
type DraftProblem = 'failed' | 'failed-again';
type Notice = Readonly<{
  tone: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}>;
type PendingDraftSave = Readonly<{
  operationId: string;
  /** The account the screen loaded the draft for (N5): its answers stay with it after its session ends. */
  accountId: string;
  draft: RampChecklistDraft;
}>;

const DRAFT_SCHEMA_VERSION = 1 as const;

/**
 * Saves one draft for the account the screen loaded it with (N5) and says how that ended (N6). A save cancelled under
 * the screen is tried once more for the same account; a second cancellation is a failure, never an endless «Guardando…».
 */
async function saveDraft(pending: PendingDraftSave, retried = false): Promise<DraftWriteOutcome> {
  try {
    const saved = await saveRampOperationChecklistDraft(pending.operationId, pending.draft, pending.accountId);
    return saved === 'kept-until-sign-in' ? 'kept' : 'saved';
  } catch (error) {
    if (!(error instanceof MobileServiceError)) return 'failed';
    if (error.code === 'cancelled' && !retried) return saveDraft(pending, true);
    return error.code === 'session_expired' || error.code === 'unauthenticated' ? 'not-kept' : 'failed';
  }
}

export default function ChecklistScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [snapshot, setSnapshot] = useState<GetRampOperationChecklistResponse | null>(null);
  const [answers, setAnswers] = useState<Readonly<Record<string, RampChecklistDraftAnswer>>>({});
  const [pendingSubmission, setPendingSubmission] = useState<RampChecklistPendingSubmission | null>(null);
  const [state, setState] = useState<ChecklistScreenState>('loading');
  const [sectionIndex, setSectionIndex] = useState(0);
  const [highestUnlockedSection, setHighestUnlockedSection] = useState(0);
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>('idle');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionReconciliationRequired, setSubmissionReconciliationRequired] = useState(false);
  const [validationRequested, setValidationRequested] = useState(false);
  const [sessionEnd, setSessionEnd] = useState<SessionEnd | null>(null);
  const [draftProblem, setDraftProblem] = useState<DraftProblem | null>(null);
  // N6: ENVIAR met the end of the session; the submission usually waits in the queue already, so the answers on screen
  // stay as they were sent until the agent signs in again.
  const [heldForSignIn, setHeldForSignIn] = useState(false);
  const sessionEndRef = useRef<SessionEnd | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const submitRequestRef = useRef<AbortController | null>(null);
  const submitInFlightRef = useRef(false);
  const contentScrollRef = useRef<ScrollView | null>(null);
  const answersRef = useRef<Readonly<Record<string, RampChecklistDraftAnswer>>>({});
  // N5: the account the draft was loaded for; every save names it, so answers marked after the session ended are kept.
  const draftOwnerRef = useRef<string | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftSaveRef = useRef<PendingDraftSave | null>(null);
  const draftWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftWriteFailedRef = useRef(false);
  const mountedRef = useRef(false);

  /**
   * The session ended without the agent signing out (N6, D-N6): the screen says so and offers ENTRAR DE NUEVO; it never
   * leaves on its own, so what the agent marked stays in view. An account that lost its access stays so.
   */
  const endSession = useCallback((end: SessionEnd) => {
    if (sessionEndRef.current === 'revoked') return;
    sessionEndRef.current = end;
    if (mountedRef.current) setSessionEnd(end);
  }, []);

  /** Saves one draft after the ones before it, and shows how it ended (N6). */
  const runDraftSave = useCallback((pending: PendingDraftSave) => {
    draftWriteQueueRef.current = draftWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (mountedRef.current) setDraftSaveState('saving');
        const outcome = await saveDraft(pending);
        draftWriteFailedRef.current = outcome === 'failed' || outcome === 'not-kept';
        // Kept for the account without its session, or no longer kept: the session ended either way (N5).
        if (outcome === 'kept' || outcome === 'not-kept') endSession('ended');
        if (!mountedRef.current) return;
        setDraftSaveState(outcome === 'failed' ? 'error' : outcome === 'not-kept' ? 'not-kept' : 'saved');
        setDraftProblem((current) => (outcome !== 'failed' ? null : current ? 'failed-again' : 'failed'));
      });
  }, [endSession]);

  const queueDraftSave = useCallback((pending: PendingDraftSave) => {
    pendingDraftSaveRef.current = pending;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    if (mountedRef.current) setDraftSaveState('saving');
    draftTimerRef.current = setTimeout(() => {
      const current = pendingDraftSaveRef.current;
      pendingDraftSaveRef.current = null;
      draftTimerRef.current = null;
      if (current) runDraftSave(current);
    }, 250);
  }, [runDraftSave]);

  const flushDraftSave = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
    const current = pendingDraftSaveRef.current;
    pendingDraftSaveRef.current = null;
    if (current) runDraftSave(current);
  }, [runDraftSave]);

  const load = useCallback(async (refresh = false) => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    if (!refresh) {
      setState('loading');
      setSubmitting(false);
      setNotice(null);
    }

    try {
      if (refresh) {
        flushDraftSave();
        await draftWriteQueueRef.current;
        // The screen is not read again over answers the tablet did not save (N6). The session notice explains an
        // ended session; otherwise the device failed, and its notice offers REINTENTAR GUARDADO.
        if (draftWriteFailedRef.current) {
          if (!sessionEndRef.current) {
            setNotice({
              tone: 'warning',
              title: 'Pantalla sin actualizar',
              message: 'Primero guarda tus respuestas en esta tablet: toca REINTENTAR GUARDADO.',
            });
          }
          return;
        }
      }
      if (typeof id !== 'string') {
        setSnapshot(null);
        setState('not-found');
        return;
      }
      const nextSnapshot = await getRampOperationChecklist(id, {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      const [loadedDraft, pending] = await Promise.all([
        readRampOperationChecklistDraft(id, nextSnapshot.checklist.id),
        readRampChecklistPendingSubmission(id, nextSnapshot.checklist.id),
      ]);
      if (request.signal.aborted) return;

      const draft = loadedDraft.draft;
      draftOwnerRef.current = loadedDraft.accountId;
      const mergedAnswers = mergeAnswers(nextSnapshot, draft, pending);
      const lastSection = Math.max(0, nextSnapshot.checklist.sections.length - 1);
      const initialSection = pending || nextSnapshot.checklist.status === 'Submitted'
        ? lastSection
        : firstIncompleteSection(
            nextSnapshot.checklist.sections,
            mergedAnswers,
          );
      setSnapshot(nextSnapshot);
      answersRef.current = mergedAnswers;
      setAnswers(mergedAnswers);
      setPendingSubmission(pending);
      setSubmissionReconciliationRequired(false);
      setSectionIndex(initialSection);
      setHighestUnlockedSection(
        pending || nextSnapshot.checklist.status === 'Submitted'
          ? lastSection
          : initialSection,
      );
      setValidationRequested(false);
      setDraftSaveState(draft ? 'saved' : 'idle');
      draftWriteFailedRef.current = false;
      setDraftProblem(null);
      setState('ready');
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof MobileServiceError) {
        if (error.code === 'cancelled') return;
        // N6 (D-N6): the screen says the session ended and offers ENTRAR DE NUEVO. A screen already open keeps what
        // the agent marked in view; a screen still loading says it instead of the checklist.
        if (error.code === 'unauthenticated' || error.code === 'session_expired' || error.code === 'forbidden') {
          endSession(error.code === 'forbidden' ? 'revoked' : 'ended');
          if (!refresh) {
            setSnapshot(null);
            setState('session-ended');
          }
          return;
        }
      }
      setSnapshot(null);
      if (error instanceof MobileServiceError) {
        if (error.code === 'not_found') {
          setState('not-found');
          return;
        }
        if (error.code === 'conflict') {
          setState('conflict');
          return;
        }
        if (error.code === 'network_unavailable' || error.code === 'request_timeout') {
          setState('offline');
          return;
        }
      }
      setState('unavailable');
    }
  }, [endSession, flushDraftSave, id]);

  // N6: the moment the tablet ends the session, here or anywhere else (another request, the queue, the presence), the
  // screen says so.
  useEffect(() => subscribeMobileSessionEnd((ended) => {
    const owner = draftOwnerRef.current;
    if (ended.accountId && owner && ended.accountId !== owner.toLowerCase()) return;
    endSession(ended.reason === 'forbidden' ? 'revoked' : 'ended');
  }), [endSession]);

  useFocusEffect(useCallback(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      submitRequestRef.current?.abort();
      submitInFlightRef.current = false;
      flushDraftSave();
    };
  }, [flushDraftSave, load]));

  const sections = useMemo(
    () => snapshot?.checklist.sections ?? [],
    [snapshot],
  );
  const currentSection = sections[sectionIndex];
  const submitted = snapshot?.checklist.status === 'Submitted';
  const frozen = (
    pendingSubmission !== null || submissionReconciliationRequired
  ) && !submitted;
  const progress = useMemo(() => checklistProgress(sections, answers), [answers, sections]);
  // N6: while this screen shows its own session notice, the layout's banner waits: one notice on the screen.
  useScreenSessionNotice(
    state === 'session-ended' ||
    (state === 'ready' && snapshot !== null && currentSection !== undefined && sessionEnd !== null && !submitted),
  );

  /** The answers on screen, as the draft of the account the screen loaded it for (N5); null before that. */
  const currentDraft = useCallback((): PendingDraftSave | null => {
    const accountId = draftOwnerRef.current;
    if (!snapshot || !accountId) return null;
    return {
      operationId: snapshot.operationId,
      accountId,
      draft: {
        schemaVersion: DRAFT_SCHEMA_VERSION,
        checklistId: snapshot.checklist.id,
        answers: answersRef.current,
      },
    };
  }, [snapshot]);

  const updateAnswer = useCallback((item: RampChecklistItem, answer: RampChecklistDraftAnswer) => {
    if (
      submitInFlightRef.current ||
      !snapshot ||
      !draftOwnerRef.current ||
      frozen ||
      heldForSignIn ||
      submitted ||
      submitting
    ) {
      return;
    }
    setNotice(null);
    const next = {
      ...answersRef.current,
      [item.id]: answer,
    };
    answersRef.current = next;
    setAnswers(next);
    const draft = currentDraft();
    if (draft) queueDraftSave(draft);
  }, [currentDraft, frozen, heldForSignIn, queueDraftSave, snapshot, submitted, submitting]);

  /** REINTENTAR GUARDADO (N6): one more save of the answers on screen for each tap; nothing retries on its own. */
  const retryDraftSave = useCallback(() => {
    const draft = currentDraft();
    if (!draft) return;
    pendingDraftSaveRef.current = draft;
    flushDraftSave();
  }, [currentDraft, flushDraftSave]);

  const showSection = useCallback((index: number) => {
    setSectionIndex(index);
    setValidationRequested(false);
    setNotice(null);
    setTimeout(() => contentScrollRef.current?.scrollTo({ y: 260, animated: false }), 0);
  }, []);

  const goNext = useCallback(() => {
    if (!currentSection || !snapshot) return;
    if (!sectionIsComplete(currentSection, answersRef.current)) {
      setValidationRequested(true);
      setNotice({
        tone: 'warning',
        title: 'Sección incompleta',
        message: 'Responde los controles obligatorios y agrega las notas requeridas antes de continuar.',
      });
      return;
    }
    const nextIndex = Math.min(sectionIndex + 1, snapshot.checklist.sections.length - 1);
    setHighestUnlockedSection((current) => Math.max(current, nextIndex));
    showSection(nextIndex);
  }, [currentSection, sectionIndex, showSection, snapshot]);

  const submit = useCallback(async () => {
    if (
      submitInFlightRef.current ||
      !snapshot ||
      submitted ||
      submissionReconciliationRequired ||
      snapshot.checklist.sections.length === 0
    ) {
      return;
    }
    const currentAnswers = answersRef.current;
    const firstInvalid = firstIncompleteSection(
      snapshot.checklist.sections,
      currentAnswers,
      true,
    );
    if (!pendingSubmission && firstInvalid < snapshot.checklist.sections.length) {
      setSectionIndex(firstInvalid);
      setHighestUnlockedSection((current) => Math.max(current, firstInvalid));
      setValidationRequested(true);
      setNotice({
        tone: 'warning',
        title: 'Checklist incompleto',
        message: 'Completa los controles obligatorios antes de enviar.',
      });
      setTimeout(() => contentScrollRef.current?.scrollTo({ y: 260, animated: false }), 0);
      return;
    }

    const requestBody = pendingSubmission?.request ?? buildSubmissionRequest(snapshot, currentAnswers);
    if (!requestBody) return;
    submitRequestRef.current?.abort();
    const request = new AbortController();
    submitRequestRef.current = request;
    submitInFlightRef.current = true;
    setSubmitting(true);
    setNotice(null);

    try {
      // N6: the answers on screen are saved once more and the decision waits for that save, so a save that failed
      // before is tried again instead of only being reported again.
      if (!pendingSubmission) {
        const draft = currentDraft();
        if (draft) pendingDraftSaveRef.current = draft;
      }
      flushDraftSave();
      await draftWriteQueueRef.current;
      if (request.signal.aborted) return;
      // Without a session the queue takes nothing (D-N5): the answers wait on the tablet and the session notice says
      // so. If the device could not save them, its notice offers REINTENTAR GUARDADO.
      if (sessionEndRef.current) return;
      if (draftWriteFailedRef.current && !pendingSubmission) return;
      const outcome = await submitRampOperationChecklist(
        snapshot.operationId,
        requestBody,
        { signal: request.signal },
      );
      if (request.signal.aborted) return;
      if (outcome.state === 'queued') {
        // 3-I: saved on the device with the answers frozen; the queue sends it after the operation's earlier commands.
        setPendingSubmission(await readRampChecklistPendingSubmission(snapshot.operationId, snapshot.checklist.id));
        setNotice(outcome.issue && (outcome.issue.code === 'device_revoked' || outcome.issue.code === 'device_in_use' ||
          outcome.issue.code === 'device_conflict')
          ? { tone: 'error', title: 'Dispositivo no autorizado', message: outcome.issue.message }
          : {
              tone: 'warning',
              title: 'Checklist guardado en el dispositivo',
              message: 'Se envía a ELEVANT en cuanto haya señal. No necesitas volver a tocar ENVIAR.',
            });
        return;
      }
      const response = outcome.response;
      setSnapshot((current) => current
        ? {
            ...current,
            checklist: {
              ...current.checklist,
              status: response.checklist.status,
              startedAt: response.checklist.startedAt,
              submittedAt: response.checklist.submittedAt,
            },
          }
        : current);
      setPendingSubmission(null);
      setSubmissionReconciliationRequired(false);
      setDraftSaveState('idle');
      setNotice({
        tone: 'success',
        title: 'Checklist enviado',
        message: `ELEVANT confirmó ${response.checklist.answerCount} respuestas. La operación continúa abierta.`,
      });
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof MobileServiceError) {
        // N6 (D-N6): the screen stays; it says the session ended and offers ENTRAR DE NUEVO. The answers wait on the
        // tablet for the account, and the submission the queue already holds goes out once the agent signs in, so
        // they are not changed here meanwhile.
        if (error.code === 'unauthenticated' || error.code === 'session_expired' || error.code === 'forbidden') {
          endSession(error.code === 'forbidden' ? 'revoked' : 'ended');
          setHeldForSignIn(true);
          return;
        }
        let reservedPending: RampChecklistPendingSubmission | null = null;
        let pendingReadFailed = false;
        try {
          reservedPending = await readRampChecklistPendingSubmission(
            snapshot.operationId,
            snapshot.checklist.id,
          );
          setPendingSubmission(reservedPending);
          setSubmissionReconciliationRequired(false);
        } catch {
          pendingReadFailed = true;
          setSubmissionReconciliationRequired(true);
          setDraftSaveState('error');
        }
        if (pendingReadFailed) {
          setNotice({
            tone: 'error',
            title: 'Estado local por conciliar',
            message: 'No pudimos verificar el comando reservado. La edición seguirá bloqueada hasta actualizar el estado canónico y el almacenamiento del dispositivo.',
          });
          return;
        }
        if (error.code === 'cancelled') {
          setNotice({
            tone: 'warning',
            title: 'Envío interrumpido',
            message: 'Volvemos a leer el checklist antes de seguir; tus respuestas siguen en esta tablet.',
          });
          await load(true);
          return;
        }
        if (error.code === 'network_unavailable' || error.code === 'request_timeout') {
          setNotice({
            tone: 'warning',
            title: 'Envío pendiente de confirmación',
            message: error.code === 'request_timeout'
              ? 'ELEVANT tardó demasiado en responder. No cambies las respuestas: al reintentar se envía el mismo checklist, sin duplicarlo.'
              : 'Se perdió la conexión antes de que ELEVANT confirmara el envío. Al reintentar se envía el mismo checklist, sin duplicarlo.',
          });
          return;
        }
        if (error.code === 'not_found' || error.code === 'conflict') {
          setNotice({
            tone: 'warning',
            title: error.code === 'not_found' ? 'Checklist no disponible' : 'El checklist cambió',
            message: error.problemCode
              ? `${error.message} Consultaremos nuevamente el estado canónico antes de permitir otra acción.`
              : 'Consultaremos nuevamente el estado canónico antes de permitir otra acción.',
          });
          await load(true);
          return;
        }
        if (error.code === 'device_conflict' || error.code === 'device_in_use' || error.code === 'device_revoked') {
          setNotice({
            tone: 'error',
            title: 'Dispositivo no autorizado',
            message: error.code === 'device_revoked'
              ? 'OCC revocó esta tablet. Entrégala a OCC y continúa en otra tablet.'
              : error.code === 'device_in_use'
                ? 'Otro agente tiene esta tablet en una operación en curso. Solicita a OCC que la libere.'
                : 'Cierra sesión y solicita a AVIAM revisar el vínculo de esta instalación antes de reintentar.',
          });
          return;
        }
        if (reservedPending) {
          setNotice({
            tone: 'warning',
            title: 'Respuesta no confirmada',
            message: 'El envío quedó guardado en esta tablet. No cambies las respuestas: el próximo intento envía exactamente el mismo checklist.',
          });
          return;
        }
      }
      setNotice({
        tone: 'error',
        title: 'No pudimos enviar el checklist',
        message: 'Revisa los datos y vuelve a intentarlo. La operación no fue finalizada.',
      });
    } finally {
      if (submitRequestRef.current === request) {
        submitRequestRef.current = null;
        submitInFlightRef.current = false;
        if (!request.signal.aborted) setSubmitting(false);
      }
    }
  }, [
    currentDraft,
    endSession,
    flushDraftSave,
    load,
    pendingSubmission,
    snapshot,
    submissionReconciliationRequired,
    submitted,
  ]);

  if (state !== 'ready' || !snapshot || !currentSection) {
    return (
      <ChecklistStateScreen
        onRetry={() => void load()}
        revoked={sessionEnd === 'revoked'}
        state={state}
      />
    );
  }

  const draftNotSaved = draftSaveState === 'error' || draftSaveState === 'not-kept';

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.safe}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          ref={contentScrollRef}
          showsVerticalScrollIndicator={false}
        >
          <Card style={styles.summaryCard}>
            <View style={styles.summaryTop}>
              <View style={styles.summaryCopy}>
                <Text style={styles.eyebrow}>CONTROL OPERACIONAL</Text>
                <Text accessibilityRole="header" style={styles.title}>
                  {snapshot.checklist.template.name}
                </Text>
                <Text style={styles.templateMeta}>
                  {snapshot.checklist.template.code} · versión {snapshot.checklist.template.version}
                </Text>
              </View>
              <StatusPill
                text={submitted
                  ? 'Enviado'
                  : sessionEnd
                    ? 'Sesión terminada'
                    : submissionReconciliationRequired
                      ? 'Estado por conciliar'
                      : frozen
                        ? 'En el dispositivo'
                        : 'Borrador'}
                tone={submitted ? 'green' : sessionEnd ? 'red' : frozen ? 'orange' : 'blue'}
              />
            </View>
            <View style={styles.progressRow}>
              <View
                accessibilityLabel={`${progress.answered} de ${progress.total} controles respondidos`}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: progress.total, now: progress.answered }}
                style={styles.progressTrack}
              >
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progress.percent}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>{progress.answered}/{progress.total}</Text>
            </View>
            <View style={styles.saveRow}>
              <Ionicons
                name={draftNotSaved ? 'alert-circle-outline' : 'cloud-done-outline'}
                size={17}
                color={draftNotSaved ? colors.danger : colors.muted}
              />
              <Text style={[styles.saveText, draftNotSaved && styles.saveTextError]}>
                {draftSaveLabel(
                  draftSaveState,
                  frozen,
                  submitted,
                  submissionReconciliationRequired,
                )}
              </Text>
            </View>
          </Card>

          {snapshot.fromCache && !submitted && (
            <NoticeCard
              notice={{
                tone: 'warning',
                title: 'Sin señal · copia guardada en el dispositivo',
                message: 'Puedes responder y enviar el checklist: el envío queda en el dispositivo y sale a ELEVANT al reconectar.',
              }}
            />
          )}

          {frozen && (
            <NoticeCard
              notice={{
                tone: submissionReconciliationRequired ? 'error' : 'warning',
                title: submissionReconciliationRequired
                  ? 'Edición bloqueada hasta conciliar el estado'
                  : 'Envío guardado en el dispositivo',
                message: submissionReconciliationRequired
                  ? 'Actualiza para verificar el estado canónico y si existe un comando reservado antes de continuar.'
                  : 'Se envía a ELEVANT en cuanto haya señal, con estas mismas respuestas y la misma clave. Para enviarlo ahora toca REINTENTAR ENVÍO.',
              }}
            />
          )}

          <ScrollView
            accessibilityLabel="Secciones del checklist"
            contentContainerStyle={styles.sectionTabs}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {sections.map((section, index) => {
              const selected = index === sectionIndex;
              const disabled = index > highestUnlockedSection && !submitted;
              const complete = sectionIsComplete(section, answers);
              return (
                <Pressable
                  accessibilityLabel={`Sección ${index + 1}: ${section.name}${complete ? ', completa' : ''}`}
                  accessibilityRole="tab"
                  accessibilityState={{ disabled, selected }}
                  disabled={disabled}
                  key={`${section.name}-${index}`}
                  onPress={() => showSection(index)}
                  style={({ pressed }) => [
                    styles.sectionTab,
                    selected && styles.sectionTabSelected,
                    complete && !selected && styles.sectionTabComplete,
                    disabled && styles.sectionTabDisabled,
                    pressed && !disabled && styles.pressed,
                  ]}
                >
                  <Text style={[styles.sectionTabIndex, selected && styles.sectionTabTextSelected]}>
                    {index + 1}
                  </Text>
                  <Text numberOfLines={2} style={[styles.sectionTabText, selected && styles.sectionTabTextSelected]}>
                    {section.name}
                  </Text>
                  {complete && <Ionicons name="checkmark-circle" size={17} color={selected ? colors.white : colors.success} />}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.sectionHeading}>
            <Text style={styles.sectionEyebrow}>SECCIÓN {sectionIndex + 1} DE {sections.length}</Text>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{currentSection.name}</Text>
            <Text style={styles.sectionHint}>Selecciona OK, N/A o NO para cada control obligatorio.</Text>
          </View>

          <View style={styles.items}>
            {currentSection.items.map((item, index) => {
              const answer = answers[item.id];
              const invalid = validationRequested && itemIsIncomplete(item, answer);
              return (
                <ChecklistItemCard
                  answer={answer}
                  disabled={frozen || heldForSignIn || submitted || submitting}
                  index={index}
                  invalid={invalid}
                  item={item}
                  key={item.id}
                  onChange={(next) => updateAnswer(item, next)}
                />
              );
            })}
          </View>

          {sessionEnd && !submitted && (
            <SessionEndedNotice
              message={sessionEndedMessage(sessionEnd, draftNotSaved)}
              revoked={sessionEnd === 'revoked'}
            />
          )}

          {draftProblem && (
            <View style={styles.draftProblem}>
              <NoticeCard notice={draftProblemNotice(draftProblem)} />
              <PrimaryButton
                disabled={draftSaveState === 'saving'}
                icon="save-outline"
                onPress={retryDraftSave}
                secondary
                title="REINTENTAR GUARDADO"
              />
            </View>
          )}

          {notice && <NoticeCard notice={notice} />}

          <View style={styles.navigationRow}>
            {sectionIndex > 0 && (
              <View style={styles.navigationButton}>
                <PrimaryButton
                  icon="arrow-back"
                  onPress={() => showSection(Math.max(0, sectionIndex - 1))}
                  secondary
                  title="ANTERIOR"
                />
              </View>
            )}
            {sectionIndex < sections.length - 1 ? (
              <View style={styles.navigationButton}>
                <PrimaryButton
                  disabled={frozen || submitted}
                  icon="arrow-forward"
                  onPress={goNext}
                  title="SIGUIENTE"
                />
              </View>
            ) : !submitted ? (
              <View style={styles.navigationButton}>
                <PrimaryButton
                  // N6: without a session nothing can be sent; ENTRAR DE NUEVO in the session notice is the way on.
                  disabled={submitting || sessionEnd !== null}
                  icon={submissionReconciliationRequired ? 'refresh' : 'cloud-upload-outline'}
                  onPress={() => submissionReconciliationRequired
                    ? void load(true)
                    : void submit()}
                  title={submitting
                    ? 'ENVIANDO…'
                    : submissionReconciliationRequired
                      ? 'CONCILIAR ESTADO'
                      : frozen
                        ? 'REINTENTAR ENVÍO'
                        : 'ENVIAR CHECKLIST'}
                />
              </View>
            ) : (
              <View style={styles.navigationButton}>
                <PrimaryButton
                  icon="arrow-back"
                  onPress={() => router.back()}
                  secondary
                  title="VOLVER AL DETALLE"
                />
              </View>
            )}
          </View>

          {!submitted && (
            <View style={styles.scopeNotice}>
              <Ionicons name="information-circle-outline" size={20} color={colors.navy} />
              <Text style={styles.scopeNoticeText}>
                Enviar este checklist no finaliza la operación ni la remite a revisión de OCC.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ChecklistItemCard({
  answer,
  disabled,
  index,
  invalid,
  item,
  onChange,
}: {
  readonly answer: RampChecklistDraftAnswer | undefined;
  readonly disabled: boolean;
  readonly index: number;
  readonly invalid: boolean;
  readonly item: RampChecklistItem;
  readonly onChange: (answer: RampChecklistDraftAnswer) => void;
}) {
  const noteRequired = answer?.value === 'NotOk' && item.requiresNoteWhenNotOk;
  return (
    <Card style={[styles.itemCard, invalid && styles.itemCardInvalid]}>
      <View style={styles.itemHeading}>
        <View style={styles.itemNumber}><Text style={styles.itemNumberText}>{index + 1}</Text></View>
        <View style={styles.itemCopy}>
          <Text style={styles.itemCode}>{item.code}</Text>
          <Text style={styles.itemLabel}>{item.label}</Text>
          <Text style={styles.requiredLabel}>{item.isRequired ? 'Obligatorio' : 'Opcional'}</Text>
        </View>
      </View>
      <View accessibilityRole="radiogroup" style={styles.answerRow}>
        <AnswerChoice
          checked={answer?.value === 'Ok'}
          context={item.label}
          disabled={disabled}
          icon="checkmark"
          label="OK"
          onPress={() => onChange({ value: 'Ok' })}
          tone="success"
        />
        <AnswerChoice
          checked={answer?.value === 'NotApplicable'}
          context={item.label}
          disabled={disabled}
          icon="remove"
          label="N/A"
          onPress={() => onChange({ value: 'NotApplicable' })}
          tone="neutral"
        />
        <AnswerChoice
          checked={answer?.value === 'NotOk'}
          context={item.label}
          disabled={disabled}
          icon="close"
          label="NO"
          onPress={() => onChange({ value: 'NotOk', ...(answer?.note ? { note: answer.note } : {}) })}
          tone="danger"
        />
      </View>
      {answer?.value === 'NotOk' && (
        <View style={styles.noteGroup}>
          <Text style={styles.noteLabel}>
            Observación {item.requiresNoteWhenNotOk ? '(obligatoria)' : '(opcional)'}
          </Text>
          <TextInput
            accessibilityHint={item.requiresNoteWhenNotOk ? 'Describe por qué el control no cumple' : 'Agrega contexto si es necesario'}
            accessibilityLabel={`Observación para ${item.label}`}
            editable={!disabled}
            maxLength={1000}
            multiline
            onChangeText={(note) => onChange({ value: 'NotOk', note })}
            placeholder="Describe la condición encontrada"
            placeholderTextColor="#7C8798"
            style={[styles.noteInput, noteRequired && !answer.note?.trim() && styles.noteInputInvalid]}
            textAlignVertical="top"
            value={answer.note ?? ''}
          />
          {noteRequired && !answer.note?.trim() && (
            <Text accessibilityLiveRegion="polite" style={styles.inlineError}>
              La observación es obligatoria cuando marcas NO.
            </Text>
          )}
        </View>
      )}
      {invalid && !noteRequired && (
        <Text accessibilityLiveRegion="polite" style={styles.inlineError}>
          Selecciona una respuesta para continuar.
        </Text>
      )}
    </Card>
  );
}

function AnswerChoice({
  checked,
  context,
  disabled,
  icon,
  label,
  onPress,
  tone,
}: {
  readonly checked: boolean;
  readonly context: string;
  readonly disabled: boolean;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone: 'success' | 'neutral' | 'danger';
}) {
  const color = tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.navy;
  return (
    <Pressable
      accessibilityLabel={`Marcar ${context} como ${label}`}
      accessibilityRole="radio"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.answerChoice,
        checked && styles.answerChoiceChecked,
        checked && { borderColor: color, backgroundColor: tone === 'success' ? '#E9F7EF' : tone === 'danger' ? '#FDECEC' : colors.paleBlue },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={checked ? color : colors.muted} />
      <Text style={[styles.answerChoiceText, checked && { color }]}>{label}</Text>
    </Pressable>
  );
}

function NoticeCard({ notice }: { readonly notice: Notice }) {
  const color = notice.tone === 'success'
    ? colors.success
    : notice.tone === 'warning'
      ? colors.warning
      : colors.danger;
  return (
    <View
      accessibilityLiveRegion={notice.tone === 'error' ? 'assertive' : 'polite'}
      style={[
        styles.notice,
        notice.tone === 'success' && styles.noticeSuccess,
        notice.tone === 'warning' && styles.noticeWarning,
        notice.tone === 'error' && styles.noticeError,
      ]}
    >
      <Ionicons
        name={notice.tone === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
        size={21}
        color={color}
      />
      <View style={styles.noticeCopy}>
        <Text style={styles.noticeTitle}>{notice.title}</Text>
        <Text style={styles.noticeText}>{notice.message}</Text>
      </View>
    </View>
  );
}

function ChecklistStateScreen({
  onRetry,
  revoked,
  state,
}: {
  readonly onRetry: () => void;
  /** With `state` 'session-ended': the account lost its access to the app. */
  readonly revoked: boolean;
  readonly state: ChecklistScreenState;
}) {
  // N6 (D-N6): the checklist cannot open without a session; the screen says so instead of leaving on its own.
  if (state === 'session-ended') {
    return (
      <View style={styles.stateScreen}>
        <View style={styles.stateNotice}>
          <SessionEndedNotice
            message={revoked
              ? 'Lo que marcaste sigue guardado en esta tablet. Contacta a AVIAM antes de volver a entrar.'
              : 'Lo que marcaste sigue guardado en esta tablet. Entra de nuevo con tu cuenta para abrir el checklist.'}
            revoked={revoked}
          />
        </View>
      </View>
    );
  }
  if (state === 'loading') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.stateScreen}>
        <ActivityIndicator accessibilityLabel="Cargando checklist" color={colors.navy} size="large" />
        <Text accessibilityRole="header" style={styles.stateTitle}>Preparando checklist</Text>
        <Text style={styles.stateMessage}>Consultando la versión autorizada para esta operación.</Text>
      </View>
    );
  }
  const copy: readonly [string, string] = state === 'not-found'
    ? ['Checklist no disponible', 'La operación o su checklist ya no están asignados a tu cuenta.']
    : state === 'offline'
      ? ['Sin conexión segura', 'El catálogo no se guarda como fuente de verdad. Reconecta para cargar el checklist canónico.']
      : state === 'conflict'
        ? ['La operación cambió', 'Vuelve al detalle, actualiza el estado canónico e intenta nuevamente.']
        : ['Checklist no disponible', 'No pudimos consultar el checklist en este momento.'];
  return (
    <View accessibilityLiveRegion="assertive" style={styles.stateScreen}>
      <View style={styles.stateIcon}>
        <Ionicons name={state === 'offline' ? 'cloud-offline-outline' : 'warning-outline'} size={34} color={colors.warning} />
      </View>
      <Text accessibilityRole="header" style={styles.stateTitle}>{copy[0]}</Text>
      <Text style={styles.stateMessage}>{copy[1]}</Text>
      <PrimaryButton icon="refresh" onPress={onRetry} secondary title="REINTENTAR" />
      <PrimaryButton icon="arrow-back" onPress={() => router.back()} secondary title="VOLVER AL DETALLE" />
    </View>
  );
}

function mergeAnswers(
  snapshot: GetRampOperationChecklistResponse,
  draft: RampChecklistDraft | null,
  pending: RampChecklistPendingSubmission | null,
) {
  const knownIds = new Set(
    snapshot.checklist.sections.flatMap((section) => section.items.map((item) => item.id)),
  );
  const result: Record<string, RampChecklistDraftAnswer> = {};
  for (const section of snapshot.checklist.sections) {
    for (const item of section.items) {
      if (item.answer) {
        result[item.id] = {
          value: item.answer.value,
          ...(item.answer.note ? { note: item.answer.note } : {}),
        };
      }
    }
  }
  const source = snapshot.checklist.status === 'Submitted'
    ? undefined
    : pending
      ? Object.fromEntries(pending.request.answers.map((answer) => [answer.itemId, answer]))
      : draft?.answers;
  if (source) {
    for (const [itemId, answer] of Object.entries(source)) {
      if (!knownIds.has(itemId)) continue;
      result[itemId] = {
        value: answer.value,
        ...(answer.note !== undefined ? { note: answer.note } : {}),
      };
    }
  }
  return result;
}

function itemIsIncomplete(
  item: RampChecklistItem,
  answer: RampChecklistDraftAnswer | undefined,
) {
  if (item.isRequired && !answer) return true;
  return Boolean(
    answer?.value === 'NotOk' &&
    item.requiresNoteWhenNotOk &&
    !answer.note?.trim(),
  );
}

function sectionIsComplete(
  section: RampChecklistSection,
  answers: Readonly<Record<string, RampChecklistDraftAnswer>>,
) {
  return section.items.every((item) => !itemIsIncomplete(item, answers[item.id]));
}

function firstIncompleteSection(
  sections: readonly RampChecklistSection[],
  answers: Readonly<Record<string, RampChecklistDraftAnswer>>,
  allowPastEnd = false,
) {
  const index = sections.findIndex((section) => !sectionIsComplete(section, answers));
  if (index >= 0) return index;
  return allowPastEnd ? sections.length : Math.max(0, sections.length - 1);
}

function checklistProgress(
  sections: readonly RampChecklistSection[],
  answers: Readonly<Record<string, RampChecklistDraftAnswer>>,
) {
  const items = sections.flatMap((section) => section.items);
  const answered = items.filter((item) => answers[item.id] !== undefined).length;
  return {
    answered,
    total: items.length,
    percent: items.length === 0 ? 0 : Math.round((answered / items.length) * 100),
  };
}

function buildSubmissionRequest(
  snapshot: GetRampOperationChecklistResponse,
  answers: Readonly<Record<string, RampChecklistDraftAnswer>>,
): SubmitRampOperationChecklistRequest | null {
  const orderedItems = snapshot.checklist.sections.flatMap((section) => section.items);
  const requestAnswers = orderedItems.flatMap((item) => {
    const answer = answers[item.id];
    if (!answer) return [];
    const note = answer.note?.trim();
    return [{
      itemId: item.id,
      value: answer.value,
      ...(note ? { note } : {}),
    }];
  });
  return requestAnswers.length > 0
    ? { checklistId: snapshot.checklist.id, answers: requestAnswers }
    : null;
}

function draftSaveLabel(
  state: DraftSaveState,
  frozen: boolean,
  submitted: boolean,
  reconciliationRequired: boolean,
) {
  if (submitted) return 'Envío confirmado por ELEVANT';
  if (reconciliationRequired) return 'Comando local pendiente de verificación';
  if (frozen) return 'Envío guardado en el dispositivo; sale a ELEVANT al reconectar';
  if (state === 'saving') return 'Guardando borrador en este dispositivo…';
  if (state === 'saved') return 'Borrador guardado en este dispositivo';
  if (state === 'error') return 'No se pudo guardar el borrador en este dispositivo';
  if (state === 'not-kept') return 'Sin sesión: las últimas respuestas no se guardaron';
  return 'Las respuestas se guardarán en este dispositivo';
}

/**
 * What the session notice says about the answers (N6): kept on the tablet for the account (N5), or the last ones no
 * longer kept; and what the agent does next.
 */
function sessionEndedMessage(end: SessionEnd, answersNotSaved: boolean) {
  const answers = answersNotSaved
    ? 'Las últimas respuestas no se pudieron guardar en esta tablet.'
    : 'Tus respuestas quedaron guardadas en esta tablet.';
  return end === 'revoked'
    ? `${answers} Contacta a AVIAM antes de volver a entrar.`
    : `${answers} Entra de nuevo con tu cuenta para enviar el checklist.`;
}

/**
 * The device could not save the draft (N6): REINTENTAR GUARDADO tries once per tap, and when it fails again the agent
 * is told the way out instead of the same notice.
 */
function draftProblemNotice(problem: DraftProblem): Notice {
  return problem === 'failed'
    ? {
        tone: 'error',
        title: 'No se guardaron tus respuestas',
        message: 'La tablet no pudo guardar lo último que marcaste. Toca REINTENTAR GUARDADO.',
      }
    : {
        tone: 'error',
        title: 'Tus respuestas siguen sin guardarse',
        message: 'Cierra la app, ábrela de nuevo y avisa a OCC. Lo que no se guardó habrá que marcarlo otra vez.',
      };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 16, paddingBottom: 40, gap: 14 },
  summaryCard: { padding: 18, gap: 15 },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  summaryCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 21, fontWeight: '900', marginTop: 4 },
  templateMeta: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 4 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressTrack: { flex: 1, height: 10, overflow: 'hidden', borderRadius: 5, backgroundColor: colors.border },
  progressFill: { height: '100%', borderRadius: 5, backgroundColor: colors.orange },
  progressText: { minWidth: 42, color: colors.navy, fontSize: 13, fontWeight: '900', textAlign: 'right', fontVariant: ['tabular-nums'] },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  saveText: { flex: 1, color: colors.muted, fontSize: 12, fontWeight: '700' },
  saveTextError: { color: colors.danger },
  sectionTabs: { gap: 8, paddingRight: 16 },
  sectionTab: {
    minHeight: 52,
    maxWidth: 190,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sectionTabSelected: { borderColor: colors.navy, backgroundColor: colors.navy },
  sectionTabComplete: { borderColor: '#B9DFC9', backgroundColor: '#F2FAF5' },
  sectionTabDisabled: { opacity: 0.42 },
  sectionTabIndex: { color: colors.navy, fontSize: 13, fontWeight: '900' },
  sectionTabText: { flexShrink: 1, color: colors.ink, fontSize: 12, fontWeight: '800' },
  sectionTabTextSelected: { color: colors.white },
  sectionHeading: { gap: 3, marginTop: 2 },
  sectionEyebrow: { color: colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  sectionHint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  items: { gap: 12 },
  itemCard: { gap: 14 },
  itemCardInvalid: { borderColor: '#E4A4A4' },
  itemHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  itemNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleBlue },
  itemNumberText: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  itemCopy: { flex: 1, minWidth: 0 },
  itemCode: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
  itemLabel: { color: colors.ink, fontSize: 15, fontWeight: '800', lineHeight: 21, marginTop: 3 },
  requiredLabel: { color: colors.muted, fontSize: 11, marginTop: 4 },
  answerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  answerChoice: {
    minWidth: 84,
    minHeight: 50,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  answerChoiceChecked: { borderWidth: 2 },
  answerChoiceText: { color: colors.muted, fontSize: 13, fontWeight: '900' },
  noteGroup: { gap: 6 },
  noteLabel: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  noteInput: {
    minHeight: 96,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    backgroundColor: colors.white,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 21,
  },
  noteInputInvalid: { borderColor: colors.danger },
  inlineError: { color: colors.danger, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  notice: { padding: 13, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  noticeSuccess: { borderColor: '#B9DFC9', backgroundColor: '#E9F7EF' },
  noticeWarning: { borderColor: '#F0C474', backgroundColor: '#FFF8EA' },
  noticeError: { borderColor: '#F1BBBB', backgroundColor: '#FDECEC' },
  noticeCopy: { flex: 1, minWidth: 0 },
  noticeTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  noticeText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 2 },
  draftProblem: { gap: 10 },
  navigationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  navigationButton: { flexGrow: 1, minWidth: 150 },
  scopeNotice: { padding: 13, borderRadius: 14, backgroundColor: colors.paleBlue, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  scopeNoticeText: { flex: 1, color: colors.navy, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
  stateScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 13, backgroundColor: colors.background },
  stateIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8EA' },
  stateNotice: { width: '100%', maxWidth: 480 },
  stateTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  stateMessage: { maxWidth: 380, color: colors.muted, lineHeight: 20, textAlign: 'center' },
});
