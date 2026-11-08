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
import { resetToLogin } from '../utils/session-navigation';
import { Card, PrimaryButton } from './ui';

type Form = { start: string; end: string; note: string };
const emptyForm: Form = { start: '', end: '', note: '' };

function localValue(instant: string | null | undefined) {
  if (!instant) return '';
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  const two = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function offsetInstant(value: string): string | null | undefined {
  if (!value.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (date.getFullYear() !== Number(year) || date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day) || date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute)) return undefined;
  return date.toISOString();
}

function formFrom(contribution: AttendanceDraftContributionResponse | null): Form {
  return contribution ? {
    start: localValue(contribution.observedStartAt),
    end: localValue(contribution.observedEndAt),
    note: contribution.incidentNote ?? '',
  } : emptyForm;
}

function formFromRequest(request: SaveAttendanceDraftRequest): Form {
  return {
    start: localValue(request.observedStartAt),
    end: localValue(request.observedEndAt),
    note: request.incidentNote ?? '',
  };
}

function displayInstant(instant: string | null | undefined) {
  return instant ? localValue(instant) : 'Sin registrar';
}

export function AttendanceDraftCard({ operationId, assignmentId, active = true }: {
  readonly operationId: string;
  readonly assignmentId: string;
  readonly active?: boolean;
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
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'zona del dispositivo';

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
      if (!dirtyRef.current && !pendingRef.current) setForm(formFrom(canonical.rampAgent));
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
  }, [active, assignmentId, identity, operationId, invalidateView]);

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
      if (value) { setForm(formFromRequest(value.request)); dirtyRef.current = true; }
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
        const start = offsetInstant(form.start);
        const end = offsetInstant(form.end);
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
        setForm(formFrom(snapshot.rampAgent));
        dirtyRef.current = false;
      }
      setNotice(keepAttempt ? 'Revisión actual seleccionada. Confirma tu observación para guardarla.' :
        'Tu intento se descartó; se muestra la versión actual.');
    } catch {
      failPendingStore();
    } finally { if (identityRef.current === identity) setBusy(false); }
  };

  return <Card style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Asistencia observada</Text>
    <Text style={styles.description}>
      Registro de observación manual; no es un fichaje biométrico. Las horas se editan en {timezone}, zona de este dispositivo.
    </Text>
    {status === 'loading' && <Text accessibilityLiveRegion="polite">Cargando observaciones…</Text>}
    {status === 'error' && <Text accessibilityLiveRegion="polite">Observaciones no disponibles.</Text>}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    <PrimaryButton title="Actualizar observaciones" onPress={() => void reload()} secondary />
    {snapshot && <View style={styles.lanes}>
      <View style={styles.lane}>
        <Text style={styles.laneTitle}>Aporte de OCC</Text>
        <Text>Inicio: {displayInstant(snapshot.occ?.observedStartAt)}</Text>
        <Text>Fin: {displayInstant(snapshot.occ?.observedEndAt)}</Text>
        <Text>{snapshot.occ?.incidentNote || 'Sin nota de OCC'}</Text>
        <Text>Guardado: {displayInstant(snapshot.occ?.recordedAt)}</Text>
        <Text>Revisión {snapshot.occ?.revision ?? 0}</Text>
      </View>
      <View style={styles.lane}>
        <Text style={styles.laneTitle}>Tu observación</Text>
        {conflict && <View accessibilityRole="alert" style={styles.conflict}>
          <Text>Conflicto con la revisión actual del agente.</Text>
          {!conflictReady && <Text>Actualiza la versión guardada antes de decidir.</Text>}
          {conflictReady && <>
            <Text>Inicio guardado: {displayInstant(snapshot.rampAgent?.observedStartAt)}</Text>
            <Text>Fin guardado: {displayInstant(snapshot.rampAgent?.observedEndAt)}</Text>
            <Text>Versión actual: {snapshot.rampAgent?.incidentNote ?? 'Sin nota'}</Text>
            <Text>Guardado: {displayInstant(snapshot.rampAgent?.recordedAt)}</Text>
          </>}
          <Text>Inicio de tu intento: {form.start || 'Sin registrar'}</Text>
          <Text>Fin de tu intento: {form.end || 'Sin registrar'}</Text>
          <Text>Tu intento: {form.note || 'Sin nota'}</Text>
        </View>}
        {pending && !conflict && <Text style={styles.pending}>Pendiente de confirmar</Text>}
        <Text>Inicio observado · {timezone}</Text>
        <TextInput accessibilityLabel="Inicio observado" editable={!busy && !pending && !conflict}
          onChangeText={value => change('start', value)} placeholder="AAAA-MM-DD HH:mm"
          style={styles.input} value={form.start} />
        <PrimaryButton title="Registrar inicio ahora" disabled={busy || !!pending || conflict}
          onPress={() => change('start', localValue(serverNow().toISOString()))} secondary />
        <Text>Fin observado · {timezone}</Text>
        <TextInput accessibilityLabel="Fin observado" editable={!busy && !pending && !conflict}
          onChangeText={value => change('end', value)} placeholder="AAAA-MM-DD HH:mm"
          style={styles.input} value={form.end} />
        <PrimaryButton title="Registrar fin ahora" disabled={busy || !!pending || conflict}
          onPress={() => change('end', localValue(serverNow().toISOString()))} secondary />
        <Text>Nota del agente</Text>
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
        <Text style={styles.revision}>Revisión guardada {snapshot.rampAgent?.revision ?? 0}</Text>
      </View>
    </View>}
  </Card>;
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  description: { color: colors.muted, lineHeight: 20 },
  lanes: { gap: 14 },
  lane: { gap: 9, padding: 14, borderRadius: 14, backgroundColor: colors.background },
  laneTitle: { color: colors.navy, fontSize: 17, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, backgroundColor: colors.white, color: colors.ink },
  note: { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 },
  notice: { color: colors.navy },
  validation: { color: colors.danger },
  pending: { color: colors.warning, fontWeight: '700' },
  conflict: { gap: 6, padding: 12, borderWidth: 1, borderColor: colors.warning,
    backgroundColor: colors.paleOrange, borderRadius: 10 },
  revision: { color: colors.muted, fontSize: 12 },
  actions: { gap: 8 },
});
