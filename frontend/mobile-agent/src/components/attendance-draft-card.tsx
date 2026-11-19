import type {
  AttendanceDraftContributionResponse,
  AttendanceDraftSnapshotResponse,
  SaveAttendanceDraftRequest,
} from '@elevant/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  clearPendingAttendanceDraft,
  readPendingAttendanceDraft,
  type PendingAttendanceDraft,
} from '../storage/attendance-draft';
import {
  readRampAttendanceDraft,
  saveRampAttendanceDraft,
} from '../services/ramp-attendance-draft';
import { subscribeMobileChanges } from '../services/mobile-change-feed';
import { MobileServiceError } from '../services/mobile-service-error';
import { serverNow } from '../synchronization/server-clock';
import { colors } from '../theme/colors';
import { radius, space, touch, type } from '../theme/tokens';
import {
  formatStationDateTime,
  formatStationTime,
  stationTimeLabel,
  stationWallClock,
  stationWallClockToInstant,
} from '../utils/date-format';
import { resetToLogin } from '../utils/session-navigation';
import { Card, PrimaryButton } from './ui';

type Form = { start: string; end: string; note: string };
const emptyForm: Form = { start: '', end: '', note: '' };

// S6 (D-S6): the fields hold the station's wall clock, «2026-10-05 10:00»; the commands keep UTC instants.
function formFrom(contribution: AttendanceDraftContributionResponse | null, timeZone: string | null): Form {
  return contribution ? {
    start: stationWallClock(contribution.observedStartAt, timeZone),
    end: stationWallClock(contribution.observedEndAt, timeZone),
    note: contribution.incidentNote ?? '',
  } : emptyForm;
}

function formFromRequest(request: SaveAttendanceDraftRequest, timeZone: string | null): Form {
  return {
    start: stationWallClock(request.observedStartAt, timeZone),
    end: stationWallClock(request.observedEndAt, timeZone),
    note: request.incidentNote ?? '',
  };
}

function displayInstant(instant: string | null | undefined, timeZone: string | null) {
  return instant ? formatStationDateTime(instant, timeZone) : 'Sin registrar';
}

/** An attempt beside the saved revision, in the same format; a value that is not a time is shown as written. */
function displayAttempt(value: string, timeZone: string | null) {
  const instant = stationWallClockToInstant(value, timeZone);
  if (instant === null) return 'Sin registrar';
  return instant === undefined ? value : formatStationDateTime(instant, timeZone);
}

/** OCC's lane has something to show: hours or a note (N8). Without either it is one line, not five empty ones. */
function occRecorded(contribution: AttendanceDraftContributionResponse | null) {
  return contribution && (contribution.observedStartAt || contribution.observedEndAt || contribution.incidentNote)
    ? contribution : null;
}

/**
 * One of OCC's hours (N8): «19:48» on the operation's day at the station, «17 nov, 00:30» on another day or when that
 * day is not known, «—» when OCC did not record it.
 */
function occTime(instant: string | null, timeZone: string | null, operationDate: string | null) {
  if (!instant) return '—';
  const day = stationWallClock(instant, timeZone).slice(0, 10);
  return operationDate && day === operationDate
    ? formatStationTime(instant, timeZone) : formatStationDateTime(instant, timeZone);
}

export function AttendanceDraftCard({
  operationId, assignmentId, active = true, timeZone, stationCode, operationDate,
}: {
  readonly operationId: string;
  readonly assignmentId: string;
  readonly active?: boolean;
  /** The station's IANA zone: the times are edited and shown on its clock. Unknown: AVIAM's calendar. */
  readonly timeZone: string | null;
  /** The station's code, for «hora local de PUJ». */
  readonly stationCode: string | null;
  /** The operation's day at the station, «2026-11-16»: OCC's hours on that day show without their date. */
  readonly operationDate: string | null;
}) {
  const identity = `${operationId}:${assignmentId}`;
  const identityRef = useRef(identity);
  const readRef = useRef<AbortController | null>(null);
  const dirtyRef = useRef(false);
  const snapshotRef = useRef<AttendanceDraftSnapshotResponse | null>(null);
  const conflictRef = useRef(false);
  const storageReadyRef = useRef(false);
  const pendingRef = useRef<PendingAttendanceDraft | null>(null);
  const [snapshot, setSnapshot] = useState<AttendanceDraftSnapshotResponse | null>(null);
  const [pending, setPending] = useState<PendingAttendanceDraft | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [storageReady, setStorageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [conflictReady, setConflictReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');
  // S6 (D-S6): «hora local de PUJ», the station's clock, never the device's zone.
  const stationClock = stationTimeLabel(stationCode);

  const updatePending = (value: PendingAttendanceDraft | null) => {
    pendingRef.current = value;
    setPending(value);
  };

  const failPendingStore = () => {
    storageReadyRef.current = false;
    setStorageReady(false);
    setStatus('error');
    setNotice('No se pudo verificar la observación pendiente. No se enviará otro comando.');
  };

  const invalidateView = useCallback((code: MobileServiceError['code']) => {
    snapshotRef.current = null;
    conflictRef.current = false;
    dirtyRef.current = false;
    storageReadyRef.current = false;
    pendingRef.current = null;
    setPending(null);
    setSnapshot(null);
    setForm(emptyForm);
    setConflict(false);
    setConflictReady(false);
    setStorageReady(false);
    setStatus('error');
    setNotice('La sesión o el acceso cambió. Abre de nuevo la operación.');
    if (code === 'unauthenticated' || code === 'session_expired') {
      resetToLogin('session_expired');
    } else if (code === 'forbidden') {
      resetToLogin('access_revoked');
    }
  }, []);

  const reload = useCallback(async () => {
    if (!active || !storageReadyRef.current || identityRef.current !== identity) return;
    readRef.current?.abort();
    const request = new AbortController();
    readRef.current = request;
    try {
      const canonical = await readRampAttendanceDraft(operationId, assignmentId,
        { signal: request.signal });
      if (request.signal.aborted || identityRef.current !== identity) return;
      const previousRevision = snapshotRef.current?.rampAgent?.revision ?? 0;
      const currentRevision = canonical.rampAgent?.revision ?? 0;
      if (snapshotRef.current && dirtyRef.current && !pendingRef.current &&
        previousRevision !== currentRevision && !conflictRef.current) {
        conflictRef.current = true;
        setConflict(true);
        setConflictReady(true);
      } else if (conflictRef.current) {
        setConflictReady(true);
      }
      snapshotRef.current = canonical;
      setSnapshot(canonical);
      setStatus('ready');
      if (!dirtyRef.current && !pendingRef.current) setForm(formFrom(canonical.rampAgent, timeZone));
    } catch (error) {
      if (request.signal.aborted || identityRef.current !== identity) return;
      if (error instanceof MobileServiceError &&
        ['cancelled', 'unauthenticated', 'session_expired', 'forbidden'].includes(error.code)) {
        invalidateView(error.code);
        return;
      }
      setStatus(current => current === 'ready' ? current : 'error');
      setNotice('No se pudo actualizar la observación. Intenta de nuevo al reconectar.');
    }
  }, [active, assignmentId, identity, operationId, invalidateView, timeZone]);

  useEffect(() => {
    identityRef.current = identity;
    readRef.current?.abort();
    dirtyRef.current = false;
    storageReadyRef.current = false;
    pendingRef.current = null;
    snapshotRef.current = null;
    conflictRef.current = false;
    setSnapshot(null);
    setForm(emptyForm);
    setPending(null);
    setConflict(false);
    setConflictReady(false);
    setValidation('');
    setNotice('');
    setStatus('loading');
    setStorageReady(false);
    let cancelled = false;
    void readPendingAttendanceDraft(operationId, assignmentId).then(value => {
      if (cancelled || identityRef.current !== identity) return;
      updatePending(value);
      if (value) { setForm(formFromRequest(value.request, timeZone)); dirtyRef.current = true; }
      storageReadyRef.current = true;
      setStorageReady(true);
    }).catch(() => {
      if (cancelled || identityRef.current !== identity) return;
      setStatus('error');
      setNotice('No se pudo leer la observación pendiente. No se enviará otro comando.');
    });
    return () => { cancelled = true; readRef.current?.abort(); };
    // Reset only when the operation/assignment identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    if (!active || !storageReady) { readRef.current?.abort(); return undefined; }
    void reload();
    const unsubscribe = subscribeMobileChanges(resources => {
      if (resources.includes('attendance_draft')) void reload();
    });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void reload();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void reload();
    }, 25_000);
    return () => { unsubscribe(); appState.remove(); clearInterval(timer); readRef.current?.abort(); };
  }, [active, reload, storageReady]);

  const change = (key: keyof Form, value: string) => {
    dirtyRef.current = true;
    setValidation('');
    setNotice('');
    setForm(current => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (busy || conflict || !storageReadyRef.current || status !== 'ready') return;
    setBusy(true);
    setNotice('');
    const writingIdentity = identity;
    try {
      let request: SaveAttendanceDraftRequest;
      if (pending) {
        let current: PendingAttendanceDraft | null;
        try { current = await readPendingAttendanceDraft(operationId, assignmentId); }
        catch { failPendingStore(); return; }
        if (!current || current.idempotencyKey !== pending.idempotencyKey) {
          updatePending(null);
          dirtyRef.current = false;
          setForm(emptyForm);
          setSnapshot(null);
          setStatus('loading');
          setNotice('El intento pertenece a otra sesión o ya no está pendiente. Actualiza antes de guardar.');
          await reload();
          return;
        }
        request = current.request;
      } else {
        // A time the station's clock skips (a daylight-saving jump) is refused like a malformed one.
        const start = stationWallClockToInstant(form.start, timeZone);
        const end = stationWallClockToInstant(form.end, timeZone);
        const note = form.note.trim();
        if (start === undefined || end === undefined ||
          (start && end && Date.parse(end) < Date.parse(start)) ||
          (!start && !end && !note) || note.length > 2_000) {
          setValidation('Comprueba fecha, hora y nota antes de guardar. Usa AAAA-MM-DD HH:mm.');
          return;
        }
        request = { expectedRevision: snapshot?.rampAgent?.revision ?? 0,
          observedStartAt: start, observedEndAt: end, incidentNote: note || null };
      }
      await saveRampAttendanceDraft(operationId, assignmentId, request);
      if (identityRef.current !== writingIdentity) return;
      updatePending(null);
      dirtyRef.current = false;
      conflictRef.current = false;
      setConflict(false);
      setConflictReady(false);
      setNotice('Guardado y confirmado por ELEVANT.');
      await reload();
    } catch (error) {
      if (identityRef.current !== writingIdentity) return;
      if (error instanceof MobileServiceError &&
        ['cancelled', 'unauthenticated', 'session_expired', 'forbidden'].includes(error.code)) {
        invalidateView(error.code);
        return;
      }
      if (error instanceof MobileServiceError && error.code === 'conflict') {
        conflictRef.current = true;
        setConflict(true);
        setConflictReady(false);
        try { updatePending(await readPendingAttendanceDraft(operationId, assignmentId)); }
        catch { failPendingStore(); return; }
        setNotice('Conflicto: revisa tu observación frente a la versión actual.');
        await reload();
      } else {
        const stored = await readPendingAttendanceDraft(operationId, assignmentId)
          .catch(() => { failPendingStore(); return null; });
        if (!storageReadyRef.current) return;
        updatePending(stored);
        setNotice(stored ? 'Pendiente de confirmar. Reintenta el mismo envío al reconectar.' :
          'No se pudo guardar. Actualiza la operación antes de intentar otra vez.');
      }
    } finally { if (identityRef.current === writingIdentity) setBusy(false); }
  };

  const resolveConflict = async (keepAttempt: boolean) => {
    if (!conflictReady || !snapshot || busy) return;
    setBusy(true);
    try {
      if (pending) {
        const cleared = await clearPendingAttendanceDraft(
          operationId, assignmentId, pending.idempotencyKey);
        if (!cleared || identityRef.current !== identity) return;
        updatePending(null);
      }
      conflictRef.current = false;
      setConflict(false);
      setConflictReady(false);
      if (!keepAttempt) {
        setForm(formFrom(snapshot.rampAgent, timeZone));
        dirtyRef.current = false;
      }
      setNotice(keepAttempt ? 'Revisión actual seleccionada. Confirma tu observación para guardarla.' :
        'Tu intento se descartó; se muestra la versión actual.');
    } catch {
      failPendingStore();
    } finally { if (identityRef.current === identity) setBusy(false); }
  };

  const occ = snapshot ? occRecorded(snapshot.occ) : null;

  // N8 (D-N8): every text takes the app's type and colour tokens; the revision counters stay.
  return <Card style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Asistencia observada</Text>
    <Text style={styles.hint}>
      {`Registro de observación manual; no es un fichaje biométrico. Las horas están en ${stationClock}.`}
    </Text>
    {status === 'loading' &&
      <Text accessibilityLiveRegion="polite" style={styles.hint}>Cargando observaciones…</Text>}
    {status === 'error' &&
      <Text accessibilityLiveRegion="polite" style={styles.hint}>Observaciones no disponibles.</Text>}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    <PrimaryButton title="Actualizar observaciones" onPress={() => void reload()} secondary />
    {snapshot && <View style={styles.lanes}>
      <View style={styles.lane}>
        <Text style={styles.laneTitle}>Aporte de OCC</Text>
        {/* N8: one line while OCC has recorded nothing; otherwise its hours, its note and when it recorded them. */}
        {occ ? <>
          <Text style={styles.hours}>
            {`Inicio ${occTime(occ.observedStartAt, timeZone, operationDate)} · ` +
              `Fin ${occTime(occ.observedEndAt, timeZone, operationDate)}`}
          </Text>
          {occ.incidentNote ? <Text style={styles.body}>{occ.incidentNote}</Text> : null}
          <Text style={styles.caption}>{`Registrado ${displayInstant(occ.recordedAt, timeZone)}`}</Text>
          <Text style={styles.caption}>{`Revisión ${occ.revision}`}</Text>
        </> : <Text style={styles.hint}>OCC aún no registra horas.</Text>}
      </View>
      <View style={styles.lane}>
        <Text style={styles.laneTitle}>Tu observación</Text>
        {conflict && <View accessibilityRole="alert" style={styles.conflict}>
          <Text style={styles.conflictTitle}>Conflicto con la revisión actual del agente.</Text>
          {!conflictReady && <Text style={styles.body}>Actualiza la versión guardada antes de decidir.</Text>}
          {/* S6: both sides in one format, on the station's clock. */}
          {conflictReady && <>
            <Text style={styles.body}>
              Inicio guardado: {displayInstant(snapshot.rampAgent?.observedStartAt, timeZone)}
            </Text>
            <Text style={styles.body}>
              Fin guardado: {displayInstant(snapshot.rampAgent?.observedEndAt, timeZone)}
            </Text>
            <Text style={styles.body}>Versión actual: {snapshot.rampAgent?.incidentNote ?? 'Sin nota'}</Text>
            <Text style={styles.body}>Guardado: {displayInstant(snapshot.rampAgent?.recordedAt, timeZone)}</Text>
          </>}
          <Text style={styles.body}>Inicio de tu intento: {displayAttempt(form.start, timeZone)}</Text>
          <Text style={styles.body}>Fin de tu intento: {displayAttempt(form.end, timeZone)}</Text>
          <Text style={styles.body}>Tu intento: {form.note || 'Sin nota'}</Text>
        </View>}
        {pending && !conflict && <Text style={styles.pending}>Pendiente de confirmar</Text>}
        <Text style={styles.caption}>{`Inicio observado · ${stationClock}`}</Text>
        <TextInput accessibilityLabel="Inicio observado" editable={!busy && !pending && !conflict}
          onChangeText={value => change('start', value)} placeholder="AAAA-MM-DD HH:mm"
          style={styles.input} value={form.start} />
        <PrimaryButton title="Registrar inicio ahora" disabled={busy || !!pending || conflict}
          onPress={() => change('start', stationWallClock(serverNow(), timeZone))} secondary />
        <Text style={styles.caption}>{`Fin observado · ${stationClock}`}</Text>
        <TextInput accessibilityLabel="Fin observado" editable={!busy && !pending && !conflict}
          onChangeText={value => change('end', value)} placeholder="AAAA-MM-DD HH:mm"
          style={styles.input} value={form.end} />
        <PrimaryButton title="Registrar fin ahora" disabled={busy || !!pending || conflict}
          onPress={() => change('end', stationWallClock(serverNow(), timeZone))} secondary />
        <Text style={styles.caption}>Nota del agente</Text>
        <TextInput accessibilityLabel="Nota del agente" editable={!busy && !pending && !conflict}
          maxLength={2_000} multiline onChangeText={value => change('note', value)}
          style={[styles.input, styles.note]} value={form.note} />
        {validation ? <Text accessibilityLiveRegion="polite" style={styles.validation}>{validation}</Text> : null}
        {conflict ? <View style={styles.actions}>
          <PrimaryButton title="Usar revisión actual y conservar mi intento" disabled={busy || !conflictReady}
            onPress={() => void resolveConflict(true)} secondary />
          <PrimaryButton title="Descartar mi intento" disabled={busy || !conflictReady}
            onPress={() => void resolveConflict(false)} secondary />
        </View> : <PrimaryButton title={pending ? 'Reintentar confirmación' : 'Guardar observación'}
          disabled={busy || !storageReady || status !== 'ready'} onPress={() => void save()} />}
        <Text style={styles.caption}>{`Revisión guardada ${snapshot.rampAgent?.revision ?? 0}`}</Text>
      </View>
    </View>}
  </Card>;
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  title: { ...type.title, color: colors.navy },
  hint: { ...type.body, color: colors.muted },
  notice: { ...type.body, color: colors.navy },
  lanes: { gap: 14 },
  lane: { gap: 9, padding: 14, borderRadius: radius.md, backgroundColor: colors.background },
  laneTitle: { ...type.label, color: colors.navy },
  hours: { ...type.label, color: colors.ink, fontVariant: ['tabular-nums'] },
  body: { ...type.body, color: colors.ink },
  // The fields' labels, as in «Datos del vuelo», and the record and revision lines.
  caption: { ...type.caption, color: colors.muted },
  // The fields of «Datos del vuelo» (FlightDataCard): 56 dp, for gloves (ADR-0031), and the same type.
  input: { minHeight: touch.min, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: space.md, fontSize: 18, fontWeight: '700', color: colors.ink, backgroundColor: colors.white },
  note: { minHeight: 88, textAlignVertical: 'top', paddingTop: space.md },
  validation: { ...type.label, color: colors.danger },
  pending: { ...type.label, color: colors.warning },
  conflict: { gap: 6, padding: space.md, borderWidth: 1, borderColor: colors.warning,
    backgroundColor: colors.paleOrange, borderRadius: radius.sm },
  conflictTitle: { ...type.label, color: colors.warning },
  actions: { gap: space.sm },
});
