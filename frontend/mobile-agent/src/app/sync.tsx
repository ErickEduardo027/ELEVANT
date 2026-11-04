import { FLIGHT_REPORT_MILESTONES } from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionBadge } from '../components/flight-report/connection-badge';
import { PrimaryButton } from '../components/ui';
import {
  discardFlightReportItem,
  flushFlightReport,
  refreshFlightReportQueue,
  retryFlightReportItem,
  subscribeFlightReport,
  type FlightReportSnapshot,
} from '../services/flight-report';
import type { FlightReportOutboxItem } from '../synchronization/flight-report-outbox';
import { colors } from '../theme/colors';
import { radius, space, syncTone, type } from '../theme/tokens';
import { formatLocalDateTime } from '../utils/date-format';

const labels = new Map(FLIGHT_REPORT_MILESTONES.map(item => [item.code, item.label]));
const documentTitle = (kind: string) =>
  kind === 'ServiceOrder' ? 'Orden de Servicio' : kind === 'FlightReport' ? 'Reporte de Vuelo' : 'Check-List del puente';

function describe(item: FlightReportOutboxItem) {
  const command = item.command;
  if (command.kind === 'milestone') return `${labels.get(command.code) ?? command.code} · ${formatLocalDateTime(command.occurredAt)}`;
  if (command.kind === 'signature') return `Firma de ${command.signerName} · ${documentTitle(command.documentKind)}`;
  if (command.kind === 'damageMark') return `Daño marcado en el walk-around · ${command.note}`;
  if (command.kind === 'damagePhoto') return 'Foto de un daño del walk-around';
  const parts = [command.passengersIn != null && `${command.passengersIn} pax llegan`,
    command.passengersOut != null && `${command.passengersOut} salen`, command.mtowKg != null && `MTOW ${command.mtowKg} kg`,
    command.aircraftRegistration].filter(Boolean);
  return `Datos del vuelo · ${parts.join(' · ') || 'sin cambios'}`;
}

/**
 * «Sincronización» (ADR-0031): what the tablet saved and has not reached ELEVANT yet. Nothing is
 * lost: pending items go out on their own with signal; rejected ones wait here for the agent.
 */
export default function SyncScreen() {
  const [snapshot, setSnapshot] = useState<FlightReportSnapshot | null>(null);
  useEffect(() => subscribeFlightReport(setSnapshot), []);
  useEffect(() => { void refreshFlightReportQueue().catch(() => {}); }, []);
  const items = snapshot?.items ?? [];
  const pending = items.filter(item => item.state === 'pending').length;
  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <View style={styles.header}>
        <ConnectionBadge />
        <Text style={styles.summary}>
          {items.length === 0 ? 'Todo lo que registraste ya está confirmado en ELEVANT.'
            : `${pending} pendientes de envío · ${items.length - pending} por revisar`}
        </Text>
        {pending > 0 && <PrimaryButton disabled={snapshot?.syncing} icon="sync" title={snapshot?.syncing ? 'ENVIANDO…' : 'ENVIAR AHORA'}
          onPress={() => void flushFlightReport()} />}
      </View>
      <FlatList data={items} keyExtractor={item => item.idempotencyKey} contentContainerStyle={styles.list}
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="cloud-done-outline" size={42} color={colors.success} />
          <Text style={styles.emptyText}>Sin pendientes</Text></View>}
        renderItem={({ item }) => {
          const tone = syncTone[item.state === 'blocked' ? 'blocked' : 'device'];
          return (
            <View style={[styles.item, { borderColor: tone.fg }]}>
              <View style={styles.itemHead}>
                <Ionicons name={tone.icon} size={20} color={tone.fg} />
                <Text style={[styles.itemState, { color: tone.fg }]}>
                  {item.state === 'blocked' ? 'Rechazado por ELEVANT' : 'Guardado en el dispositivo'}</Text>
              </View>
              <Text style={styles.itemText}>{describe(item)}</Text>
              {item.lastError ? <Text style={styles.itemError}>{item.lastError}</Text> : null}
              {item.state === 'blocked' && <View style={styles.actions}>
                <PrimaryButton secondary icon="refresh" title="REINTENTAR" onPress={() => void retryFlightReportItem(item.idempotencyKey)} />
                <PrimaryButton danger icon="trash-outline" title="DESCARTAR" onPress={() => void discardFlightReportItem(item.idempotencyKey)} />
              </View>}
            </View>
          );
        }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: space.lg, gap: space.md },
  summary: { ...type.body, color: colors.ink },
  list: { padding: space.lg, gap: space.md },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl },
  emptyText: { ...type.label, color: colors.success },
  item: { backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, padding: space.lg, gap: space.sm },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  itemState: { ...type.caption },
  itemText: { ...type.label, color: colors.ink },
  itemError: { color: colors.danger },
  actions: { flexDirection: 'row', gap: space.sm },
});
