import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';
import { useFocusEffect } from 'expo-router';
import { Card, PrimaryButton, StatusPill } from '../components/ui';
import { clearOutbox, getOutbox, OutboxItem } from '../storage/prototype-storage';
import { colors } from '../theme/colors';

export default function SyncScreen() {
  const [items, setItems] = useState<OutboxItem[]>([]); const [online, setOnline] = useState<boolean>(); const [refreshing, setRefreshing] = useState(false); const [syncing, setSyncing] = useState(false);
  const load = async () => { const [queue, network] = await Promise.all([getOutbox(), Network.getNetworkStateAsync()]); setItems(queue); setOnline(Boolean(network.isConnected && network.isInternetReachable !== false)); };
  useFocusEffect(useCallback(() => { load(); }, []));
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const sync = async () => { if (!online) return Alert.alert('Sin conexión', 'Los registros permanecerán guardados hasta recuperar internet.'); setSyncing(true); await new Promise(resolve => setTimeout(resolve, 1200)); await clearOutbox(); setItems([]); setSyncing(false); Alert.alert('Sincronización completada', 'La demo marcó todos los registros como enviados.'); };
  return <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
    <Card style={[styles.connection, { borderColor: online ? colors.success : colors.warning }]}><Ionicons name={online ? 'wifi' : 'cloud-offline-outline'} size={30} color={online ? colors.success : colors.warning} /><View style={styles.flex}><Text style={styles.connectionTitle}>{online ? 'Conexión disponible' : 'Modo offline'}</Text><Text style={styles.muted}>{online ? 'Los registros pueden sincronizarse.' : 'La información continúa guardada en el dispositivo.'}</Text></View><StatusPill text={online ? 'En línea' : 'Sin conexión'} tone={online ? 'green' : 'orange'} /></Card>
    <View><Text style={styles.title}>Cola pendiente</Text><Text style={styles.muted}>{items.length} registros almacenados localmente</Text></View>
    {items.length === 0 ? <View style={styles.empty}><Ionicons name="cloud-done-outline" size={58} color={colors.success} /><Text style={styles.emptyTitle}>Todo está sincronizado</Text><Text style={styles.muted}>No existen operaciones pendientes.</Text></View> : items.map(item => <Card key={item.id} style={styles.item}><View style={styles.icon}><Ionicons name={item.type === 'incidencia' ? 'warning-outline' : item.type === 'checklist' ? 'clipboard-outline' : 'airplane-outline'} size={22} color={colors.navy} /></View><View style={styles.flex}><Text style={styles.itemType}>{item.type.toUpperCase()}</Text><Text style={styles.itemSummary}>{item.summary}</Text><Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text></View><StatusPill text="Pendiente" tone="orange" /></Card>)}
    {!!items.length && <PrimaryButton title={syncing ? 'SINCRONIZANDO...' : 'SINCRONIZAR AHORA'} icon="sync-outline" onPress={sync} disabled={syncing} />}
    <Text style={styles.note}>En este prototipo la sincronización es simulada. La integración real se conectará posteriormente con la API de ELEVANT.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 13, paddingBottom: 35 }, connection: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5 }, flex: { flex: 1 }, connectionTitle: { color: colors.ink, fontWeight: '900' }, muted: { color: colors.muted, fontSize: 13, marginTop: 3 }, title: { color: colors.ink, fontSize: 20, fontWeight: '900' }, item: { flexDirection: 'row', alignItems: 'center', gap: 11 }, icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.paleBlue, alignItems: 'center', justifyContent: 'center' }, itemType: { color: colors.navy, fontSize: 11, fontWeight: '900' }, itemSummary: { color: colors.ink, fontWeight: '700', marginTop: 2 }, date: { color: colors.muted, fontSize: 11, marginTop: 3 }, empty: { alignItems: 'center', paddingVertical: 45 }, emptyTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: 10 }, note: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 17 },
});
