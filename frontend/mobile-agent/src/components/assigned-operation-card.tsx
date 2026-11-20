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
  operationRouteStops,
  operationStandLabel,
  operationStatusLabel,
  operationStatusTone,
} from '../features/assigned-operations/presentation';
import { colors } from '../theme/colors';
import { StatusPill } from './ui';

/** The largest system font scale the narrow time rail follows before its label shrinks to fit. */
const RAIL_FONT_SCALE = 1.3;

export const AssignedOperationCard = memo(function AssignedOperationCard({
  operation,
  onOpen,
  selected = false,
}: {
  readonly operation: RampAssignedOperationResponse;
  readonly onOpen: (operationId: string) => void;
  readonly selected?: boolean;
}) {
  const stops = operationRouteStops(operation);
  const timeZone = operation.turnaround.station.ianaTimeZone;
  const time = formatOperationTime(operationPrimaryTime(operation), timeZone);
  const timeLabel = operationPrimaryTimeLabel(operation);
  const operationDate = formatOperationDate(operation.turnaround.operationDate);
  const status = operationStatusLabel(operation.operation.status);
  // The station alone means the turnaround has no flights yet.
  const hasRoute = stops.length > 1;
  // N13: one text for the card and the screen reader, «1 servicio» or «2 servicios».
  const servicesLabel = `${operation.services.length} ${operation.services.length === 1 ? 'servicio' : 'servicios'}`;

  return (
    <Pressable
      accessibilityHint="Abre el manifiesto y los servicios asignados"
      accessibilityLabel={`${operationFlightLabel(operation)}, ${status}, ${operationDate}, ${operationRouteDescription(operation)}, ${timeLabel} ${time}, ${operationStandLabel(operation)}, ${servicesLabel}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(operation.operation.id)}
      style={({ pressed }) => [styles.card, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={styles.timeRail}>
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
        {/* N10 (D-N10): the station is in the route row, so the rail no longer repeats its code. */}
        <View style={styles.railLine}>
          <View style={styles.railDot} />
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.operationCode}>{operation.turnaround.operationCode}</Text>
            <Text style={styles.flightLabel}>{operationFlightLabel(operation)}</Text>
          </View>
          <StatusPill
            text={status}
            tone={operationStatusTone(operation.operation.status)}
          />
        </View>

        {/* N10 (D-N10): every stop in order, «BWI → PUJ → BWI», with the station where the agent works highlighted.
            A leg is the line into a stop and the stop itself, so a narrow card wraps between stops, never inside one. */}
        <View style={styles.routeRow}>
          {stops.map((stop, index) => (
            <View key={stop.kind} style={[styles.routeStop, index > 0 && styles.routeLeg]}>
              {index > 0 && (
                <View style={styles.routeLine}>
                  <View style={styles.routeDot} />
                  <Ionicons name="airplane" size={16} color={colors.orange} />
                  <View style={styles.routeDot} />
                </View>
              )}
              {stop.kind === 'station' ? (
                <View style={styles.stationStop}>
                  <Text style={styles.airportCode}>{stop.code}</Text>
                </View>
              ) : (
                <Text style={styles.airportCode}>{stop.code}</Text>
              )}
            </View>
          ))}
          {!hasRoute && (
            <View style={styles.routePending}>
              <Ionicons name="time-outline" size={17} color={colors.warning} />
              <Text style={styles.routePendingText}>Ruta por confirmar</Text>
            </View>
          )}
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="location-outline" size={16} color={colors.navy} />
            <Text style={styles.metaText}>{operationStandLabel(operation)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="construct-outline" size={16} color={colors.navy} />
            <Text style={styles.metaText}>
              {servicesLabel}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.navy} />
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  selected: { borderColor: colors.blue, borderWidth: 2 },
  card: {
    minHeight: 190,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.white,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#081C3A',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.995 }] },
  timeRail: {
    width: 96,
    alignItems: 'center',
    backgroundColor: '#F8FAFD',
    paddingVertical: 18,
  },
  time: {
    color: colors.navy,
    fontSize: 20,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  // N11: written as the formatter and the label read («Inicio planificado», «lun, 16 nov»), without forced capitals.
  timeLabel: {
    maxWidth: 88,
    marginTop: 4,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 15,
    textAlign: 'center',
  },
  operationDate: {
    maxWidth: 88,
    marginTop: 5,
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
    textAlign: 'center',
  },
  railLine: {
    flex: 1,
    width: 2,
    minHeight: 62,
    marginVertical: 9,
    backgroundColor: '#FFD0B7',
    alignItems: 'center',
  },
  railDot: {
    width: 12,
    height: 12,
    marginTop: 17,
    borderRadius: 6,
    backgroundColor: colors.orange,
    borderWidth: 3,
    borderColor: '#FFF0E7',
  },
  content: { flex: 1, minWidth: 0, padding: 16, gap: 17 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  operationCode: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  flightLabel: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 3 },
  routeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 6 },
  routeStop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Each leg's line takes the free width of its row, as the single line between two airports did.
  routeLeg: { flexGrow: 1 },
  airportCode: { color: colors.navy, fontSize: 17, fontWeight: '900' },
  // N10: the station's code in a pale orange box, a shape besides the colour (ADR-0031); the code stays navy.
  stationStop: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFD0B7',
    backgroundColor: colors.paleOrange,
  },
  routeLine: {
    flex: 1,
    minWidth: 26,
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD6E6',
    paddingBottom: 4,
  },
  routeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#9EACC0' },
  routePending: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  routePendingText: { color: colors.warning, fontSize: 12, fontWeight: '800' },
  metaRow: {
    borderTopWidth: 1,
    borderTopColor: '#E7ECF3',
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  metaItem: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
});
