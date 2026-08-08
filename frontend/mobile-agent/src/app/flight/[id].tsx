import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Card, PrimaryButton, StatusPill } from '../../components/ui';
import { flights } from '../../data/mock';
import { addToOutbox, flightKey, getJson, setJson } from '../../storage/prototype-storage';
import { colors } from '../../theme/colors';

type OperationState = { startedAt?: string; endedAt?: string };
export default function FlightDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const flight = flights.find(x => x.id === id) ?? flights[0];
  const [state, setState] = useState<OperationState>({});
  useFocusEffect(useCallback(() => { getJson<OperationState>(flightKey(flight.id), {}).then(setState); }, [flight.id]));
  const update = async (next: OperationState, action: string) => { await setJson(flightKey(flight.id), next); await addToOutbox('operación', `${action} - ${flight.number}`); setState(next); };
  const start = () => update({ ...state, startedAt: new Date().toISOString() }, 'Inicio de atención registrado');
  const end = () => Alert.alert('Finalizar atención', '¿Confirmas que los servicios asignados fueron completados?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: () => update({ ...state, endedAt: new Date().toISOString() }, 'Fin de atención registrado') }]);
  return <ScrollView contentContainerStyle={styles.container}>
    <Card style={styles.hero}>
      <View style={styles.row}><View><Text style={styles.flight}>{flight.number}</Text><Text style={styles.airline}>{flight.airline}</Text></View><StatusPill text={state.endedAt ? 'Finalizado' : state.startedAt ? 'En atención' : flight.status} tone={state.endedAt ? 'green' : state.startedAt ? 'orange' : 'blue'} /></View>
      <View style={styles.route}><View><Text style={styles.code}>{flight.origin}</Text><Text style={styles.time}>{flight.arrival}</Text></View><Ionicons name="airplane" size={28} color={colors.orange} /><View><Text style={styles.code}>{flight.destination}</Text><Text style={styles.time}>{flight.departure}</Text></View></View>
      <View style={styles.info}><Text style={styles.infoText}><Ionicons name="airplane-outline" size={16} /> {flight.aircraft}</Text><Text style={styles.infoText}><Ionicons name="location-outline" size={16} /> {flight.position}</Text></View>
    </Card>
    <Text style={styles.title}>Servicios asignados</Text>
    <Card>{flight.services.map((service, i) => <View key={service} style={[styles.service, i < flight.services.length - 1 && styles.separator]}><Ionicons name="checkmark-circle" size={22} color={colors.success} /><Text style={styles.serviceText}>{service}</Text></View>)}</Card>
    <Text style={styles.title}>Acciones operativas</Text>
    <View style={styles.actions}>
      <PrimaryButton title="Completar checklist" icon="clipboard-outline" onPress={() => router.push({ pathname: '/checklist/[id]', params: { id: flight.id } })} secondary />
      <PrimaryButton title="Registrar incidencia" icon="warning-outline" onPress={() => router.push({ pathname: '/incident/[id]', params: { id: flight.id } })} secondary />
      {!state.startedAt && <PrimaryButton title="INICIAR ATENCIÓN" icon="play-circle-outline" onPress={start} />}
      {!!state.startedAt && !state.endedAt && <PrimaryButton title="FINALIZAR ATENCIÓN" icon="stop-circle-outline" onPress={end} />}
      {!!state.endedAt && <View style={styles.done}><Ionicons name="checkmark-circle" size={25} color={colors.success} /><Text style={styles.doneText}>Atención completada y pendiente de sincronización.</Text></View>}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 35 }, hero: { backgroundColor: colors.navy }, row: { flexDirection: 'row', justifyContent: 'space-between' }, flight: { color: colors.white, fontSize: 26, fontWeight: '900' }, airline: { color: '#B9C9E5', marginTop: 3 }, route: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginVertical: 22 }, code: { color: colors.white, fontSize: 25, fontWeight: '900', textAlign: 'center' }, time: { color: '#B9C9E5', textAlign: 'center', marginTop: 4 }, info: { borderTopWidth: 1, borderTopColor: '#34558A', paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between' }, infoText: { color: colors.white }, title: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: 8 }, service: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 9 }, separator: { borderBottomWidth: 1, borderBottomColor: colors.border }, serviceText: { color: colors.ink, fontWeight: '600' }, actions: { gap: 10 }, done: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: '#E9F7EF' }, doneText: { flex: 1, color: colors.success, fontWeight: '700' },
});
