import {
  FLIGHT_REPORT_MILESTONES,
  FLIGHT_REPORT_PHASES,
  IATA_DELAY_CODES,
  type FlightReportPhase,
  type RampAssignedOperationResponse,
} from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { serviceOrderHasSignature } from '../../features/assigned-operations/handoff';
import {
  PUSHBACK_MILESTONE,
  pushbackConcerns,
  pushbackEffect,
  type PushbackConcern,
} from '../../features/assigned-operations/pushback';
import {
  recordMilestone,
  saveFlightData,
  subscribeFlightReport,
  type FlightReportSnapshot,
} from '../../services/flight-report';
import { aircraftTypeLabel, getRampAircraftTypes, type RampAircraftTypeCatalog } from '../../services/aircraft-types';
import { MobileServiceError } from '../../services/mobile-service-error';
import { loadRampIncidentCenter, reserveRampIncident } from '../../services/ramp-incidents';
import { pendingFor } from '../../synchronization/flight-report-outbox';
import { EVIDENCE_CLOCK_TOLERANCE_MS, serverNow } from '../../synchronization/server-clock';
import { colors } from '../../theme/colors';
import { radius, space, syncTone, touch, type } from '../../theme/tokens';
import { formatStationDate, formatStationTime } from '../../utils/date-format';
import {
  FLIGHT_DATA_FIELDS,
  FLIGHT_DATA_LABELS,
  FLIGHT_DATA_PLACEHOLDERS,
  missingFlightData,
  missingFlightDataLine,
  refusedFlightDataSummary,
  validateFlightDataDraft,
  type FlightDataDraft,
  type FlightDataField,
  type FlightDataValues,
} from '../../utils/flight-data';
import { PrimaryButton } from '../ui';
import { PushbackSheet } from './pushback-sheet';

type Operation = RampAssignedOperationResponse;
type Tone = keyof typeof syncTone;

function useFlightReport() {
  const [snapshot, setSnapshot] = useState<FlightReportSnapshot | null>(null);
  useEffect(() => subscribeFlightReport(setSnapshot), []);
  return snapshot;
}

/**
 * When the operation's evidence window opens, as ELEVANT measures it (3-N25): its start or the recorded arrival,
 * whichever came first, minus the clock tolerance. Null before the operation started.
 */
export function evidenceWindowOpens(operation: Operation): Date | null {
  const times = [operation.operation.actualStartAt, operation.turnaround.arrival?.actualAt]
    .map(value => (typeof value === 'string' ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
  return times.length === 0 ? null : new Date(Math.min(...times) - EVIDENCE_CLOCK_TOLERANCE_MS);
}

/** A milestone time inside the window the tablet knows: not before it opens, never after now by ELEVANT's clock. */
export function clampMilestoneTime(value: Date, opensAt: Date | null, now: Date) {
  if (value.getTime() > now.getTime()) return now;
  if (opensAt && value.getTime() < opensAt.getTime()) return opensAt;
  return value;
}

/** Whole-minute steps of the adjustment; an hour at a time reaches a correction days later (3-N09). */
const SHIFTS = [-60, -10, -5, -1, 1, 5, 60] as const;

/** N2: the push-back sheet names the phase the push-back belongs to, as its tab does. */
const PUSHBACK_PHASE_LABEL = FLIGHT_REPORT_PHASES.find(phase => phase.id === 'pushback')?.label ?? 'Retroempuje';

/**
 * N13 (D-N13): the milestones keep the form's words, from the shared catalog; the tablet says what «JB» is in the phase
 * that shows it.
 */
const JET_BRIDGE_HELP = 'JB: pasarela de abordaje (jet bridge).';
const mentionsJetBridge = (label: string) => /\bJB\b/.test(label);

function haptic() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** What a time or the flight data needs said when the tablet could not keep it (N6). */
type LocalSaveCopy = Readonly<{ sessionEnded: string; storage: string; other: string }>;

const MILESTONE_NOT_SAVED: LocalSaveCopy = {
  sessionEnded: 'Tu sesión terminó y la hora no se guardó. Entra de nuevo con tu cuenta para registrarla.',
  storage: 'La tablet no pudo guardar la hora. Vuelve a intentarlo; si sigue fallando, cierra la app, ábrela de nuevo y avisa a OCC.',
  other: 'No se pudo guardar la hora. Vuelve a intentarlo.',
};

const FLIGHT_DATA_NOT_SAVED: LocalSaveCopy = {
  sessionEnded: 'Tu sesión terminó y los datos del vuelo no se guardaron. Entra de nuevo con tu cuenta para guardarlos.',
  storage: 'La tablet no pudo guardar los datos del vuelo. Vuelve a intentarlo; si sigue fallando, cierra la app, ábrela de nuevo y avisa a OCC.',
  other: 'No se pudieron guardar los datos del vuelo. Vuelve a intentarlo.',
};

/**
 * Why the tablet could not keep a time or the flight data (N6): the session ended (the queue takes nothing without one,
 * D-N5) or the device's storage failed. Neither is blamed on the other, and «unlock the device» is never the advice.
 */
function localSaveError(error: unknown, copy: LocalSaveCopy) {
  if (!(error instanceof MobileServiceError)) return copy.other;
  if (error.code === 'session_expired' || error.code === 'unauthenticated') return copy.sessionEnded;
  return error.code === 'storage_unavailable' ? copy.storage : copy.other;
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

/**
 * Adjust a time with whole minutes: the agent tapped late, or corrects from the radio log. The time stays inside the
 * operation's window (3-N25), never after now by ELEVANT's clock (3-N18); in a correction round there is no «AHORA»:
 * the facts of the flight happened before the first hand-off (3-N09), where ELEVANT closes the milestones' window.
 */
function TimeSheet({ label, initial, opensAt, correction, timeZone, onClose, onSave }: {
  label: string; initial: Date; opensAt: Date | null; correction: boolean; timeZone: string;
  onClose: () => void; onSave: (value: Date) => void;
}) {
  const [value, setValue] = useState(() => clampMilestoneTime(initial, opensAt, serverNow()));
  const shift = (minutes: number) => setValue(current =>
    clampMilestoneTime(new Date(current.getTime() + minutes * 60_000), opensAt, serverNow()));
  const until = correction ? 'hasta tu primera entrega a OCC' : 'hasta ahora';
  return (
    <Modal animationType="slide" transparent visible onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.sheetTitle}>{label}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.sheetTime}>{formatStationTime(value, timeZone)}</Text>
          <Text style={styles.sheetDay}>{formatStationDate(value, timeZone)}</Text>
          <Text style={styles.hint}>
            {opensAt
              ? `Hora válida desde ${formatStationDate(opensAt, timeZone)} ${formatStationTime(opensAt, timeZone)} ${until} ` +
                '(hora de la estación).'
              : `Hora válida ${until} (hora de la estación).`}
          </Text>
          <View style={styles.shiftRow}>
            {SHIFTS.map(minutes => (
              <Pressable key={minutes} accessibilityRole="button" accessibilityLabel={`${minutes > 0 ? 'Más' : 'Menos'} ${Math.abs(minutes)} minutos`}
                onPress={() => shift(minutes)} style={styles.shiftButton}>
                <Text style={styles.shiftText}>{minutes > 0 ? `+${minutes}` : minutes}</Text>
              </Pressable>
            ))}
          </View>
          {!correction && (
            <PrimaryButton icon="time-outline" secondary title="AHORA" onPress={() => setValue(serverNow())} />
          )}
          <PrimaryButton icon="checkmark" title="GUARDAR HORA" onPress={() => onSave(value)} />
          <PrimaryButton secondary title="CANCELAR" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function MilestoneButton({ label, state, timeZone, disabled, correction, onNow, onEdit }: {
  label: string; state: { at?: string; tone: Tone; error?: string }; timeZone: string; disabled: boolean;
  correction: boolean; onNow: () => void; onEdit: () => void;
}) {
  const tone = syncTone[state.tone];
  const recorded = Boolean(state.at);
  return (
    <Pressable accessibilityRole="button" disabled={disabled}
      accessibilityLabel={recorded ? `${label}, ${formatStationTime(state.at, timeZone)}, ${tone.label}. Toca para ajustar.`
        : correction ? `${label}. Toca para registrar su hora.` : `${label}. Toca para registrar ahora.`}
      onPress={recorded ? onEdit : onNow}
      style={({ pressed }) => [styles.milestone, { borderColor: recorded ? tone.fg : colors.border, backgroundColor: tone.bg },
        disabled && styles.disabled, pressed && styles.pressed]}>
      <Text numberOfLines={2} style={styles.milestoneLabel}>{label}</Text>
      {recorded ? (
        <View style={styles.milestoneFooter}>
          <Text style={[styles.milestoneTime, { color: tone.fg }]}>{formatStationTime(state.at, timeZone)}</Text>
          <Ionicons accessibilityLabel={tone.label} name={tone.icon} size={18} color={tone.fg} />
        </View>
      ) : correction ? (
        <View style={styles.nowChip}><Ionicons name="time-outline" size={16} color={colors.white} /><Text style={styles.nowText}>REGISTRAR HORA</Text></View>
      ) : (
        <View style={styles.nowChip}><Ionicons name="finger-print" size={16} color={colors.white} /><Text style={styles.nowText}>AHORA</Text></View>
      )}
    </Pressable>
  );
}

/**
 * «Hitos del vuelo», the milestones of AVIAM's «Reporte de Vuelo» by phase (ADR-0031): Llegada → En posición → Salida →
 * Retroempuje. The panel has a name of its own (N13, D-N13): «Reporte de Vuelo» is the AVIAM form signed in «Formularios
 * y firmas», and the checklist is «Checklist operativo». One tap records the time on the device, with a vibration; the
 * queue sends it when there is signal.
 * In a correction round (OCC returned the operation) the facts of the flight already happened: an empty milestone
 * opens the adjustment at the last recorded time instead of recording «AHORA» (3-N09).
 * The push-back releases the stand in OCC for good (decision 23), so its first tap asks first when the flight is not
 * recorded as it should be (N2, D-N2): a sheet lists the reasons and what recording it does.
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
  // N2: the reasons the push-back sheet lists, as they stood at the tap; null while it is closed.
  const [pushbackAsk, setPushbackAsk] = useState<readonly PushbackConcern[] | null>(null);
  const [error, setError] = useState('');
  const correction = editable && operation.review?.status === 'Returned';
  const opensAt = evidenceWindowOpens(operation);
  /** Where a correction starts from: the last time recorded on the operation, or its start. */
  const lastRecorded = () => {
    const times = [...states.values()].map(state => (state.at ? Date.parse(state.at) : Number.NaN)).filter(Number.isFinite);
    const start = operation.operation.actualStartAt ? Date.parse(operation.operation.actualStartAt) : Number.NaN;
    const latest = times.length > 0 ? Math.max(...times) : start;
    return Number.isFinite(latest) ? new Date(latest) : serverNow();
  };

  const record = (code: string, at: Date) => {
    setError('');
    haptic();
    recordMilestone(operation.operation.id, code, at, timeZone)
      .catch(failure => setError(localSaveError(failure, MILESTONE_NOT_SAVED)));
  };
  /**
   * An empty milestone's tap outside a correction: it records now, except a push-back whose flight is not recorded as
   * it should be, which asks first (N2). A push-back already recorded, or waiting in the queue, opens the adjustment.
   */
  const recordNow = (code: string) => {
    if (code === PUSHBACK_MILESTONE) {
      const id = operation.operation.id;
      const concerns = pushbackConcerns({
        recorded: new Set(FLIGHT_REPORT_MILESTONES.filter(item => states.get(item.code)?.at).map(item => item.code)),
        services: operation.services,
        orderSigned: serviceOrderHasSignature(snapshot?.documents[id] ?? snapshot?.documents[id.toLowerCase()],
          snapshot?.items ?? [], id),
      });
      if (concerns.length > 0) {
        setPushbackAsk(concerns);
        return;
      }
    }
    record(code, serverNow());
  };

  const phaseMilestones = FLIGHT_REPORT_MILESTONES.filter(item => item.phase === phase);

  return (
    <View style={styles.panel} accessibilityLabel="Hitos del vuelo">
      <View style={styles.panelHeader}>
        <Ionicons name="time-outline" size={22} color={colors.navy} />
        <Text style={styles.panelTitle}>Hitos del vuelo</Text>
      </View>
      {!editable && <Text style={styles.hint}>Inicia la operación para registrar los tiempos.</Text>}
      <PhaseBar phase={phase} onChange={setPhase} done={done} />
      <View style={styles.grid}>
        {phaseMilestones.map(item => (
          <MilestoneButton key={item.code} label={item.label} state={states.get(item.code)!} timeZone={timeZone}
            disabled={!editable} correction={correction}
            onNow={() => (correction ? setEditing({ code: item.code, label: item.label, at: lastRecorded() })
              : recordNow(item.code))}
            onEdit={() => setEditing({ code: item.code, label: item.label, at: new Date(states.get(item.code)!.at!) })} />
        ))}
      </View>
      {phaseMilestones.some(item => mentionsJetBridge(item.label)) ? (
        <Text style={styles.hint}>{JET_BRIDGE_HELP}</Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {correction && (
        <Text style={styles.hint}>Corrección: registra cada hora como ocurrió en el vuelo, no la hora actual.</Text>
      )}
      {editing && <TimeSheet label={editing.label} initial={editing.at} opensAt={opensAt} correction={correction}
        timeZone={timeZone} onClose={() => setEditing(null)}
        onSave={value => { record(editing.code, value); setEditing(null); }} />}
      {/* N2: «ahora» is when the agent confirms, by ELEVANT's clock; nothing is recorded while the sheet is open. */}
      {pushbackAsk && editable && !correction ? (
        <PushbackSheet eyebrow={PUSHBACK_PHASE_LABEL} concerns={pushbackAsk}
          effect={pushbackEffect(operation.turnaround.stand?.code)} onClose={() => setPushbackAsk(null)}
          onConfirm={() => { setPushbackAsk(null); record(PUSHBACK_MILESTONE, serverNow()); }} />
      ) : null}
    </View>
  );
}

/** S1: what each field takes; a passenger count fits in 4 characters and the MTOW in 9 («700,000» with room to spare). */
const FIELD_LENGTH: Readonly<Record<FlightDataField, number>> = {
  passengersIn: 4, passengersOut: 4, mtowKg: 9, aircraftRegistration: 10,
};

/** What a screen reader says of a field without an error: its range, as its placeholder shows it. */
const FIELD_HINTS: Readonly<Record<FlightDataField, string>> = {
  passengersIn: `De ${FLIGHT_DATA_PLACEHOLDERS.passengersIn}`,
  passengersOut: `De ${FLIGHT_DATA_PLACEHOLDERS.passengersOut}`,
  mtowKg: `De ${FLIGHT_DATA_PLACEHOLDERS.mtowKg}`,
  aircraftRegistration: 'De 2 a 10 letras, números o guiones',
};

/** The saved flight data as its fields show it. */
const fieldsOf = (saved: FlightDataValues): FlightDataDraft => ({
  passengersIn: saved.passengersIn?.toString() ?? '',
  passengersOut: saved.passengersOut?.toString() ?? '',
  mtowKg: saved.mtowKg?.toString() ?? '',
  aircraftRegistration: saved.aircraftRegistration ?? '',
});

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
 * S1: each field is read exactly (`validateFlightDataDraft`) and says its own error with its range; the first wrong
 * one takes the focus and nothing is saved. A field the agent has not touched shows the saved data, so the queue read
 * after the first render, or a save, shows at once, and what the agent typed is never overwritten. «Faltan…» says what
 * the forms still lack and «Sin guardar» what is not saved yet; the chip keeps saying where the saved data stands.
 */
export function FlightDataCard({ operation, editable }: { operation: Operation; editable: boolean }) {
  const snapshot = useFlightReport();
  const catalog = useAircraftTypeCatalog();
  const confirmed = snapshot?.confirmed[operation.operation.id];
  const pending = pendingFor(snapshot?.items ?? [], operation.operation.id).flightData;
  // ELEVANT's last answer wins over the operation as last read, also when it says that a value was cleared.
  const source: FlightDataValues = pending?.command.kind === 'flightData' ? pending.command : confirmed ? {
    passengersIn: confirmed.passengersIn ?? null,
    passengersOut: confirmed.passengersOut ?? null,
    mtowKg: confirmed.mtowKg ?? null,
    aircraftRegistration: confirmed.aircraftRegistration ?? operation.turnaround.aircraft?.registration ?? null,
  } : {
    passengersIn: operation.operation.passengersIn ?? null,
    passengersOut: operation.operation.passengersOut ?? null,
    mtowKg: operation.operation.mtowKg ?? null,
    aircraftRegistration: operation.turnaround.aircraft?.registration ?? null,
  };
  // What the agent typed, field by field, over the saved data; a field leaves it once a save of its text is accepted.
  const [edits, setEdits] = useState<Partial<Record<FlightDataField, string>>>({});
  const draft: FlightDataDraft = { ...fieldsOf(source), ...(editable ? edits : {}) };
  // Undefined: untouched here, so the type still waiting on the device (or none, which keeps the flight's) applies.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const waitingType = pending?.command.kind === 'flightData' ? pending.command.aircraftTypeId ?? null : null;
  const aircraftTypeId = editable && picked !== undefined ? picked : waitingType;
  const [picking, setPicking] = useState(false);
  // A save refused for its fields: their errors show, and follow what the agent types, until a save is accepted.
  const [checked, setChecked] = useState(false);
  const [saveError, setSaveError] = useState('');
  const inputs = useRef<Partial<Record<FlightDataField, TextInput | null>>>({});
  const { values, errors } = validateFlightDataDraft(draft);
  const refused = refusedFlightDataSummary(checked ? FLIGHT_DATA_FIELDS.filter(field => errors[field]) : []);
  const dirty = editable && (Object.keys(edits).length > 0 || picked !== undefined);
  const missingLine = missingFlightDataLine(missingFlightData(source) ?? []);
  const tone: Tone = pending ? (pending.state === 'blocked' ? 'blocked' : 'device') :
    (source.passengersIn ?? source.passengersOut ?? source.mtowKg) !== null ? 'confirmed' : 'empty';
  const currentType = operation.turnaround.aircraft;
  const chosen = aircraftTypeId ? catalog?.types.find(item => item.id === aircraftTypeId) : undefined;
  const typeText = chosen ? aircraftTypeLabel(chosen)
    : aircraftTypeId ? 'Tipo elegido en este dispositivo'
      : currentType ? aircraftTypeLabel(currentType) : 'Sin tipo de avión registrado';
  const canPick = editable && Boolean(catalog?.available) && (catalog?.types.length ?? 0) > 0;

  const save = () => {
    setSaveError('');
    const wrong = FLIGHT_DATA_FIELDS.filter(field => errors[field]);
    if (wrong.length > 0) {
      setChecked(true);
      inputs.current[wrong[0]]?.focus();
      return;
    }
    setChecked(false);
    haptic();
    const sent = draft;
    const sentType = picked;
    saveFlightData(operation.operation.id, { ...values, ...(aircraftTypeId ? { aircraftTypeId } : {}) })
      .then(() => {
        // Accepted: the fields show the saved data again, except one the agent typed again meanwhile.
        setEdits(current => Object.fromEntries(Object.entries(current)
          .filter(([key, text]) => text !== sent[key as FlightDataField])));
        setPicked(current => (current === sentType ? undefined : current));
      })
      .catch(failure => setSaveError(localSaveError(failure, FLIGHT_DATA_NOT_SAVED)));
  };
  const field = (key: FlightDataField) => {
    const label = FLIGHT_DATA_LABELS[key];
    const error = checked ? errors[key] : undefined;
    const next: FlightDataField | undefined = FLIGHT_DATA_FIELDS[FLIGHT_DATA_FIELDS.indexOf(key) + 1];
    return (
      <View key={key} style={[styles.field, key === 'mtowKg' && styles.fieldWide]}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput ref={input => { inputs.current[key] = input; }} accessibilityLabel={label}
          accessibilityHint={error ?? FIELD_HINTS[key]} editable={editable}
          keyboardType={key === 'aircraftRegistration' ? 'default' : 'number-pad'} autoCapitalize="characters"
          autoCorrect={false} maxLength={FIELD_LENGTH[key]} placeholder={FLIGHT_DATA_PLACEHOLDERS[key]}
          placeholderTextColor={colors.muted} returnKeyType={next ? 'next' : 'done'}
          submitBehavior={next ? 'submit' : 'blurAndSubmit'} onSubmitEditing={() => { if (next) inputs.current[next]?.focus(); }}
          value={draft[key]} style={[styles.input, error ? styles.inputInvalid : null]}
          onChangeText={text => setEdits(current => ({ ...current, [key]: text }))} />
        {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      </View>
    );
  };
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
      {/* S1 (D-S1): what the forms still lack; it warns, the Order can be signed and handed off without it. */}
      {missingLine ? (
        <View style={styles.dataNote}>
          <Ionicons name="warning-outline" size={18} color={colors.warning} />
          <Text style={styles.dataMissingText}>{missingLine}</Text>
        </View>
      ) : null}
      <View style={styles.fields}>
        {FLIGHT_DATA_FIELDS.map(key => field(key))}
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
      {dirty ? (
        <View style={styles.dataNote}>
          <Ionicons name="create-outline" size={18} color={colors.navy} />
          <Text style={styles.unsavedText}>Sin guardar</Text>
        </View>
      ) : null}
      {refused ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{refused}</Text> : null}
      {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
      <PrimaryButton disabled={!editable} icon="save-outline" title="GUARDAR DATOS DEL VUELO" onPress={save} />
      <Modal animationType="slide" visible={picking} onRequestClose={() => setPicking(false)}>
        <View style={styles.deviationScreen}>
          <Text style={styles.sheetTitle}>¿Qué avión está en la posición?</Text>
          <FlatList data={catalog?.types ?? []} keyExtractor={item => item.id} style={styles.codeList}
            renderItem={({ item }) => {
              const selected = (aircraftTypeId ?? currentType?.id) === item.id;
              return (
                <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={aircraftTypeLabel(item)}
                  onPress={() => { setPicked(item.id === currentType?.id ? null : item.id); setPicking(false); setSaveError(''); }}
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
        occurredAt: new Date(Math.floor(serverNow().getTime() / 1000) * 1000).toISOString(), delayCode: code });
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
  // N11: the day as the formatter writes it, «sáb, 7 nov», without forced capitals.
  sheetDay: { ...type.label, color: colors.muted, textAlign: 'center' },
  shiftRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
  shiftButton: { minWidth: touch.min, minHeight: touch.min, borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  shiftText: { ...type.label, color: colors.navy },
  syncChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 4 },
  syncText: { fontSize: 12, fontWeight: '800' },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  field: { flexGrow: 1, flexBasis: 140, gap: 4 },
  // S1: room for its placeholder, «1,000 a 700,000 kg», at the input's 18 pt.
  fieldWide: { flexBasis: 200 },
  fieldLabel: { ...type.caption, color: colors.muted },
  input: { minHeight: touch.min, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md, fontSize: 18, fontWeight: '700', color: colors.ink, backgroundColor: colors.white },
  // S1: a wrong field has a red edge and its message under it (danger on white is 5.3:1).
  inputInvalid: { borderColor: colors.danger, borderWidth: 2 },
  fieldError: { ...type.body, fontSize: 14, fontWeight: '700', color: colors.danger },
  dataNote: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Warning on white is 6.6:1.
  dataMissingText: { ...type.body, color: colors.warning, flex: 1 },
  unsavedText: { ...type.label, color: colors.navy, flex: 1 },
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
