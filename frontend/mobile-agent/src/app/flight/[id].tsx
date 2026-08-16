import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Card, PrimaryButton, StatusPill } from '../../components/ui';
import { canOperateFlight, checklistSections, Flight } from '../../data/mock';
import { addToOutbox, cancelOperationStart, flightKey, getChecklist, getOperationState, OperationState, setJson } from '../../storage/prototype-storage';
import { colors } from '../../theme/colors';
import { getAssignedFlight, refreshAssignedFlights } from '../../services/assigned-flights';

export default function FlightDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [flight, setFlight] = useState<Flight>();
  const [state, setState] = useState<OperationState>({});
  const checklistTotal = checklistSections.reduce((sum, item) => sum + item.items.length, 0);
  useFocusEffect(useCallback(() => {
    let active = true;
    const load = async () => {
      const assigned = await refreshAssignedFlights();
      const found = assigned.find(item => item.id === id) ?? await getAssignedFlight(id);
      if (!active) return;
      setFlight(found);
      if (found) setState(await getOperationState(found.id, checklistTotal));
    };
    load().catch(() => {});
    const interval = setInterval(() => load().catch(() => {}), 5000);
    return () => { active = false; clearInterval(interval); };
  }, [id, checklistTotal]));
  if (!flight) return <View style={styles.notFound}><Text style={styles.title}>Vuelo no encontrado</Text><PrimaryButton title="VOLVER" icon="arrow-back" onPress={() => router.back()} /></View>;
  const update = async (next: OperationState, action: string) => { const unsynchronized = { ...next, syncedAt: undefined }; await setJson(flightKey(flight.id), unsynchronized); await addToOutbox('operación', `${action} - ${flight.number}`, { flightId: flight.id, ...unsynchronized }); setState(unsynchronized); };
  const start = () => {
    if (!canOperateFlight(flight.flightStatus)) return Alert.alert('Operación no disponible', `No se puede iniciar mientras el vuelo esté en estado “${flight.flightStatus}”.`);
    update({ ...state, startedAt: new Date().toISOString() }, 'Inicio de atención registrado');
  };
  const end = async () => {
    const checklist = await getChecklist(flight.id);
    if (!checklist.completedAt || Object.keys(checklist.answers).length !== checklistTotal) return Alert.alert('Checklist requerido', 'Completa y guarda el checklist antes de finalizar la atención.');
    Alert.alert('Finalizar atención', '¿Confirmas que los servicios asignados fueron completados?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: () => update({ ...state, endedAt: new Date().toISOString() }, 'Fin de atención registrado') }]);
  };
  const cancelStart = () => Alert.alert(
    'Cancelar inicio de atención',
    'La operación volverá a Pendiente y se borrarán todas las respuestas guardadas en el checklist. Las incidencias se conservarán.',
    [
      { text: 'Conservar atención', style: 'cancel' },
      { text: 'Cancelar inicio', style: 'destructive', onPress: async () => { await cancelOperationStart(flight.id); setState({}); Alert.alert('Atención reiniciada', 'La operación volvió a Pendiente y el checklist quedó vacío.'); } },
    ],
  );
  const operationStatus = state.endedAt ? 'Finalizada' : state.startedAt ? 'En atención' : 'Pendiente';
  const canStart = canOperateFlight(flight.flightStatus);
  const formatDateTime = (value?: string) => value ? new Date(value).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  return <ScrollView contentContainerStyle={styles.container}>
    <Card style={styles.hero}>
      <View style={styles.row}><View><Text style={styles.flight}>{flight.number}</Text><Text style={styles.airline}>{flight.airline}</Text></View></View>
      <View style={styles.statusPanel}><View style={styles.statusBox}><Text style={styles.statusLabel}>ESTADO DEL VUELO</Text><StatusPill text={flight.flightStatus} tone={flight.flightStatus.includes('Retrasado') ? 'orange' : flight.flightStatus === 'Cancelado' ? 'red' : 'blue'} /></View><View style={styles.statusBox}><Text style={styles.statusLabel}>OPERACIÓN</Text><StatusPill text={operationStatus} tone={operationStatus === 'Finalizada' ? 'green' : operationStatus === 'En atención' ? 'orange' : 'blue'} /></View></View>
      <View style={styles.route}><View><Text style={styles.code}>{flight.origin}</Text><Text style={styles.time}>{flight.arrival}</Text></View><Ionicons name="airplane" size={28} color={colors.orange} /><View><Text style={styles.code}>{flight.destination}</Text><Text style={styles.time}>{flight.departure}</Text></View></View>
      <View style={styles.info}><Text style={styles.infoText}><Ionicons name="airplane-outline" size={16} /> {flight.aircraft}</Text><Text style={styles.infoText}><Ionicons name="location-outline" size={16} /> {flight.position}</Text></View>
    </Card>
    <Text style={styles.title}>Servicios asignados</Text>
    <Card>{flight.services.map((service, i) => <View key={service} style={[styles.service, i < flight.services.length - 1 && styles.separator]}><Ionicons name="checkmark-circle" size={22} color={colors.success} /><Text style={styles.serviceText}>{service}</Text></View>)}</Card>
    <Text style={styles.title}>Acciones operativas</Text>
    <View style={styles.actions}>
      <PrimaryButton title={state.endedAt ? 'Revisar checklist' : state.startedAt ? 'Completar checklist' : 'Checklist disponible al iniciar'} icon="clipboard-outline" onPress={() => router.push({ pathname: '/checklist/[id]', params: { id: flight.id } })} secondary disabled={!state.startedAt} />
      <PrimaryButton title="Registrar incidencia" icon="warning-outline" onPress={() => router.push({ pathname: '/incident/[id]', params: { id: flight.id } })} secondary disabled={!state.startedAt && !canStart} />
      {!state.startedAt && <PrimaryButton title="INICIAR ATENCIÓN" icon="play-circle-outline" onPress={start} disabled={!canStart} />}
      {!state.startedAt && !canStart && <View style={styles.blocked}><Ionicons name="lock-closed-outline" size={19} color={colors.warning} /><Text style={styles.blockedText}>La operación se habilitará cuando el vuelo llegue al aeropuerto o a la puerta.</Text></View>}
      {!!state.startedAt && !state.endedAt && <PrimaryButton title="FINALIZAR ATENCIÓN" icon="stop-circle-outline" onPress={end} />}
      {!!state.startedAt && !state.endedAt && <PrimaryButton title="CANCELAR INICIO DE ATENCIÓN" icon="close-circle-outline" onPress={cancelStart} danger />}
      {!!state.endedAt && <View style={styles.done}><View style={styles.doneHeader}><Ionicons name={state.syncedAt ? 'cloud-done-outline' : 'cloud-upload-outline'} size={25} color={colors.success} /><Text style={styles.doneText}>{state.syncedAt ? 'Atención completada y sincronizada.' : 'Atención completada y pendiente de sincronización.'}</Text></View><View style={styles.times}><Text style={styles.timeLabel}>Inicio</Text><Text style={styles.timeValue}>{formatDateTime(state.startedAt)}</Text><Text style={styles.timeLabel}>Finalización</Text><Text style={styles.timeValue}>{formatDateTime(state.endedAt)}</Text>{state.syncedAt && <><Text style={styles.timeLabel}>Sincronización</Text><Text style={styles.timeValue}>{formatDateTime(state.syncedAt)}</Text></>}</View></View>}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 35 }, notFound: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 }, hero: { backgroundColor: colors.navy }, row: { flexDirection: 'row', justifyContent: 'space-between' }, flight: { color: colors.white, fontSize: 26, fontWeight: '900' }, airline: { color: '#B9C9E5', marginTop: 3 }, statusPanel: { flexDirection: 'row', gap: 9, marginTop: 14 }, statusBox: { flex: 1, gap: 4 }, statusLabel: { color: '#B9C9E5', fontSize: 9, fontWeight: '800' }, route: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginVertical: 22 }, code: { color: colors.white, fontSize: 25, fontWeight: '900', textAlign: 'center' }, time: { color: '#B9C9E5', textAlign: 'center', marginTop: 4 }, info: { borderTopWidth: 1, borderTopColor: '#34558A', paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between' }, infoText: { color: colors.white }, title: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: 8 }, service: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 9 }, separator: { borderBottomWidth: 1, borderBottomColor: colors.border }, serviceText: { color: colors.ink, fontWeight: '600' }, actions: { gap: 10 }, blocked: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#FFF7E6' }, blockedText: { flex: 1, color: colors.warning, fontSize: 12, lineHeight: 17, fontWeight: '600' }, done: { gap: 12, padding: 14, borderRadius: 14, backgroundColor: '#E9F7EF' }, doneHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, doneText: { flex: 1, color: colors.success, fontWeight: '800' }, times: { borderTopWidth: 1, borderTopColor: '#C6E8D3', paddingTop: 10, gap: 3 }, timeLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginTop: 3 }, timeValue: { color: colors.ink, fontWeight: '700' },
});
