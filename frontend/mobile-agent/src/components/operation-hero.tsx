import type { RampAssignedOperationResponse } from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ChecklistStanding, HandoffRequirement } from '../features/assigned-operations/handoff';
import {
  aircraftTypeLabel,
  flightPhase,
  formatCount,
  formatDuration,
  groundTimeMinutes,
  milestoneProgress,
  nextEvent,
  serviceProgress,
} from '../features/assigned-operations/flight-status';
import {
  assignmentPositionLabel,
  assignmentRoleLabel,
  formatOperationDate,
  operationFlightLabel,
  operationStatusLabel,
  operationStatusTone,
} from '../features/assigned-operations/presentation';
import { colors, toneColors, type Tone } from '../theme/colors';
import { elevation, radius, space } from '../theme/tokens';
import { standDisplayCode } from '../utils/stand-codes';
import { AirlineBadge, LegTimes, PhaseStrip, RouteLine } from './flight-board';
import { Fact, ProgressBar, StatusPill, type IconName } from './ui';

const CHECKLIST_READING: Readonly<Record<ChecklistStanding, Readonly<{ text: string; tone: Tone }> | null>> = {
  submitted: { text: 'Enviado', tone: 'success' },
  queued: { text: 'En el dispositivo', tone: 'warning' },
  'not-submitted': { text: 'Sin enviar', tone: 'info' },
  unknown: null,
};

/**
 * The operation's hero (CN-22): the flight board on navy, the first thing the agent reads. The flight and its airline,
 * the route, each leg's times with the delay, the phase strip, the stand, aircraft, ground time, countdown, passengers
 * and MTOW, and below them how far the operation is: services, milestones, checklist, Service Order and the agent's
 * role. `connection` is the always-visible sync state, which lives here instead of floating alone.
 */
export const OperationHero = memo(function OperationHero({
  operation, now, checklist, requirements, connection, started,
}: {
  /** ELEVANT's view with what still waits on the device applied (3-I). */
  operation: RampAssignedOperationResponse;
  now: number;
  checklist: ChecklistStanding;
  requirements: readonly HandoffRequirement[];
  connection?: ReactNode;
  /** The operation has started: its progress shows. */
  started: boolean;
}) {
  const { turnaround, assignment } = operation;
  const timeZone = turnaround.station.ianaTimeZone;
  const phase = flightPhase(operation);
  const next = nextEvent(operation, now);
  const ground = groundTimeMinutes(turnaround);
  const aircraft = aircraftTypeLabel(turnaround.aircraft);
  const services = serviceProgress(operation.services);
  const milestones = milestoneProgress(operation.milestones);
  const { passengersIn, passengersOut, mtowKg } = operation.operation;
  const hasPassengers = typeof passengersIn === 'number' || typeof passengersOut === 'number';
  const stand = turnaround.stand ? standDisplayCode(turnaround.stand.code) : null;
  const order = requirements.find(item => item.kind === 'serviceOrder');
  const checklistReading = CHECKLIST_READING[checklist];
  const role = assignmentRoleLabel(assignment.assignmentRole);
  const position = assignmentPositionLabel(assignment.position);

  return (
    <View style={styles.hero}>
      <View style={styles.board}>
        <View style={styles.top}>
          <AirlineBadge airline={turnaround.airline} size={58} />
          <View style={styles.title}>
            <Text accessibilityRole="header" style={styles.flight}>{operationFlightLabel(operation)}</Text>
            <Text numberOfLines={1} style={styles.airline}>{turnaround.airline.name}</Text>
            <Text numberOfLines={1} style={styles.code}>
              {`Operación ${turnaround.operationCode} · ${formatOperationDate(turnaround.operationDate)}`}
            </Text>
          </View>
          <View style={styles.topRight}>
            <StatusPill large text={operationStatusLabel(operation.operation.status)}
              tone={operationStatusTone(operation.operation.status)} />
            {connection}
          </View>
        </View>

        <RouteLine large onDark operation={operation} />

        {(turnaround.arrival || turnaround.departure) ? (
          <View style={styles.legs}>
            {turnaround.arrival && <LegTimes kind="arrival" leg={turnaround.arrival} onDark timeZone={timeZone} />}
            {turnaround.arrival && turnaround.departure && <View style={styles.legDivider} />}
            {turnaround.departure && <LegTimes kind="departure" leg={turnaround.departure} onDark timeZone={timeZone} />}
          </View>
        ) : (
          <View style={styles.legs}>
            <Ionicons name="time-outline" size={18} color={colors.orangeOnNavy} />
            <Text style={styles.pendingText}>OCC aún no asocia una llegada o una salida.</Text>
          </View>
        )}

        <PhaseStrip onDark phase={phase} />

        <View style={styles.facts}>
          <HeroFact icon="location" label="Stand"
            value={stand ?? 'Por confirmar'}
            detail={turnaround.stand?.terminal ? `Terminal ${turnaround.stand.terminal.code}` : turnaround.station.code} />
          <HeroFact icon="airplane" label="Aeronave" value={aircraft ?? 'Por confirmar'}
            detail={turnaround.aircraft?.registration ? `Matrícula ${turnaround.aircraft.registration}` : null} />
          <HeroFact icon="hourglass-outline" label="Tiempo en tierra"
            value={ground !== null ? formatDuration(ground) : '—'} />
          <HeroFact icon={next?.icon ?? 'checkmark-done-outline'} label="Próximo movimiento"
            value={next?.text ?? (phase === 'departed' ? 'Vuelo despachado' : '—')}
            tone={next?.tone === 'danger' ? 'danger' : undefined} />
          <HeroFact icon="people-outline" label="Pasajeros (llegan / salen)"
            value={hasPassengers ? `${formatCount(passengersIn)} / ${formatCount(passengersOut)}` : 'Sin registrar'} />
          <HeroFact icon="barbell-outline" label="MTOW"
            value={typeof mtowKg === 'number' ? `${formatCount(mtowKg)} kg` : 'Sin registrar'} />
        </View>
      </View>

      <View style={styles.status}>
        <Progress icon="construct-outline" label="Servicios" done={services.done} total={services.total}
          show={started} />
        <Progress icon="flag-outline" label="Hitos del reporte" done={milestones.done} total={milestones.total}
          show={started} tone="brand" />
        <Badge icon="clipboard-outline" label="Checklist"
          reading={started ? checklistReading : null} />
        <Badge icon="create-outline" label="Orden de Servicio"
          reading={!started || !order ? null : order.state === 'ok'
            ? { text: 'Firmada', tone: 'success' }
            : order.state === 'missing' ? { text: 'Por firmar', tone: 'warning' } : null} />
        <Badge icon="person-outline" label="Tu rol"
          reading={{ text: [role, position].filter(Boolean).join(' · ') || 'Asignado', tone: 'neutral' }} />
      </View>
    </View>
  );
});

function HeroFact(props: { icon: IconName; label: string; value: string; detail?: string | null; tone?: Tone }) {
  return (
    <View style={styles.factCell}>
      <Fact onDark {...props} tone={props.tone} />
    </View>
  );
}

function Progress({ icon, label, done, total, show, tone = 'info' }: {
  icon: IconName; label: string; done: number; total: number; show: boolean; tone?: Tone;
}) {
  return (
    <View accessible accessibilityLabel={show ? `${label}: ${done} de ${total}` : `${label}: sin iniciar`}
      style={styles.statusCell}>
      <View style={styles.statusHead}>
        <Ionicons name={icon} size={16} color={colors.navy} />
        <Text style={styles.statusLabel}>{label}</Text>
      </View>
      <Text style={styles.statusValue}>{show ? `${done}/${total}` : 'Sin iniciar'}</Text>
      {show && total > 0 ? <ProgressBar done={done} thin tone={tone} total={total} /> : null}
    </View>
  );
}

function Badge({ icon, label, reading }: {
  icon: IconName; label: string; reading: Readonly<{ text: string; tone: Tone }> | null;
}) {
  const palette = reading ? toneColors[reading.tone] : null;
  return (
    <View accessible accessibilityLabel={`${label}: ${reading?.text ?? 'sin dato'}`} style={styles.statusCell}>
      <View style={styles.statusHead}>
        <Ionicons name={icon} size={16} color={colors.navy} />
        <Text style={styles.statusLabel}>{label}</Text>
      </View>
      <Text numberOfLines={2} style={[styles.statusValue, palette && reading?.tone !== 'neutral' && { color: palette.fg }]}>
        {reading?.text ?? '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...elevation.raised,
  },
  board: { backgroundColor: colors.navy, padding: space.xl - 4, gap: 18 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  title: { flex: 1, minWidth: 0 },
  flight: { color: colors.white, fontSize: 30, fontWeight: '900', letterSpacing: -0.4 },
  airline: { color: colors.white, fontSize: 15, fontWeight: '700', marginTop: 2 },
  code: { color: colors.onNavyMuted, fontSize: 13, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  topRight: { alignItems: 'flex-end', gap: 8, maxWidth: '45%' },
  legs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.navyDeep,
  },
  legDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.navyLine },
  pendingText: { flex: 1, color: colors.onNavyMuted, fontSize: 14, fontWeight: '700' },
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 14,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.navyLine,
  },
  factCell: { flexGrow: 1, flexBasis: '31%', minWidth: 150, paddingRight: 10 },
  status: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.lg, paddingVertical: 14, rowGap: 14 },
  statusCell: { flexGrow: 1, flexBasis: '19%', minWidth: 120, paddingHorizontal: 6, gap: 4 },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  statusValue: { color: colors.ink, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
});
