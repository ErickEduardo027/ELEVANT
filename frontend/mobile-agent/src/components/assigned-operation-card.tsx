import { memo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { RampAssignedOperationResponse } from '@elevant/api-client';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  formatOperationDate,
  formatOperationTime,
  operationFlightLabel,
  operationPrimaryTime,
  operationPrimaryTimeLabel,
  operationRouteDescription,
  operationStandLabel,
  operationStatusLabel,
  operationStatusTone,
} from '../features/assigned-operations/presentation';
import {
  aircraftTypeLabel,
  FLIGHT_PHASE_LABELS,
  FLIGHT_PHASE_TONES,
  flightPhase,
  formatDuration,
  groundTimeMinutes,
  milestoneProgress,
  nextEvent,
  serviceProgress,
} from '../features/assigned-operations/flight-status';
import { colors, toneColors } from '../theme/colors';
import { radius, space } from '../theme/tokens';
import { AirlineBadge, LegTimes, legSpokenSummary, PhaseStrip, RouteLine } from './flight-board';
import { ProgressBar, StatusPill } from './ui';

/** The largest system font scale the narrow time rail follows before its label shrinks to fit. */
const RAIL_FONT_SCALE = 1.3;
/** The service chips the card shows before «+2». */
const SERVICE_CHIPS = 3;

/**
 * An assigned operation in the list, as a flight strip: the time rail on the left, then the flight (airline, numbers,
 * status), its route, each leg's STA/ETA/ATA and STD/ETD/ATD with the delay, the phase strip, the stand, aircraft,
 * ground time and the countdown, and how far the services and the Flight Report are. Everything comes from the
 * assignment ELEVANT sends; `now` is ELEVANT's minute (the list passes one clock to every card).
 */
export const AssignedOperationCard = memo(function AssignedOperationCard({
  operation,
  onOpen,
  selected = false,
  now,
}: {
  readonly operation: RampAssignedOperationResponse;
  readonly onOpen: (operationId: string) => void;
  readonly selected?: boolean;
  readonly now?: number;
}) {
  const { turnaround } = operation;
  const timeZone = turnaround.station.ianaTimeZone;
  const time = formatOperationTime(operationPrimaryTime(operation), timeZone);
  const timeLabel = operationPrimaryTimeLabel(operation);
  const operationDate = formatOperationDate(turnaround.operationDate);
  const status = operationStatusLabel(operation.operation.status);
  const phase = flightPhase(operation);
  const phaseTone = toneColors[FLIGHT_PHASE_TONES[phase]];
  const next = now === undefined ? null : nextEvent(operation, now);
  const ground = groundTimeMinutes(turnaround);
  const aircraft = aircraftTypeLabel(turnaround.aircraft);
  const services = serviceProgress(operation.services);
  const milestones = milestoneProgress(operation.milestones);
  const started = operation.operation.status !== 'Assigned' && operation.operation.status !== 'Planned';
  // N13: one text for the card and the screen reader, «1 servicio» or «2 servicios».
  const servicesLabel = `${operation.services.length} ${operation.services.length === 1 ? 'servicio' : 'servicios'}`;
  const legsSpoken = [
    turnaround.arrival ? legSpokenSummary('arrival', turnaround.arrival, timeZone) : null,
    turnaround.departure ? legSpokenSummary('departure', turnaround.departure, timeZone) : null,
  ].filter(Boolean).join(', ');
  const extraServices = operation.services.length - SERVICE_CHIPS;

  return (
    <Pressable
      accessibilityHint="Abre el manifiesto y los servicios asignados"
      accessibilityLabel={[
        operationFlightLabel(operation), turnaround.airline.name, status, `fase ${FLIGHT_PHASE_LABELS[phase]}`,
        operationDate, operationRouteDescription(operation), `${timeLabel} ${time}`, legsSpoken || null,
        next?.text ?? null, operationStandLabel(operation), servicesLabel,
      ].filter(Boolean).join(', ')}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(operation.operation.id)}
      style={({ pressed }) => [styles.card, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={[styles.timeRail, { borderTopColor: phaseTone.fg }]}>
        <Text style={styles.time}>{time}</Text>
        {/* N11: two lines that shrink to fit, never a word broken in two («INICIO PLANI/FICADO»). Fabric on Android
            ignores minimumFontScale, so the system font scale is capped instead. */}
        <Text
          adjustsFontSizeToFit
          maxFontSizeMultiplier={RAIL_FONT_SCALE}
          numberOfLines={2}
          style={styles.timeLabel}
        >
          {timeLabel}
        </Text>
        <Text style={styles.operationDate}>{operationDate}</Text>
        <View style={[styles.phase, { backgroundColor: phaseTone.bg, borderColor: phaseTone.line }]}>
          <Text adjustsFontSizeToFit maxFontSizeMultiplier={RAIL_FONT_SCALE} numberOfLines={2}
            style={[styles.phaseText, { color: phaseTone.fg }]}>
            {FLIGHT_PHASE_LABELS[phase]}
          </Text>
        </View>
        {next ? (
          <Text maxFontSizeMultiplier={RAIL_FONT_SCALE} numberOfLines={3}
            style={[styles.next, { color: toneColors[next.tone].fg }]}>
            {next.text}
          </Text>
        ) : null}
      </View>

      <View style={styles.content}>
        <View style={styles.topRow}>
          <AirlineBadge airline={turnaround.airline} size={46} />
          <View style={styles.titleBlock}>
            <Text numberOfLines={1} style={styles.flightLabel}>{operationFlightLabel(operation)}</Text>
            <Text numberOfLines={1} style={styles.subtitle}>{turnaround.airline.name}</Text>
            <Text numberOfLines={1} style={styles.operationCode}>{turnaround.operationCode}</Text>
          </View>
          <StatusPill text={status} tone={operationStatusTone(operation.operation.status)} />
        </View>

        {/* N10 (D-N10): every stop in order, «BWI → PUJ → BWI», with the station where the agent works highlighted. */}
        <RouteLine operation={operation} />

        {(turnaround.arrival || turnaround.departure) && (
          <View style={styles.legs}>
            {turnaround.arrival && <LegTimes grouped kind="arrival" leg={turnaround.arrival} timeZone={timeZone} />}
            {turnaround.departure && <LegTimes grouped kind="departure" leg={turnaround.departure} timeZone={timeZone} />}
          </View>
        )}

        <PhaseStrip grouped phase={phase} showLabels={false} />

        <View style={styles.facts}>
          <View style={styles.fact}>
            <Ionicons name="location" size={15} color={colors.navy} />
            <Text style={styles.factText}>{operationStandLabel(operation)}</Text>
          </View>
          {aircraft && (
            <View style={styles.fact}>
              <Ionicons name="airplane-outline" size={15} color={colors.navy} />
              <Text numberOfLines={1} style={styles.factText}>
                {turnaround.aircraft?.registration ? `${aircraft} · ${turnaround.aircraft.registration}` : aircraft}
              </Text>
            </View>
          )}
          {ground !== null && (
            <View style={styles.fact}>
              <Ionicons name="hourglass-outline" size={15} color={colors.navy} />
              <Text style={styles.factText}>{`En tierra ${formatDuration(ground)}`}</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <View style={styles.progressGroup}>
            <View style={styles.progressItem}>
              <View style={styles.progressHead}>
                <Ionicons name="construct-outline" size={15} color={colors.navy} />
                <Text style={styles.progressLabel}>
                  {started && services.total > 0 ? `${servicesLabel} · ${services.done}/${services.total}` : servicesLabel}
                </Text>
              </View>
              {started && services.total > 0 && <ProgressBar done={services.done} thin total={services.total} />}
            </View>
            {started && (
              <View style={styles.progressItem}>
                <View style={styles.progressHead}>
                  <Ionicons name="flag-outline" size={15} color={colors.navy} />
                  <Text style={styles.progressLabel}>{`Hitos ${milestones.done}/${milestones.total}`}</Text>
                </View>
                <ProgressBar done={milestones.done} thin tone="brand" total={milestones.total} />
              </View>
            )}
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.navy} />
        </View>

        {operation.services.length > 0 && (
          <View style={styles.chips}>
            {operation.services.slice(0, SERVICE_CHIPS).map(service => (
              <View key={service.id} style={styles.chip}>
                <Text numberOfLines={1} style={styles.chipText}>{service.name}</Text>
              </View>
            ))}
            {extraServices > 0 && (
              <View style={[styles.chip, styles.chipMore]}>
                <Text style={[styles.chipText, styles.chipMoreText]}>{`+${extraServices}`}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  selected: { borderColor: colors.blue, borderWidth: 2 },
  pressed: { opacity: 0.85 },
  timeRail: {
    width: 104,
    alignItems: 'center',
    backgroundColor: colors.surfaceSunken,
    borderRightWidth: 1,
    borderRightColor: colors.divider,
    borderTopWidth: 4,
    paddingVertical: 16,
    paddingHorizontal: 6,
    gap: 4,
  },
  time: { color: colors.navy, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  // N11: written as the formatter and the label read («Inicio planificado», «lun, 16 nov»), without forced capitals.
  timeLabel: { maxWidth: 92, color: colors.muted, fontSize: 12, fontWeight: '800', lineHeight: 15, textAlign: 'center' },
  operationDate: { maxWidth: 92, color: colors.ink, fontSize: 12, fontWeight: '800', lineHeight: 14, textAlign: 'center' },
  phase: {
    marginTop: 8,
    maxWidth: 92,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
    borderWidth: 1,
  },
  phaseText: { fontSize: 12, fontWeight: '900', textAlign: 'center' },
  next: { maxWidth: 92, marginTop: 4, fontSize: 12, fontWeight: '800', lineHeight: 15, textAlign: 'center' },
  content: { flex: 1, minWidth: 0, padding: space.lg, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleBlock: { flex: 1, minWidth: 0 },
  flightLabel: { color: colors.ink, fontSize: 21, fontWeight: '900', letterSpacing: -0.2 },
  subtitle: { color: colors.inkSoft, fontSize: 13, fontWeight: '700', marginTop: 1 },
  operationCode: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 1, fontVariant: ['tabular-nums'] },
  legs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
  },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' },
  factText: { flexShrink: 1, color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  progressGroup: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  progressItem: { flexGrow: 1, flexBasis: 150, gap: 6 },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progressLabel: { color: colors.inkSoft, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -4 },
  chip: {
    maxWidth: 200,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.xs,
    backgroundColor: colors.paleBlue,
  },
  chipText: { color: colors.navy, fontSize: 12, fontWeight: '700' },
  chipMore: { backgroundColor: colors.surfaceSunken, borderWidth: 1, borderColor: colors.border },
  chipMoreText: { color: colors.inkSoft },
});
