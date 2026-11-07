import {
  FLIGHT_REPORT_MILESTONES,
  FLIGHT_REPORT_PHASES,
  IATA_DELAY_CODES,
  type FlightReportPhase,
  type RampAssignedOperationResponse,
} from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  recordMilestone,
  saveFlightData,
  subscribeFlightReport,
  type FlightReportSnapshot,
} from '../../services/flight-report';
import { aircraftTypeLabel, getRampAircraftTypes, type RampAircraftTypeCatalog } from '../../services/aircraft-types';
import { loadRampIncidentCenter, reserveRampIncident } from '../../services/ramp-incidents';
import { pendingFor } from '../../synchronization/flight-report-outbox';
import { colors } from '../../theme/colors';
import { radius, space, syncTone, touch, type } from '../../theme/tokens';
import { PrimaryButton } from '../ui';

type Operation = RampAssignedOperationResponse;
type Tone = keyof typeof syncTone;

function useFlightReport() {
  const [snapshot, setSnapshot] = useState<FlightReportSnapshot | null>(null);
  useEffect(() => subscribeFlightReport(setSnapshot), []);
  return snapshot;
}

function timeIn(value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-DO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
    .format(new Date(value));
}

function haptic() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Each milestone's value: confirmed by the server, saved on the device, rejected, or empty. */
function useMilestoneStates(operation: Operation, snapshot: FlightReportSnapshot | null) {
  return useMemo(() => {
    const confirmed = new Map<string, string>();
    for (const item of operation.milestones ?? []) confirmed.set(item.code, item.actualAt);
    for (const item of snapshot?.confirmed[operation.operation.id]?.milestones ?? []) confirmed.set(item.code, item.actualAt);
    const { milestones: pending } = pendingFor(snapshot?.items ?? [], operation.operation.id);
    return new Map(FLIGHT_REPORT_MILESTONES.map(item => {
      const local = pending.get(item.code);
      const at = local?.command.kind === 'milestone' ? local.command.occurredAt : confirmed.get(item.code);
      const tone: Tone = local ? (local.state === 'blocked' ? 'blocked' : 'device') : at ? 'confirmed' : 'empty';
      return [item.code, { at, tone, error: local?.lastError }] as const;
    }));
  }, [operation, snapshot]);
}

/** Phase tabs with progress: what is done and what comes next is always visible. */
function PhaseBar({ phase, onChange, done }: {
  phase: FlightReportPhase; onChange: (phase: FlightReportPhase) => void; done: Record<FlightReportPhase, [number, number]>;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.phaseBar}>
      {FLIGHT_REPORT_PHASES.map((item, index) => {
        const [recorded, total] = done[item.id];
        const active = item.id === phase;
        const complete = recorded === total;
        return (
          <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: active }}
            accessibilityLabel={`${item.label}: ${recorded} de ${total}`} onPress={() => onChange(item.id)}
            style={[styles.phase, active && styles.phaseActive]}>
            <View style={[styles.phaseDot, complete && styles.phaseDotDone, active && !complete && styles.phaseDotActive]}>
              {complete ? <Ionicons name="checkmark" size={14} color={colors.white} />
                : <Text style={[styles.phaseIndex, active && styles.phaseIndexActive]}>{index + 1}</Text>}
            </View>
            <Text numberOfLines={1} style={[styles.phaseLabel, active && styles.phaseLabelActive]}>{item.label}</Text>
            <Text style={styles.phaseCount}>{recorded}/{total}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Adjust a time with whole minutes: the agent tapped late, or corrects from the radio log. */
function TimeSheet({ label, initial, timeZone, onClose, onSave }: {
  label: string; initial: Date; timeZone: string; onClose: () => void; onSave: (value: Date) => void;
}) {
  const [value, setValue] = useState(initial);
  const shift = (minutes: number) => setValue(current => {
    const next = new Date(current.getTime() + minutes * 60_000);
    return next.getTime() > Date.now() ? new Date() : next;
  });
  return (
    <Modal animationType="slide" transparent visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.sheetTitle}>{label}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.sheetTime}>{timeIn(value, timeZone)}</Text>
          <View style={styles.shiftRow}>
            {[-10, -5, -1, 1, 5].map(minutes => (
              <Pressable key={minutes} accessibilityRole="button" accessibilityLabel={`${minutes > 0 ? 'Más' : 'Menos'} ${Math.abs(minutes)} minutos`}
                onPress={() => shift(minutes)} style={styles.shiftButton}>
                <Text style={styles.shiftText}>{minutes > 0 ? `+${minutes}` : minutes}</Text>
              </Pressable>
            ))}
          </View>
          <PrimaryButton icon="time-outline" secondary title="AHORA" onPress={() => setValue(new Date())} />
          <PrimaryButton icon="checkmark" title="GUARDAR HORA" onPress={() => onSave(value)} />
          <PrimaryButton secondary title="CANCELAR" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function MilestoneButton({ label, state, timeZone, disabled, onNow, onEdit }: {
  label: string; state: { at?: string; tone: Tone; error?: string }; timeZone: string; disabled: boolean;
  onNow: () => void; onEdit: () => void;
}) {
  const tone = syncTone[state.tone];
  const recorded = Boolean(state.at);
  return (
    <Pressable accessibilityRole="button" disabled={disabled}
      accessibilityLabel={recorded ? `${label}, ${timeIn(state.at!, timeZone)}, ${tone.label}. Toca para ajustar.` : `${label}. Toca para registrar ahora.`}
      onPress={recorded ? onEdit : onNow}
      style={({ pressed }) => [styles.milestone, { borderColor: recorded ? tone.fg : colors.border, backgroundColor: tone.bg },
        disabled && styles.disabled, pressed && styles.pressed]}>
      <Text numberOfLines={2} style={styles.milestoneLabel}>{label}</Text>
      {recorded ? (
        <View style={styles.milestoneFooter}>
          <Text style={[styles.milestoneTime, { color: tone.fg }]}>{timeIn(state.at!, timeZone)}</Text>
          <Ionicons accessibilityLabel={tone.label} name={tone.icon} size={18} color={tone.fg} />
        </View>
      ) : (
        <View style={styles.nowChip}><Ionicons name="finger-print" size={16} color={colors.white} /><Text style={styles.nowText}>AHORA</Text></View>
      )}
    </Pressable>
  );
}

/**
 * «Reporte de Vuelo» by phase (ADR-0031): Llegada → En posición → Salida → Retroempuje. One tap
 * records the time on the device, with a vibration; the queue sends it when there is signal.
 */
export function FlightReportPanel({ operation, timeZone, editable }: { operation: Operation; timeZone: string; editable: boolean }) {
  const snapshot = useFlightReport();
  const states = useMilestoneStates(operation, snapshot);
  const done = useMemo(() => Object.fromEntries(FLIGHT_REPORT_PHASES.map(phase => {
    const items = FLIGHT_REPORT_MILESTONES.filter(item => item.phase === phase.id);
    return [phase.id, [items.filter(item => states.get(item.code)?.at).length, items.length]];
  })) as Record<FlightReportPhase, [number, number]>, [states]);
  // Open on the first phase that still has something to record.
  const firstOpen = FLIGHT_REPORT_PHASES.find(phase => done[phase.id][0] < done[phase.id][1])?.id ?? 'pushback';
  const [phase, setPhase] = useState<FlightReportPhase>(firstOpen);
  const [editing, setEditing] = useState<{ code: string; label: string; at: Date } | null>(null);
  const [error, setError] = useState('');

  const record = (code: string, at: Date) => {
    setError('');
    haptic();
    recordMilestone(operation.operation.id, code, at).catch(() => setError('No se pudo guardar en el dispositivo. Intenta de nuevo.'));
  };

  return (
    <View style={styles.panel} accessibilityLabel="Reporte de vuelo">
      <View style={styles.panelHeader}>
        <Ionicons name="time-outline" size={22} color={colors.navy} />
        <Text style={styles.panelTitle}>Reporte de vuelo</Text>
      </View>
      {!editable && <Text style={styles.hint}>Inicia la operación para registrar los tiempos.</Text>}
      <PhaseBar phase={phase} onChange={setPhase} done={done} />
      <View style={styles.grid}>
        {FLIGHT_REPORT_MILESTONES.filter(item => item.phase === phase).map(item => (
          <MilestoneButton key={item.code} label={item.label} state={states.get(item.code)!} timeZone={timeZone}
            disabled={!editable}
            onNow={() => record(item.code, new Date())}
            onEdit={() => setEditing({ code: item.code, label: item.label, at: new Date(states.get(item.code)!.at!) })} />
        ))}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {editing && <TimeSheet label={editing.label} initial={editing.at} timeZone={timeZone} onClose={() => setEditing(null)}
        onSave={value => { record(editing.code, value); setEditing(null); }} />}
    </View>
  );
}

const toInt = (text: string) => (text.trim() === '' ? null : Number.parseInt(text.replace(/\D/g, ''), 10));

/** The active aircraft types of ELEVANT; without them (no signal and no copy, an older server) the type is read-only. */
function useAircraftTypeCatalog() {
  const [catalog, setCatalog] = useState<RampAircraftTypeCatalog | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getRampAircraftTypes({ signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setCatalog(value); })
      .catch(() => { if (!controller.signal.aborted) setCatalog({ types: [], available: false, fromCache: false }); });
    return () => controller.abort();
  }, []);
  return catalog;
}

/**
 * Passengers, MTOW, registration and aircraft type, typed once; every AVIAM form takes them from here. The type (3-B)
 * is chosen from ELEVANT's catalog only while the operation runs: the ground-time allowance and the package-exceeded
 * surcharge read it. Leaving it untouched keeps the current one.
 */
export function FlightDataCard({ operation, editable }: { operation: Operation; editable: boolean }) {
  const snapshot = useFlightReport();
  const catalog = useAircraftTypeCatalog();
  const confirmed = snapshot?.confirmed[operation.operation.id];
  const pending = pendingFor(snapshot?.items ?? [], operation.operation.id).flightData;
  const source = pending?.command.kind === 'flightData' ? pending.command : {
    passengersIn: confirmed?.passengersIn ?? operation.operation.passengersIn ?? null,
    passengersOut: confirmed?.passengersOut ?? operation.operation.passengersOut ?? null,
    mtowKg: confirmed?.mtowKg ?? operation.operation.mtowKg ?? null,
    aircraftRegistration: confirmed?.aircraftRegistration ?? operation.turnaround.aircraft?.registration ?? null,
  };
  const [draft, setDraft] = useState({
    passengersIn: source.passengersIn?.toString() ?? '', passengersOut: source.passengersOut?.toString() ?? '',
    mtowKg: source.mtowKg?.toString() ?? '', aircraftRegistration: source.aircraftRegistration ?? '',
  });
  // Undefined: untouched here, so the type still waiting on the device (or none, which keeps the flight's) applies.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const waitingType = pending?.command.kind === 'flightData' ? pending.command.aircraftTypeId ?? null : null;
  const aircraftTypeId = picked !== undefined ? picked : waitingType;
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const tone: Tone = pending ? (pending.state === 'blocked' ? 'blocked' : 'device') :
    (source.passengersIn ?? source.passengersOut ?? source.mtowKg) !== null ? 'confirmed' : 'empty';
  const currentType = operation.turnaround.aircraft;
  const chosen = aircraftTypeId ? catalog?.types.find(item => item.id === aircraftTypeId) : undefined;
  const typeText = chosen ? aircraftTypeLabel(chosen)
    : aircraftTypeId ? 'Tipo elegido en este dispositivo'
      : currentType ? aircraftTypeLabel(currentType) : 'Sin tipo de avión registrado';
  const canPick = editable && Boolean(catalog?.available) && (catalog?.types.length ?? 0) > 0;

  const save = () => {
    const values = { passengersIn: toInt(draft.passengersIn), passengersOut: toInt(draft.passengersOut), mtowKg: toInt(draft.mtowKg),
      aircraftRegistration: draft.aircraftRegistration.trim().toUpperCase() || null,
      ...(aircraftTypeId ? { aircraftTypeId } : {}) };
    if ([values.passengersIn, values.passengersOut].some(value => value !== null && (value < 0 || value > 999)) ||
        (values.mtowKg !== null && (values.mtowKg < 1000 || values.mtowKg > 700000)) ||
        (values.aircraftRegistration && !/^[A-Z0-9-]{2,10}$/.test(values.aircraftRegistration))) {
      setError('Revisa los datos: pasajeros de 0 a 999, MTOW en kg y matrícula como HI1055.');
      return;
    }
    setError('');
    haptic();
    saveFlightData(operation.operation.id, values).catch(() => setError('No se pudo guardar en el dispositivo.'));
  };
  const field = (key: keyof typeof draft, label: string, numeric = true) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput accessibilityLabel={label} editable={editable} keyboardType={numeric ? 'number-pad' : 'default'}
        autoCapitalize="characters" maxLength={numeric ? 6 : 10} value={draft[key]} style={styles.input}
        onChangeText={text => setDraft(value => ({ ...value, [key]: text }))} />
    </View>
  );
  return (
    <View style={styles.panel} accessibilityLabel="Datos del vuelo">
      <View style={styles.panelHeader}>
        <Ionicons name="airplane-outline" size={22} color={colors.navy} />
        <Text style={styles.panelTitle}>Datos del vuelo</Text>
        <View style={[styles.syncChip, { backgroundColor: syncTone[tone].bg }]}>
          <Ionicons name={syncTone[tone].icon} size={14} color={syncTone[tone].fg} />
          <Text style={[styles.syncText, { color: syncTone[tone].fg }]}>{syncTone[tone].label}</Text>
        </View>
      </View>
      <Text style={styles.hint}>Se escriben una vez: la Orden de Servicio y el Reporte de Vuelo los toman de aquí.</Text>
      <View style={styles.fields}>
        {field('passengersIn', 'Pasajeros que llegan')}
        {field('passengersOut', 'Pasajeros que salen')}
        {field('mtowKg', 'MTOW (kg)')}
        {field('aircraftRegistration', 'Matrícula', false)}
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Tipo de avión</Text>
        {canPick ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Tipo de avión: ${typeText}`} onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.input, styles.typeField, pressed && styles.pressed]}>
            <Text style={styles.typeText}>{typeText}</Text>
            <Ionicons name="chevron-down" size={18} color={colors.navy} />
          </Pressable>
        ) : (
          <Text accessibilityLabel={`Tipo de avión: ${typeText}`} style={[styles.input, styles.typeText, styles.typeReadOnly]}>{typeText}</Text>
        )}
        {catalog?.fromCache ? <Text style={styles.hint}>Lista de tipos guardada en el dispositivo (sin conexión).</Text> : null}
        {catalog && !catalog.available && editable
          ? <Text style={styles.hint}>Sin la lista de tipos de ELEVANT el tipo no se puede cambiar desde la tablet.</Text> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <PrimaryButton disabled={!editable} icon="save-outline" title="GUARDAR DATOS DEL VUELO" onPress={save} />
      <Modal animationType="slide" visible={picking} onRequestClose={() => setPicking(false)}>
        <View style={styles.deviationScreen}>
          <Text style={styles.sheetTitle}>¿Qué avión está en la posición?</Text>
          <FlatList data={catalog?.types ?? []} keyExtractor={item => item.id} style={styles.codeList}
            renderItem={({ item }) => {
              const selected = (aircraftTypeId ?? currentType?.id) === item.id;
              return (
                <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={aircraftTypeLabel(item)}
                  onPress={() => { setPicked(item.id === currentType?.id ? null : item.id); setPicking(false); setError(''); }}
                  style={[styles.code, selected && styles.codeSelected]}>
                  <Text style={[styles.codeNumber, selected && styles.codeSelectedText]}>{item.icaoCode}</Text>
                  <Text style={[styles.codeLabel, selected && styles.codeSelectedText]}>{item.manufacturer} {item.model}</Text>
                </Pressable>
              );
            }} />
          <PrimaryButton secondary title="CERRAR" onPress={() => setPicking(false)} />
        </View>
      </Modal>
    </View>
  );
}

/**
 * «Desviación»: any departure from the normal process goes to OCC live with its IATA delay
 * code (ADR-0031); the radio is congested. Queued like every incident if there is no signal.
 */
export function DeviationAction({ operationId, editable }: { operationId: string; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'sent' | 'error'>('idle');
  const submit = async () => {
    if (!code || note.trim().length < 8) return;
    setStatus('saving');
    try {
      await reserveRampIncident(operationId, { incidentType: 'Deviation', severity: 'Medium', description: note.trim(),
        occurredAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(), delayCode: code });
      haptic();
      setOpen(false); setCode(null); setNote('');
      setStatus('saved');
      // Saved on the device first; try to send now and tell the agent what actually happened.
      const center = await loadRampIncidentCenter(operationId).catch(() => null);
      if (center && center.sent > 0 && !center.outbox.some(item => item.state === 'pending')) setStatus('sent');
    } catch {
      setStatus('error');
    }
  };
  return (
    <>
      <Pressable accessibilityRole="button" disabled={!editable} onPress={() => { setStatus('idle'); setOpen(true); }}
        style={({ pressed }) => [styles.deviation, !editable && styles.disabled, pressed && styles.pressed]}>
        <Ionicons name="warning" size={24} color={colors.white} />
        <View style={styles.deviationCopy}>
          <Text style={styles.deviationTitle}>Reportar desviación</Text>
          <Text style={styles.deviationText}>Llega a OCC como alerta, con su código IATA de demora.</Text>
        </View>
      </Pressable>
      {status === 'saved' && <Text accessibilityLiveRegion="polite" style={styles.saved}>Desviación guardada en el dispositivo; se envía a OCC en cuanto haya señal.</Text>}
      {status === 'sent' && <Text accessibilityLiveRegion="polite" style={styles.saved}>Desviación enviada a OCC como alerta.</Text>}
      <Modal animationType="slide" visible={open} onRequestClose={() => setOpen(false)}>
        <View style={styles.deviationScreen}>
          <Text style={styles.sheetTitle}>¿Qué causó la desviación?</Text>
          <FlatList data={IATA_DELAY_CODES} keyExtractor={item => item.code} style={styles.codeList}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: code === item.code }} onPress={() => setCode(item.code)}
                style={[styles.code, code === item.code && styles.codeSelected]}>
                <Text style={[styles.codeNumber, code === item.code && styles.codeSelectedText]}>{item.code}</Text>
                <Text style={[styles.codeLabel, code === item.code && styles.codeSelectedText]}>{item.label}</Text>
              </Pressable>
            )} />
          <TextInput accessibilityLabel="Qué pasó" multiline maxLength={2000} placeholder="Qué pasó (mínimo 8 caracteres)"
            value={note} onChangeText={setNote} style={[styles.input, styles.note]} />
          {status === 'error' && <Text accessibilityRole="alert" style={styles.error}>No se pudo guardar la desviación. Intenta de nuevo.</Text>}
          <PrimaryButton danger disabled={!code || note.trim().length < 8 || status === 'saving'} icon="send"
            title={status === 'saving' ? 'GUARDANDO…' : 'ENVIAR A OCC'} onPress={() => void submit()} />
          <PrimaryButton secondary title="CANCELAR" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.md },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  panelTitle: { ...type.title, color: colors.navy, flex: 1 },
  hint: { ...type.body, color: colors.muted },
  phaseBar: { flexDirection: 'row', gap: space.sm },
  phase: { flex: 1, minHeight: touch.min, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.sm, alignItems: 'center', gap: 2 },
  phaseActive: { borderColor: colors.navy, backgroundColor: colors.paleBlue },
  phaseDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.border },
  phaseDotActive: { backgroundColor: colors.navy },
  phaseDotDone: { backgroundColor: colors.success },
  phaseIndex: { ...type.caption, color: colors.ink },
  phaseIndexActive: { color: colors.white },
  phaseLabel: { ...type.caption, color: colors.muted },
  phaseLabelActive: { color: colors.navy },
  phaseCount: { fontSize: 11, color: colors.muted, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  milestone: { flexGrow: 1, flexBasis: 150, minHeight: touch.large + 8, borderRadius: radius.md, borderWidth: 2, padding: space.md, justifyContent: 'space-between', gap: space.sm },
  milestoneLabel: { ...type.label, color: colors.ink },
  milestoneFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  milestoneTime: { ...type.time },
  nowChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.orange, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  nowText: { color: colors.white, fontWeight: '900', letterSpacing: 0.6 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  error: { color: colors.danger, fontWeight: '700' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(8,28,58,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.xl, gap: space.md },
  sheetTitle: { ...type.title, color: colors.navy },
  sheetTime: { fontSize: 48, fontWeight: '900', color: colors.ink, textAlign: 'center', fontVariant: ['tabular-nums'] },
  shiftRow: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  shiftButton: { minWidth: touch.min, minHeight: touch.min, borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  shiftText: { ...type.label, color: colors.navy },
  syncChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 4 },
  syncText: { fontSize: 12, fontWeight: '800' },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  field: { flexGrow: 1, flexBasis: 140, gap: 4 },
  fieldLabel: { ...type.caption, color: colors.muted },
  input: { minHeight: touch.min, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md, fontSize: 18, fontWeight: '700', color: colors.ink, backgroundColor: colors.white },
  deviation: { minHeight: touch.large, flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, padding: space.lg, backgroundColor: colors.danger },
  deviationCopy: { flex: 1 },
  deviationTitle: { ...type.title, color: colors.white },
  deviationText: { color: '#FDECEC', fontWeight: '600' },
  saved: { color: colors.success, fontWeight: '700' },
  deviationScreen: { flex: 1, padding: space.xl, gap: space.md, backgroundColor: colors.background },
  codeList: { flex: 1 },
  code: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, marginBottom: space.sm },
  codeSelected: { backgroundColor: colors.navy, borderColor: colors.navy },
  codeNumber: { ...type.time, color: colors.navy, width: 44 },
  codeLabel: { ...type.body, color: colors.ink, flex: 1 },
  codeSelectedText: { color: colors.white },
  note: { minHeight: 96, textAlignVertical: 'top', paddingTop: space.md },
  typeField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeText: { fontSize: 16, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  typeReadOnly: { textAlignVertical: 'center', paddingTop: space.sm, backgroundColor: colors.background },
});
