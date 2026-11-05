import type { CharterCatalogItemResponse } from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  addCharterService,
  loadCharter,
  saveCharterDetails,
  subscribeFlightReport,
  type FlightReportSnapshot,
} from '../../services/flight-report';
import { colors } from '../../theme/colors';
import { radius, space, syncTone, touch, type } from '../../theme/tokens';
import { PrimaryButton } from '../ui';

function money(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const quantityOf = (text: string) => {
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value <= 999 && Math.round(value * 100) === value * 100 ? value : null;
};

/**
 * Charter without contract (ADR-0033): the carrier asks for services at Finance's base tariff and
 * leaves its address and who pays. Everything is saved on the device first and reaches the
 * «Solicitud de Servicio» that the representative signs with an ID or passport.
 */
export function CharterCard({ operationId, editable, existingServiceIds }: {
  operationId: string; editable: boolean; existingServiceIds: readonly string[];
}) {
  const [snapshot, setSnapshot] = useState<FlightReportSnapshot | null>(null);
  useEffect(() => subscribeFlightReport(setSnapshot), []);
  const isCharter = snapshot?.documents[operationId]?.documents.some(item => item.kind === 'CharterServiceRequest') ?? false;
  const charter = snapshot?.charters[operationId];
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading');

  useEffect(() => {
    if (!isCharter) return;
    let alive = true;
    loadCharter(operationId).then(() => { if (alive) setState('ready'); })
      .catch(() => { if (alive) setState('offline'); });
    return () => { alive = false; };
  }, [isCharter, operationId]);

  if (!isCharter) return null;
  const queued = (snapshot?.items ?? []).filter(item => item.command.operationId === operationId);
  const queuedServices = new Set(queued.flatMap(item => item.command.kind === 'charterService' ? [item.command.serviceDefinitionId] : []));
  const detailsQueued = queued.some(item => item.command.kind === 'charterDetails');
  const confirmed = charter?.prepaymentStatus === 'Confirmed';

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Ionicons name="airplane-outline" size={22} color={colors.navy} />
        <Text style={styles.title}>Charter sin contrato</Text>
        {charter && (
          <View style={[styles.chip, { backgroundColor: confirmed ? syncTone.confirmed.bg : syncTone.device.bg }]}>
            <Text style={[styles.chipText, { color: confirmed ? syncTone.confirmed.fg : syncTone.device.fg }]}>
              {confirmed ? 'Prepago confirmado' : 'Prepago pendiente'}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.hint}>
        Se cobra a la tarifa estándar de Finanzas. Lo que agregue aquí aparece en la Solicitud de Servicio que firma el representante.
      </Text>
      {!charter && state === 'loading' && <Text style={styles.hint}>Cargando tarifas…</Text>}
      {!charter && state === 'offline' && (
        <View style={styles.notice}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.warning} />
          <Text style={styles.noticeText}>Las tarifas del charter necesitan señal la primera vez.</Text>
        </View>
      )}
      {charter && (
        <>
          <CharterDetails key={`${charter.carrierAddress ?? ''}|${charter.chargesPayableBy ?? ''}`} operationId={operationId}
            editable={editable} address={charter.carrierAddress ?? ''} payableBy={charter.chargesPayableBy ?? ''} queued={detailsQueued} />
          <Text style={styles.section}>Servicios solicitados</Text>
          {charter.catalog.length === 0 && <Text style={styles.hint}>Finanzas no tiene tarifas base activas.</Text>}
          {charter.catalog.map(item => (
            <CatalogRow key={item.serviceDefinitionId} item={item} currency={charter.currencyCode} editable={editable}
              status={existingServiceIds.includes(item.serviceDefinitionId) ? 'added' : queuedServices.has(item.serviceDefinitionId) ? 'queued' : 'open'}
              onAdd={quantity => {
                void addCharterService(operationId, item.serviceDefinitionId, quantity);
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              }} />
          ))}
        </>
      )}
    </View>
  );
}

function CharterDetails({ operationId, editable, address, payableBy, queued }: {
  operationId: string; editable: boolean; address: string; payableBy: string; queued: boolean;
}) {
  const [carrierAddress, setCarrierAddress] = useState(address);
  const [chargesPayableBy, setChargesPayableBy] = useState(payableBy);
  const changed = carrierAddress.trim() !== address || chargesPayableBy.trim() !== payableBy;
  return (
    <View style={styles.details}>
      <Text style={styles.fieldLabel}>Dirección del transportista</Text>
      <TextInput accessibilityLabel="Dirección del transportista" value={carrierAddress} onChangeText={setCarrierAddress}
        editable={editable} maxLength={300} placeholder="Calle, ciudad y país" style={styles.input} />
      <Text style={styles.fieldLabel}>Cargos pagaderos por</Text>
      <TextInput accessibilityLabel="Cargos pagaderos por" value={chargesPayableBy} onChangeText={setChargesPayableBy}
        editable={editable} maxLength={160} placeholder="Empresa o persona que paga" style={styles.input} />
      {queued && <Text style={styles.queued}>Guardado en el dispositivo · se envía con señal</Text>}
      {editable && (
        <PrimaryButton icon="save-outline" title="GUARDAR DATOS" disabled={!changed}
          onPress={() => void saveCharterDetails(operationId, carrierAddress.trim() || null, chargesPayableBy.trim() || null)} />
      )}
    </View>
  );
}

function CatalogRow({ item, currency, editable, status, onAdd }: {
  item: CharterCatalogItemResponse; currency: string; editable: boolean; status: 'added' | 'queued' | 'open';
  onAdd: (quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(String(item.minimumQuantity));
  const value = quantityOf(quantity);
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{item.name}</Text>
        <Text style={styles.rowMeta}>{money(item.unitPrice, currency)} · mínimo {item.minimumQuantity.toLocaleString('es-DO')}</Text>
      </View>
      {status === 'added' && <Text style={styles.added}>Agregado</Text>}
      {status === 'queued' && <Text style={styles.queued}>En el dispositivo</Text>}
      {status === 'open' && editable && (
        <>
          <TextInput accessibilityLabel={`Cantidad de ${item.name}`} value={quantity} onChangeText={setQuantity}
            keyboardType="decimal-pad" maxLength={6} style={[styles.input, styles.quantity]} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Agregar ${item.name}`} disabled={value === null}
            onPress={() => { if (value !== null) onAdd(value); }}
            style={({ pressed }) => [styles.add, value === null && styles.disabled, pressed && styles.pressed]}>
            <Ionicons name="add" size={20} color={colors.white} />
            <Text style={styles.addText}>AGREGAR</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { ...type.title, color: colors.navy, flex: 1 },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill },
  chipText: { ...type.caption },
  hint: { ...type.body, color: colors.muted },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'center', backgroundColor: colors.paleOrange, borderRadius: radius.md, padding: space.md },
  noticeText: { ...type.body, color: colors.warning, flex: 1 },
  details: { gap: space.sm },
  section: { ...type.label, color: colors.navy, marginTop: space.sm },
  fieldLabel: { ...type.label, color: colors.ink },
  input: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, minHeight: touch.min,
    paddingHorizontal: space.md, ...type.body, fontSize: 18, color: colors.ink },
  quantity: { width: 84, textAlign: 'center', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch.min, borderTopWidth: 1,
    borderTopColor: colors.border, paddingTop: space.sm },
  rowText: { flex: 1, gap: 2 },
  rowName: { ...type.label, color: colors.ink },
  rowMeta: { ...type.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  added: { ...type.caption, color: colors.success },
  queued: { ...type.caption, color: colors.warning },
  add: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: colors.orange, minHeight: touch.min,
    paddingHorizontal: space.lg, borderRadius: radius.pill },
  addText: { ...type.label, color: colors.white, letterSpacing: 0.6 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
