import { useCallback, useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { Card, StatusPill } from '../components/ui';
import { checklistSections, flights, Flight } from '../data/mock';
import { colors } from '../theme/colors';
import { getOperationState, getOutbox, OperationState } from '../storage/prototype-storage';
import { exitApplication } from '../utils/app-exit';
import { getMobileSession, logoutMobileAgent, MobileAgent } from '../services/mobile-auth';

export default function HomeScreen() {
  const [pending, setPending] = useState(0);
  const [operationStates, setOperationStates] = useState<Record<string, OperationState>>({});
  const [profileVisible, setProfileVisible] = useState(false);
  const [agent, setAgent] = useState<MobileAgent | null>(null);
  useFocusEffect(useCallback(() => {
    const checklistTotal = checklistSections.reduce((sum, section) => sum + section.items.length, 0);
    Promise.all([getOutbox(), getMobileSession(), ...flights.map(flight => getOperationState(flight.id, checklistTotal))]).then(([queue, session, ...states]) => {
      setPending(queue.length);
      setAgent(session?.user ?? null);
      setOperationStates(Object.fromEntries(flights.map((flight, index) => [flight.id, states[index]])));
    });
  }, []));
  const renderFlight = ({ item }: { item: Flight }) => <Pressable onPress={() => router.push({ pathname: '/flight/[id]', params: { id: item.id } })}>
    <Card style={styles.flightCard}>
      <View style={styles.row}><View><Text style={styles.flightNo}>{item.number}</Text><Text style={styles.airline}>{item.airline}</Text></View><View style={styles.statuses}><View style={styles.statusLine}><Text style={styles.statusLabel}>Vuelo</Text><StatusPill text={item.flightStatus} tone={item.flightStatus.includes('Retrasado') ? 'orange' : item.flightStatus === 'Cancelado' ? 'red' : 'blue'} /></View>{(() => { const state = operationStates[item.id]; const status = state?.endedAt ? 'Finalizada' : state?.startedAt ? 'En atención' : 'Pendiente'; return <View style={styles.statusLine}><Text style={styles.statusLabel}>Operación</Text><StatusPill text={status} tone={status === 'Finalizada' ? 'green' : status === 'En atención' ? 'orange' : 'blue'} /></View>; })()}</View></View>
      <View style={styles.route}><Text style={styles.airport}>{item.origin}</Text><View style={styles.line}><Ionicons name="airplane" size={20} color={colors.orange} /></View><Text style={styles.airport}>{item.destination}</Text></View>
      <View style={styles.meta}><Text style={styles.metaText}><Ionicons name="time-outline" size={15} /> {item.arrival}</Text><Text style={styles.metaText}><Ionicons name="location-outline" size={15} /> {item.position}</Text><Ionicons name="chevron-forward" size={20} color={colors.navy} /></View>
    </Card>
  </Pressable>;
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><View><Text style={styles.hello}>Buenos días,</Text><Text style={styles.name}>{agent?.name ?? 'Agente de Rampa'}</Text></View><Pressable accessibilityLabel="Abrir menú del agente" onPress={() => setProfileVisible(true)} style={styles.avatar}><Image source={require('../../assets/images/elevant-symbol.png')} style={styles.avatarImage} /></Pressable></View>
    <View style={styles.quickRow}>
      <Pressable style={styles.quick} onPress={() => router.push('/sync')}><Ionicons name={pending ? 'cloud-offline-outline' : 'cloud-done-outline'} size={25} color={pending ? colors.orange : colors.success} /><View><Text style={styles.quickTitle}>{pending} pendientes</Text><Text style={styles.quickText}>Sincronización</Text></View></Pressable>
      <Pressable style={styles.quick} onPress={() => router.push('/chat')}><Ionicons name="chatbubbles-outline" size={25} color={colors.blue} /><View style={styles.quickCopy}><Text style={styles.quickTitle}>Chat con OCC</Text><Text style={styles.quickText}>Apoyo en tiempo real</Text></View><View style={styles.onlineDot} /></Pressable>
    </View>
    <View style={styles.sectionRow}><View><Text style={styles.sectionTitle}>Vuelos asignados</Text><Text style={styles.sectionSub}>Operaciones programadas para hoy</Text></View><StatusPill text={`${flights.length} vuelos`} /></View>
    <FlatList data={flights} keyExtractor={x => x.id} renderItem={renderFlight} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} />
    <Modal visible={profileVisible} transparent animationType="fade" onRequestClose={() => setProfileVisible(false)}><Pressable style={styles.overlay} onPress={() => setProfileVisible(false)}><Pressable style={styles.profileCard} onPress={() => undefined}><Image source={require('../../assets/images/elevant-symbol.png')} style={styles.profileLogo} /><Text style={styles.profileName}>{agent?.name ?? 'Agente de Rampa'}</Text><Text style={styles.profileUser}>{agent?.email ?? 'Cuenta de agente'} · AVIAM</Text><Text style={styles.profileNote}>La información y las credenciales son administradas por AVIAM.</Text><Pressable style={styles.menuButton} onPress={async () => { setProfileVisible(false); await logoutMobileAgent(); router.replace('/'); }}><Ionicons name="log-out-outline" size={21} color={colors.navy} /><Text style={styles.menuButtonText}>Cerrar sesión</Text></Pressable><Pressable style={[styles.menuButton, styles.exitButton]} onPress={() => { setProfileVisible(false); exitApplication(); }}><Ionicons name="exit-outline" size={21} color={colors.danger} /><Text style={[styles.menuButtonText, styles.exitText]}>Salir de la aplicación</Text></Pressable></Pressable></Pressable></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, header: { backgroundColor: colors.navy, padding: 22, paddingTop: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }, hello: { color: '#B9C9E5', fontSize: 14 }, name: { color: colors.white, fontSize: 23, fontWeight: '900', marginTop: 3 }, avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.orange, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, avatarImage: { width: 48, height: 48 },
  quickRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginTop: 16 }, quick: { flex: 1, minWidth: 0, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, quickCopy: { flex: 1 }, onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }, quickTitle: { color: colors.ink, fontWeight: '800', fontSize: 12 }, quickText: { color: colors.muted, fontSize: 10, marginTop: 2 },
  sectionRow: { paddingHorizontal: 18, marginTop: 22, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { color: colors.ink, fontWeight: '900', fontSize: 20 }, sectionSub: { color: colors.muted, fontSize: 12, marginTop: 3 }, list: { padding: 16, paddingTop: 4, gap: 12, paddingBottom: 30 }, flightCard: { gap: 14 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, statuses: { alignItems: 'flex-end', gap: 6, flexShrink: 1 }, statusLine: { alignItems: 'flex-end', gap: 2 }, statusLabel: { color: colors.muted, fontSize: 9, fontWeight: '700' }, flightNo: { color: colors.navy, fontWeight: '900', fontSize: 22 }, airline: { color: colors.muted, fontSize: 13, marginTop: 2 }, route: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }, airport: { fontSize: 20, fontWeight: '900', color: colors.ink }, line: { width: 100, borderBottomWidth: 1, borderColor: colors.border, alignItems: 'center', paddingBottom: 3 }, meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }, metaText: { color: colors.muted, fontSize: 13 }, overlay: { flex: 1, backgroundColor: 'rgba(8,28,58,0.48)', alignItems: 'center', justifyContent: 'center', padding: 24 }, profileCard: { width: '100%', maxWidth: 360, backgroundColor: colors.white, borderRadius: 22, padding: 22, alignItems: 'center', gap: 9 }, profileLogo: { width: 88, height: 88, borderRadius: 18 }, profileName: { color: colors.navy, fontSize: 20, fontWeight: '900' }, profileUser: { color: colors.muted, fontWeight: '700' }, profileNote: { color: colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 17, marginBottom: 7 }, menuButton: { width: '100%', minHeight: 50, borderRadius: 13, borderWidth: 1, borderColor: colors.navy, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, menuButtonText: { color: colors.navy, fontWeight: '800' }, exitButton: { borderColor: colors.danger }, exitText: { color: colors.danger },
});
