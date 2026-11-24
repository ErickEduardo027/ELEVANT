import type { RampAssignedOperationResponse, RampFlightLegResponse } from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { Fragment, memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  airlineBadge,
  delayReading,
  FLIGHT_PHASE_LABELS,
  FLIGHT_PHASE_STEPS,
  flightPhaseStep,
  legDelayMinutes,
  type FlightPhase,
} from '../features/assigned-operations/flight-status';
import { formatOperationTime, operationRouteStops } from '../features/assigned-operations/presentation';
import { colors, toneColors } from '../theme/colors';
import { radius } from '../theme/tokens';

/**
 * The flight's board, shared by the list's card and the operation's hero: the airline's badge, the route as the
 * aircraft flies it, each leg's scheduled, estimated and actual times with the delay, and the phase strip.
 */

export const AirlineBadge = memo(function AirlineBadge({ airline, size = 48 }: {
  airline: RampAssignedOperationResponse['turnaround']['airline'];
  size?: number;
}) {
  const badge = airlineBadge(airline);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: badge.color }]}
    >
      <Text style={[styles.badgeText, { fontSize: size * 0.38 }]}>{badge.initials}</Text>
    </View>
  );
});

/**
 * Every stop in order, «PTY → PUJ → PTY», with the station where the agent works boxed (a shape besides the colour,
 * ADR-0031), on one line whose dashed legs share the width between the codes.
 */
export function RouteLine({ operation, onDark = false, large = false }: {
  operation: RampAssignedOperationResponse; onDark?: boolean; large?: boolean;
}) {
  const stops = operationRouteStops(operation);
  const code = [styles.airportCode, large && styles.airportCodeLarge, onDark && styles.onDark];
  return (
    <View style={styles.routeRow}>
      {stops.map((stop, index) => (
        <Fragment key={stop.kind}>
          {index > 0 && (
            <View style={[styles.routeLine, onDark && styles.routeLineOnDark]}>
              <Ionicons name="airplane" size={large ? 18 : 15} color={colors.orange} />
            </View>
          )}
          {stop.kind === 'station' ? (
            <View style={[styles.stationStop, onDark && styles.stationStopOnDark]}>
              <Text style={[code, onDark && styles.stationCodeOnDark]}>{stop.code}</Text>
            </View>
          ) : (
            <Text style={code}>{stop.code}</Text>
          )}
        </Fragment>
      ))}
      {stops.length < 2 && (
        <View style={styles.routePending}>
          <Ionicons name="time-outline" size={17} color={onDark ? colors.orangeOnNavy : colors.warning} />
          <Text style={[styles.routePendingText, onDark && styles.onDarkMuted]}>Ruta por confirmar</Text>
        </View>
      )}
    </View>
  );
}

const LEG_CODES = {
  arrival: { scheduled: 'STA', estimated: 'ETA', actual: 'ATA', label: 'Llegada', icon: 'log-in-outline' as const },
  departure: { scheduled: 'STD', estimated: 'ETD', actual: 'ATD', label: 'Salida', icon: 'log-out-outline' as const },
};

/** What a screen reader says for a leg: «Llegada CM9001, programada 10:30, real 10:41, 11 minutos de retraso». */
export function legSpokenSummary(kind: 'arrival' | 'departure', leg: RampFlightLegResponse, timeZone?: string) {
  const delay = delayReading(legDelayMinutes(leg));
  return [
    `${LEG_CODES[kind].label} ${leg.flightNumber}`,
    `programada ${formatOperationTime(leg.scheduledAt, timeZone)}`,
    leg.estimatedAt ? `estimada ${formatOperationTime(leg.estimatedAt, timeZone)}` : null,
    leg.actualAt ? `real ${formatOperationTime(leg.actualAt, timeZone)}` : null,
    delay?.spoken,
  ].filter(Boolean).join(', ');
}

/**
 * One leg's times as the ramp reads them: STA/ETA/ATA for the arrival and STD/ETD/ATD for the departure, the latest
 * one strongest, and the delay against the schedule in its colour (amber under 15 min, red from 15 on).
 */
export const LegTimes = memo(function LegTimes({ kind, leg, timeZone, onDark = false, showFlight = true, grouped = false }: {
  /** Inside a control that already says it all (the list's card): no focus stop of its own. */
  grouped?: boolean;
  kind: 'arrival' | 'departure';
  leg: RampFlightLegResponse;
  timeZone?: string;
  onDark?: boolean;
  showFlight?: boolean;
}) {
  const codes = LEG_CODES[kind];
  const delay = delayReading(legDelayMinutes(leg));
  const entries = [
    { code: codes.scheduled, value: leg.scheduledAt, strong: !leg.estimatedAt && !leg.actualAt },
    leg.estimatedAt ? { code: codes.estimated, value: leg.estimatedAt, strong: !leg.actualAt } : null,
    leg.actualAt ? { code: codes.actual, value: leg.actualAt, strong: true } : null,
  ].filter((entry): entry is { code: string; value: string; strong: boolean } => entry !== null);
  const delayTone = delay ? toneColors[delay.tone] : null;

  return (
    <View accessible={!grouped} accessibilityLabel={grouped ? undefined : legSpokenSummary(kind, leg, timeZone)}
      style={styles.leg}>
      <View style={styles.legHead}>
        <Ionicons name={codes.icon} size={15} color={onDark ? colors.orangeOnNavy : colors.navy} />
        <Text numberOfLines={1} style={[styles.legLabel, onDark && styles.onDarkMuted]}>
          {showFlight ? `${codes.label} ${leg.flightNumber}` : codes.label}
        </Text>
        {delay && delayTone ? (
          <View style={[styles.delay, { backgroundColor: delayTone.bg, borderColor: delayTone.line }]}>
            <Text style={[styles.delayText, { color: delayTone.fg }]}>{delay.text}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.legTimes}>
        {entries.map(entry => (
          <Text
            key={entry.code}
            style={[styles.legTime, entry.strong && styles.legTimeStrong, onDark && styles.onDark,
              !entry.strong && onDark && styles.onDarkMuted, !entry.strong && !onDark && styles.legTimeSoft]}
          >
            {`${entry.code} ${formatOperationTime(entry.value, timeZone)}`}
          </Text>
        ))}
      </View>
    </View>
  );
});

/**
 * The phase strip, the board's signature: the steps of a turnaround from «Programado» to «Salió», the ones behind
 * filled, the current one marked and named. A cancelled flight shows only its state.
 */
export const PhaseStrip = memo(function PhaseStrip({ phase, onDark = false, showLabels = true, grouped = false }: {
  phase: FlightPhase; onDark?: boolean; showLabels?: boolean; grouped?: boolean;
}) {
  const current = flightPhaseStep(phase);
  const label = FLIGHT_PHASE_LABELS[phase];
  if (phase === 'cancelled') {
    return (
      <View accessible accessibilityLabel={`Fase del vuelo: ${label}`} style={styles.cancelled}>
        <Ionicons name="close-circle" size={16} color={colors.danger} />
        <Text style={styles.cancelledText}>{label}</Text>
      </View>
    );
  }
  return (
    <View accessible={!grouped} accessibilityLabel={grouped ? undefined : `Fase del vuelo: ${label}`} style={styles.strip}>
      <View style={styles.stripTrack}>
        {FLIGHT_PHASE_STEPS.map((step, index) => {
          const passed = index < current;
          const active = index === current;
          return (
            <View key={step} style={styles.stripCell}>
              <View style={[styles.stripBar, onDark && styles.stripBarOnDark, index === 0 && styles.stripBarHidden,
                (passed || active) && styles.stripBarDone]} />
              <View style={[styles.stripDot, onDark && styles.stripDotOnDark, passed && styles.stripDotDone,
                active && styles.stripDotActive]}>
                {active ? <View style={styles.stripDotCore} /> : null}
              </View>
              <View style={[styles.stripBar, onDark && styles.stripBarOnDark,
                index === FLIGHT_PHASE_STEPS.length - 1 && styles.stripBarHidden, passed && styles.stripBarDone]} />
            </View>
          );
        })}
      </View>
      {showLabels && (
        <View style={styles.stripLabels}>
          {FLIGHT_PHASE_STEPS.map((step, index) => (
            <Text
              key={step}
              numberOfLines={2}
              style={[styles.stripLabel, onDark && styles.onDarkMuted,
                index === current && (onDark ? styles.stripLabelActiveOnDark : styles.stripLabelActive)]}
            >
              {index === current ? label : FLIGHT_PHASE_LABELS[step]}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontWeight: '900', letterSpacing: 0.5 },
  onDark: { color: colors.white },
  onDarkMuted: { color: colors.onNavyMuted },
  // One line from the origin to the destination: the dashed legs share the width between the codes.
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  airportCode: { color: colors.navy, fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  airportCodeLarge: { fontSize: 24 },
  stationStop: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.xs,
    borderWidth: 1.5,
    borderColor: colors.orangeLine,
    backgroundColor: colors.paleOrange,
  },
  stationStopOnDark: { backgroundColor: colors.orange, borderColor: colors.orange },
  stationCodeOnDark: { color: colors.white },
  routeLine: {
    flex: 1,
    minWidth: 28,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1.5,
    borderStyle: 'dashed',
    borderBottomColor: colors.borderStrong,
    marginBottom: 8,
  },
  routeLineOnDark: { borderBottomColor: colors.navyLine },
  routePending: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  routePendingText: { color: colors.warning, fontSize: 13, fontWeight: '800' },
  // On a phone the two legs stack instead of squeezing their times.
  leg: { flexGrow: 1, flexBasis: 150, minWidth: 0, gap: 5 },
  legHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legLabel: { flexShrink: 1, color: colors.muted, fontSize: 12, fontWeight: '800' },
  delay: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill, borderWidth: 1 },
  delayText: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  legTimes: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2, alignItems: 'baseline' },
  legTime: { color: colors.ink, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  legTimeStrong: { fontSize: 17, fontWeight: '900' },
  legTimeSoft: { color: colors.muted },
  strip: { gap: 6 },
  stripTrack: { flexDirection: 'row', alignItems: 'center' },
  stripCell: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  stripBar: { flex: 1, height: 3, backgroundColor: colors.divider },
  stripBarHidden: { opacity: 0 },
  stripBarOnDark: { backgroundColor: colors.navyLine },
  stripBarDone: { backgroundColor: colors.orange },
  stripDot: {
    width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.borderStrong,
    backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center',
  },
  stripDotOnDark: { borderColor: colors.navyLine, backgroundColor: colors.navyDeep },
  stripDotDone: { borderColor: colors.orange, backgroundColor: colors.orange },
  stripDotActive: { width: 20, height: 20, borderRadius: 10, borderColor: colors.orange, backgroundColor: colors.white },
  stripDotCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.orange },
  stripLabels: { flexDirection: 'row' },
  stripLabel: { flex: 1, paddingHorizontal: 1, color: colors.muted, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  stripLabelActive: { color: colors.ink, fontWeight: '900' },
  stripLabelActiveOnDark: { color: colors.white, fontWeight: '900' },
  cancelled: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cancelledText: { color: colors.danger, fontSize: 13, fontWeight: '900' },
});
