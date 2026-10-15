import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/ui';
import { useConnectivity } from '../hooks/use-connectivity';
import {
  readSyncSnapshot,
  synchronizePendingWork,
  type SyncItem,
  type SyncSnapshot,
} from '../services/mobile-sync-center';
import { colors } from '../theme/colors';

export default function SyncScreen() {
  const connectivity = useConnectivity();
  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSnapshot(await readSyncSnapshot());
    } catch {
      setError('No pudimos leer la cola protegida de este agente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]));

  const synchronize = async () => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setSyncing(true);
    setError('');
    try {
      setSnapshot(await synchronizePendingWork(request.signal));
    } catch {
      if (!request.signal.aborted) setError('La sincronización no terminó. Los registros siguen guardados para reintentar.');
    } finally {
      if (!request.signal.aborted) setSyncing(false);
    }
  };

  const pending = snapshot?.items.filter(item => item.state === 'pending').length ?? 0;
  const intervention = snapshot?.items.filter(item => item.state !== 'pending').length ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <View style={styles.summary}>
        <View style={[styles.networkBadge, connectivity === 'offline' && styles.networkOffline]}>
          <Ionicons
            name={connectivity === 'offline' ? 'cloud-offline-outline' : 'cloud-done-outline'}
            size={18}
            color={connectivity === 'offline' ? colors.warning : colors.success}
          />
          <Text style={styles.networkText}>
            {connectivity === 'offline' ? 'Sin conexión' : connectivity === 'online' ? 'Conectado' : 'Comprobando red'}
          </Text>
        </View>
        <Text accessibilityRole="header" style={styles.title}>Centro de sincronización</Text>
        <Text style={styles.description}>
          Los intentos se conservan con la misma clave de idempotencia y se reintentan automáticamente al recuperar conexión.
        </Text>
        <View style={styles.counters}>
          <Counter label="Pendientes" value={pending} color={colors.warning} />
          <Counter label="Revisar" value={intervention} color={colors.danger} />
        </View>
        {snapshot?.localDevelopment && (
          <View style={styles.localNotice}>
            <Ionicons name="construct-outline" size={19} color={colors.warning} />
            <Text style={styles.localNoticeText}>
              Sesión local activa. La cola puede inspeccionarse, pero no se enviará hasta usar una cuenta del servidor.
            </Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Leyendo cola de sincronización" color={colors.navy} size="large" />
        </View>
      ) : snapshot?.items.length ? (
        <FlatList
          contentContainerStyle={styles.list}
          data={snapshot.items}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <SyncRow item={item} />}
        />
      ) : (
        <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="checkmark-done" size={34} color={colors.success} /></View>
          <Text style={styles.emptyTitle}>Todo está sincronizado</Text>
          <Text style={styles.emptyText}>No hay comandos operativos esperando confirmación.</Text>
        </View>
      )}

      {!!error && <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <PrimaryButton
          title={syncing ? 'SINCRONIZANDO…' : 'SINCRONIZAR AHORA'}
          icon="sync-outline"
          onPress={() => void synchronize()}
          disabled={syncing || connectivity === 'offline' || snapshot?.localDevelopment === true}
        />
        <PrimaryButton title="ACTUALIZAR ESTADO" icon="refresh-outline" onPress={() => void load()} secondary />
      </View>
    </SafeAreaView>
  );
}

function Counter({ color, label, value }: { color: string; label: string; value: number }) {
  return <View style={styles.counter}>
    <Text style={[styles.counterValue, { color }]}>{value}</Text>
    <Text style={styles.counterLabel}>{label}</Text>
  </View>;
}

function SyncRow({ item }: { item: SyncItem }) {
  const blocked = item.state !== 'pending';
  return <View style={styles.row}>
    <View style={[styles.rowIcon, blocked && styles.rowIconBlocked]}>
      <Ionicons name={blocked ? 'alert-circle-outline' : 'time-outline'} size={22} color={blocked ? colors.danger : colors.warning} />
    </View>
    <View style={styles.rowCopy}>
      <Text style={styles.rowTitle}>{item.label}</Text>
      <Text style={styles.rowMeta}>
        {blocked ? 'Requiere revisión desde la operación' : 'Pendiente de confirmación'}
      </Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  summary: { padding: 20, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  networkBadge: { alignSelf: 'flex-start', flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: '#F1FBF5', borderRadius: 14, paddingHorizontal: 10, minHeight: 28 },
  networkOffline: { backgroundColor: '#FFF8EA' },
  networkText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 24, fontWeight: '900', marginTop: 14 },
  description: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  counters: { flexDirection: 'row', gap: 12, marginTop: 16 },
  counter: { flex: 1, borderRadius: 14, backgroundColor: colors.background, padding: 13 },
  counterValue: { fontSize: 24, fontWeight: '900' },
  counterLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: 2 },
  localNotice: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 11, borderRadius: 12, backgroundColor: '#FFF8EA', marginTop: 14 },
  localNoticeText: { flex: 1, color: colors.warning, fontSize: 11, fontWeight: '700', lineHeight: 16 },
  list: { padding: 16, paddingBottom: 130, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 13, backgroundColor: colors.white },
  rowIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8EA' },
  rowIconBlocked: { backgroundColor: '#FFF1F0' },
  rowCopy: { flex: 1 },
  rowTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  rowMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 10 },
  emptyIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#F1FBF5', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 12, fontWeight: '700', paddingHorizontal: 18, paddingBottom: 8 },
  actions: { position: 'absolute', left: 16, right: 16, bottom: 16, gap: 8 },
});
