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
  operationRoute,
  operationStandLabel,
  operationStatusLabel,
  operationStatusTone,
} from '../features/assigned-operations/presentation';
import { colors } from '../theme/colors';
import { StatusPill } from './ui';

export const AssignedOperationCard = memo(function AssignedOperationCard({
  operation,
  onOpen,
  selected = false,
}: {
  readonly operation: RampAssignedOperationResponse;
  readonly onOpen: (operationId: string) => void;
  readonly selected?: boolean;
}) {
  const route = operationRoute(operation);
  const timeZone = operation.turnaround.station.ianaTimeZone;
  const time = formatOperationTime(operationPrimaryTime(operation), timeZone);
  const timeLabel = operationPrimaryTimeLabel(operation);
  const operationDate = formatOperationDate(operation.turnaround.operationDate);
  const status = operationStatusLabel(operation.operation.status);
  const hasRoute = Boolean(operation.turnaround.arrival || operation.turnaround.departure);

  return (
    <Pressable
      accessibilityHint="Abre el manifiesto y los servicios asignados"
      accessibilityLabel={`${operationFlightLabel(operation)}, ${status}, ${operationDate}, ${hasRoute ? `ruta ${route.origin} a ${route.destination}` : 'ruta por confirmar'}, ${timeLabel} ${time}, estación ${operation.turnaround.station.code}, ${operationStandLabel(operation)}, ${operation.services.length} servicios`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(operation.operation.id)}
      style={({ pressed }) => [styles.card, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={styles.timeRail}>
        <Text style={styles.time}>{time}</Text>
        <Text style={styles.timeLabel}>{timeLabel}</Text>
        <Text style={styles.operationDate}>{operationDate}</Text>
        <View style={styles.railLine}>
          <View style={styles.railDot} />
        </View>
        <Text style={styles.stationCode}>{operation.turnaround.station.code}</Text>
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

        {hasRoute ? (
          <View style={styles.routeRow}>
            <Text style={styles.airportCode}>{route.origin}</Text>
            <View style={styles.routeLine}>
              <View style={styles.routeDot} />
              <Ionicons name="airplane" size={16} color={colors.orange} />
              <View style={styles.routeDot} />
            </View>
            <Text style={styles.airportCode}>{route.destination}</Text>
          </View>
        ) : (
          <View style={styles.routePending}>
            <Ionicons name="time-outline" size={17} color={colors.warning} />
            <Text style={styles.routePendingText}>Ruta por confirmar</Text>
          </View>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="location-outline" size={16} color={colors.navy} />
            <Text style={styles.metaText}>{operationStandLabel(operation)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="construct-outline" size={16} color={colors.navy} />
            <Text style={styles.metaText}>
              {operation.services.length} {operation.services.length === 1 ? 'servicio' : 'servicios'}
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
    width: 84,
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
  timeLabel: {
    maxWidth: 76,
    marginTop: 4,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 15,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  operationDate: {
    maxWidth: 76,
    marginTop: 5,
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
    textAlign: 'center',
    textTransform: 'capitalize',
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
  stationCode: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.4,
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
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  airportCode: { color: colors.navy, fontSize: 17, fontWeight: '900' },
  routeLine: {
    flex: 1,
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
