import type {
  RampOperationChargesResponse,
  RampOperationServiceResponse,
  RampServiceChargesResponse,
} from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { subscribeFlightReport } from '../services/flight-report';
import { MobileServiceError } from '../services/mobile-auth';
import type { FlightReportOutboxItem } from '../synchronization/flight-report-outbox';
import {
  changeRampServiceCharge,
  getRampOperationCharges,
  type RampServiceChargeAction,
} from '../services/ramp-service-charges';
import { colors } from '../theme/colors';
import { Card } from './ui';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * The charges as the agent left them on the device (3-I): each mark or unmark still waiting in the queue is applied,
 * in its order, over ELEVANT's copy. A mark saved on the device carries the source «Device» until ELEVANT confirms it.
 */
export function projectCharges(
  charges: RampOperationChargesResponse,
  items: readonly FlightReportOutboxItem[],
): RampOperationChargesResponse {
  const queued = items.filter(item => item.state === 'pending' && item.command.kind === 'serviceCharge' &&
    item.command.operationId.toLowerCase() === charges.operationId.toLowerCase());
  if (queued.length === 0) return charges;
  return {
    ...charges,
    services: charges.services.map(service => {
      let applied = service.applied;
      for (const item of queued) {
        const command = item.command;
        if (command.kind !== 'serviceCharge' || command.serviceId.toLowerCase() !== service.serviceId.toLowerCase()) continue;
        if (command.action === 'Apply') {
          const option = service.available.find(candidate => candidate.id.toLowerCase() === command.chargeId);
          applied = [...applied, { id: item.idempotencyKey, chargeId: option?.id ?? command.chargeId,
            code: option?.code ?? '', name: option?.name ?? command.chargeName ?? 'Cargo', appliedAt: item.createdAt,
            source: 'Device' }];
        } else {
          const index = applied.map(mark => mark.chargeId.toLowerCase() === command.chargeId &&
            (mark.source ?? 'Agent') !== 'Automatic' && mark.source !== 'Occ').lastIndexOf(true);
          if (index >= 0) applied = [...applied.slice(0, index), ...applied.slice(index + 1)];
        }
      }
      return { ...service, applied };
    }),
  };
}

/**
 * "Cargos aplicados": the agent marks only the type of charge (night, overtime…)
 * on each service. Prices and quantities are computed by ELEVANT from the
 * recorded times; Finance reviews them before invoicing.
 */
export function RampOperationChargesCard({
  operationId,
  refreshKey,
  services,
}: Readonly<{
  operationId: string;
  /** Changes whenever service statuses change, so editability is re-read. */
  refreshKey: string;
  services: readonly RampOperationServiceResponse[];
}>) {
  const [loaded, setLoaded] = useState<RampOperationChargesResponse | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [state, setState] = useState<LoadState>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<readonly FlightReportOutboxItem[]>([]);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => subscribeFlightReport(snapshot => {
    setQueueItems(snapshot.items);
    setRevision(snapshot.revisions[operationId.toLowerCase()] ?? snapshot.revisions[operationId] ?? 0);
  }), [operationId]);
  const charges = useMemo(() => loaded && projectCharges(loaded, queueItems), [loaded, queueItems]);

  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await getRampOperationCharges(operationId);
      if (current !== generation.current) return;
      setLoaded(result.charges);
      setFromCache(result.fromCache);
      setState('ready');
    } catch (error) {
      if (current !== generation.current) return;
      setState('error');
      setMessage(error instanceof MobileServiceError ? error.message : 'No fue posible cargar los cargos.');
    }
  }, [operationId]);

  // A charge that went out from the queue moves the operation's revision: ELEVANT's copy is read again (3-I).
  useEffect(() => { void load(); }, [load, refreshKey, revision]);

  async function change(service: RampServiceChargesResponse, chargeId: string, action: RampServiceChargeAction) {
    const key = `${service.serviceId}:${chargeId}`;
    setBusy(key);
    setMessage(null);
    try {
      const option = service.available.find(candidate => candidate.id === chargeId);
      const updated = await changeRampServiceCharge(operationId, service.serviceId, chargeId, action,
        { chargeName: option?.name });
      if (!updated) {
        setMessage('Cargo guardado en el dispositivo; se envía a ELEVANT en cuanto haya señal.');
        return;
      }
      setLoaded(current => current && {
        ...current,
        services: current.services.map(item => (item.serviceId === updated.serviceId ? updated : item)),
      });
    } catch (error) {
      const failure = error instanceof MobileServiceError ? error : null;
      setMessage(failure?.code === 'conflict' && !failure.problemCode
        ? 'El servicio cambió. Se actualizaron los cargos.'
        : failure?.message ?? 'No fue posible registrar el cargo.');
      if (failure?.code === 'conflict' || failure?.code === 'not_found') void load();
    } finally {
      setBusy(null);
    }
  }

  const withOptions = (charges?.services ?? []).filter(item => item.available.length > 0 || item.applied.length > 0);
  if (state === 'ready' && withOptions.length === 0) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="pricetags-outline" size={20} color={colors.blue} />
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Cargos aplicados</Text>
          <Text style={styles.subtitle}>Marca solo el tipo de cargo. ELEVANT calcula el tiempo y Finanzas el importe.</Text>
        </View>
      </View>
      {state === 'loading' && <ActivityIndicator color={colors.blue} accessibilityLabel="Cargando cargos" />}
      {fromCache && <Text style={styles.warning}>Sin conexión: se muestra la última copia guardada; lo que marques se envía al reconectar.</Text>}
      {message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
      {state === 'error' && (
        <Pressable accessibilityRole="button" onPress={() => { setState('loading'); void load(); }} style={styles.retry}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      )}
      {withOptions.map(item => {
        const service = services.find(candidate => candidate.id === item.serviceId);
        // 3-I: without signal the agent still marks; the queue sends it in order when there is signal.
        const editable = item.canEdit;
        return (
          <View key={item.serviceId} style={styles.service}>
            <Text style={styles.serviceName}>{service ? `${service.code} · ${service.name}` : 'Servicio'}</Text>
            {!item.canEdit && <Text style={styles.hint}>Disponible cuando el servicio esté en curso, completado o en excepción.</Text>}
            <View style={styles.chips}>
              {item.available.map(option => {
                const marks = item.applied.filter(applied => applied.chargeId === option.id);
                const selected = marks.length > 0;
                const key = `${item.serviceId}:${option.id}`;
                // ADR-0034: ELEVANT's automatic marks and OCC's are not the agent's to remove.
                const agentMarks = marks.filter(mark => (mark.source ?? 'Agent') === 'Agent' || mark.source === 'Device');
                const locked = selected && !option.allowMultiple && agentMarks.length === 0;
                const origin = marks.find(mark => mark.source === 'Automatic') ? 'automático'
                  : marks.find(mark => mark.source === 'Occ') ? 'OCC'
                    : marks.find(mark => mark.source === 'Device') ? 'en el dispositivo' : null;
                const disabled = !editable || busy !== null || locked;
                const action: RampServiceChargeAction = selected && !option.allowMultiple ? 'Remove' : 'Apply';
                return (
                  <Pressable
                    accessibilityLabel={`${option.name}${selected ? ', aplicado' : ''}${origin ? `, ${origin}` : ''}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected, disabled }}
                    disabled={disabled}
                    key={option.id}
                    onPress={() => void change(item, option.id, action)}
                    style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
                  >
                    {busy === key
                      ? <ActivityIndicator size="small" color={selected ? colors.white : colors.blue} />
                      : <Ionicons name={selected ? 'checkmark-circle' : 'add-circle-outline'} size={16} color={selected ? colors.white : colors.blue} />}
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option.name}{option.allowMultiple && marks.length > 1 ? ` ×${marks.length}` : ''}{origin ? ` · ${origin}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {item.available.some(option => option.allowMultiple && item.applied.some(applied => applied.chargeId === option.id &&
              ((applied.source ?? 'Agent') === 'Agent' || applied.source === 'Device'))) && editable && (
              <View style={styles.chips}>
                {item.available.filter(option => option.allowMultiple && item.applied.some(applied => applied.chargeId === option.id &&
                  ((applied.source ?? 'Agent') === 'Agent' || applied.source === 'Device'))).map(option => (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${option.name}`} disabled={busy !== null}
                    key={option.id} onPress={() => void change(item, option.id, 'Remove')} style={styles.remove}>
                    <Text style={styles.removeText}>Quitar uno · {option.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  header: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  headerCopy: { flex: 1, gap: 2 },
  title: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 13 },
  warning: { color: colors.warning, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13 },
  retry: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  retryText: { color: colors.blue, fontWeight: '700' },
  service: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  serviceName: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12,
    borderRadius: 22, borderWidth: 1, borderColor: colors.blue, backgroundColor: colors.white,
  },
  chipSelected: { backgroundColor: colors.blue },
  chipDisabled: { opacity: 0.5 },
  chipText: { color: colors.blue, fontWeight: '600', fontSize: 14 },
  chipTextSelected: { color: colors.white },
  remove: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  removeText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
});
