import { useCallback, useState } from 'react';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { Card, StatusPill } from '../components/ui';
import { flights, Flight } from '../data/mock';
import { colors } from '../theme/colors';
import { getOutbox } from '../storage/prototype-storage';

export default function HomeScreen() {
  const [pending, setPending] = useState(0);
  useFocusEffect(useCallback(() => { getOutbox().then(x => setPending(x.length)); }, []));
  const renderFlight = ({ item }: { item: Flight }) => <Pressable onPress={() => router.push({ pathname: '/flight/[id]', params: { id: item.id } })}>
    <Card style={styles.flightCard}>
      <View style={styles.row}><View><Text style={styles.flightNo}>{item.number}</Text><Text style={styles.airline}>{item.airline}</Text></View><StatusPill text={item.status} tone={item.status === 'En atención' ? 'green' : item.status === 'Retrasado' ? 'orange' : 'blue'} /></View>
      <View style={styles.route}><Text style={styles.airport}>{item.origin}</Text><View style={styles.line}><Ionicons name="airplane" size={20} color={colors.orange} /></View><Text style={styles.airport}>{item.destination}</Text></View>
      <View style={styles.meta}><Text style={styles.metaText}><Ionicons name="time-outline" size={15} /> {item.arrival}</Text><Text style={styles.metaText}><Ionicons name="location-outline" size={15} /> {item.position}</Text><Ionicons name="chevron-forward" size={20} color={colors.navy} /></View>
    </Card>
  </Pressable>;
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><View><Text style={styles.hello}>Buenos días,</Text><Text style={styles.name}>Agente de Rampa</Text></View><Pressable style={styles.avatar}><Ionicons name="person" size={22} color={colors.white} /></Pressable></View>
    <View style={styles.quickRow}>
      <Pressable style={styles.quick} onPress={() => router.push('/sync')}><Ionicons name={pending ? 'cloud-offline-outline' : 'cloud-done-outline'} size={25} color={pending ? colors.orange : colors.success} /><View><Text style={styles.quickTitle}>{pending} pendientes</Text><Text style={styles.quickText}>Sincronización</Text></View></Pressable>
      <View style={styles.quick}><Ionicons name="shield-checkmark-outline" size={25} color={colors.blue} /><View><Text style={styles.quickTitle}>Turno activo</Text><Text style={styles.quickText}>14:00 - 22:00</Text></View></View>
    </View>
    <View style={styles.sectionRow}><View><Text style={styles.sectionTitle}>Vuelos asignados</Text><Text style={styles.sectionSub}>Operaciones programadas para hoy</Text></View><StatusPill text={`${flights.length} vuelos`} /></View>
    <FlatList data={flights} keyExtractor={x => x.id} renderItem={renderFlight} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, header: { backgroundColor: colors.navy, padding: 22, paddingTop: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }, hello: { color: '#B9C9E5', fontSize: 14 }, name: { color: colors.white, fontSize: 23, fontWeight: '900', marginTop: 3 }, avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  quickRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginTop: 16 }, quick: { flex: 1, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9 }, quickTitle: { color: colors.ink, fontWeight: '800', fontSize: 13 }, quickText: { color: colors.muted, fontSize: 11, marginTop: 2 },
  sectionRow: { paddingHorizontal: 18, marginTop: 22, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { color: colors.ink, fontWeight: '900', fontSize: 20 }, sectionSub: { color: colors.muted, fontSize: 12, marginTop: 3 }, list: { padding: 16, paddingTop: 4, gap: 12, paddingBottom: 30 }, flightCard: { gap: 14 }, row: { flexDirection: 'row', justifyContent: 'space-between' }, flightNo: { color: colors.navy, fontWeight: '900', fontSize: 22 }, airline: { color: colors.muted, fontSize: 13, marginTop: 2 }, route: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }, airport: { fontSize: 20, fontWeight: '900', color: colors.ink }, line: { width: 100, borderBottomWidth: 1, borderColor: colors.border, alignItems: 'center', paddingBottom: 3 }, meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }, metaText: { color: colors.muted, fontSize: 13 },
});
