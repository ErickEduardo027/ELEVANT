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
import { readUnsentRecords } from '../services/mobile-auth';
import type { FlightReportOutboxItem } from '../synchronization/flight-report-outbox';
import { serviceStatusLabel } from '../features/assigned-operations/presentation';
import { colors } from '../theme/colors';
import { radius, space, syncTone, type } from '../theme/tokens';
import { formatStationDateTime } from '../utils/date-format';
import { otherAccountsPendingEvidenceNote } from '../utils/pending-evidence';

const labels = new Map(FLIGHT_REPORT_MILESTONES.map(item => [item.code, item.label]));
const documentTitle = (kind: string) =>
  kind === 'ServiceOrder' ? 'Orden de Servicio' : kind === 'FlightReport' ? 'Reporte de Vuelo'
    : kind === 'CharterServiceRequest' ? 'Solicitud de Servicio' : 'Check-List del puente';

const shorten = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

/** What one queued command records, in the station's local time when the command knows its station (3-I). */
function describe(item: FlightReportOutboxItem) {
  const command = item.command;
  switch (command.kind) {
    case 'milestone':
      return `${labels.get(command.code) ?? command.code} · ${formatStationDateTime(command.occurredAt, command.timeZone)}`;
    case 'signature': return `Firma de ${command.signerName} · ${documentTitle(command.documentKind)}`;
    case 'damageMark': return `Daño marcado en el walk-around · ${command.note}`;
    case 'damagePhoto': return 'Foto de un daño del walk-around';
    case 'charterService': return `Servicio del charter · cantidad ${command.quantity}`;
    case 'charterDetails': return 'Datos del transportista del charter';
    case 'start':
      // A start an older version reserved has no tapped time: ELEVANT records the moment it arrives.
      return command.occurredAt
        ? `Inicio de la operación · ${formatStationDateTime(command.occurredAt, command.timeZone)}`
        : 'Inicio de la operación · hora de llegada a ELEVANT';
    case 'serviceTransition': {
      const quantity = command.executedQuantity === null ? '' : ` · cantidad ${command.executedQuantity}`;
      const at = command.occurredAt ? ` · ${formatStationDateTime(command.occurredAt, command.timeZone)}` : '';
      return `${command.serviceName ?? 'Servicio'} · ${serviceStatusLabel(command.targetStatus)}${quantity}${at}`;
    }
    case 'serviceCharge':
      return `${command.action === 'Apply' ? 'Cargo marcado' : 'Cargo quitado'} · ${command.chargeName ?? 'cargo del servicio'}`;
    case 'checklistSubmit':
      return `Envío del checklist · ${command.answers.length} ${command.answers.length === 1 ? 'respuesta' : 'respuestas'}`;
    case 'chatMessage': return `Mensaje a OCC · ${shorten(command.content)}`;
    case 'flightData': {
      const parts = [command.passengersIn != null && `${command.passengersIn} pax llegan`,
        command.passengersOut != null && `${command.passengersOut} salen`, command.mtowKg != null && `MTOW ${command.mtowKg} kg`,
        command.aircraftRegistration].filter(Boolean);
      return `Datos del vuelo · ${parts.join(' · ') || 'sin cambios'}`;
    }
  }
}

/**
 * «Sincronización» (ADR-0031): what the tablet saved and has not reached ELEVANT yet. Nothing is
 * lost: pending items go out on their own with signal; rejected ones wait here for the agent.
 */
export default function SyncScreen() {
  const [snapshot, setSnapshot] = useState<FlightReportSnapshot | null>(null);
  const [othersUnsent, setOthersUnsent] = useState(0);
  useEffect(() => subscribeFlightReport(setSnapshot), []);
  useEffect(() => { void refreshFlightReportQueue().catch(() => {}); }, []);
  // 3-N12: another account's unsent records stay on the tablet for it; this one only learns they exist.
  useEffect(() => {
    let mounted = true;
    void readUnsentRecords().then(count => { if (mounted) setOthersUnsent(count?.others ?? 0); });
    return () => { mounted = false; };
  }, []);
  const items = snapshot?.items ?? [];
  const pending = items.filter(item => item.state === 'pending').length;
  const othersNote = otherAccountsPendingEvidenceNote(othersUnsent);
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
        {!!othersNote && <View accessibilityLiveRegion="polite" style={styles.others}>
          <Ionicons name="people-outline" size={18} color={colors.warning} />
          <Text style={styles.othersText}>{othersNote}</Text>
        </View>}
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
  others: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md,
    backgroundColor: colors.paleOrange },
  othersText: { flex: 1, color: colors.warning, fontWeight: '700' },
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
