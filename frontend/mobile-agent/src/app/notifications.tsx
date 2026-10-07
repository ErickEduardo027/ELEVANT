import type { OperationalNotificationResponse } from '@elevant/api-client';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/ui';
import { MobileServiceError } from '../services/mobile-service-error';
import { subscribeMobileChanges } from '../services/mobile-change-feed';
import { getOperationalNotifications, setOperationalNotificationRead } from '../services/operational-communication';
import { colors } from '../theme/colors';
import { resetToLogin } from '../utils/session-navigation';
import { formatLocalDateTime } from '../utils/date-format';
import { startForegroundInterval } from '../utils/foreground-interval';

const titles: Record<string, string> = {
  operation_submitted: 'Operación entregada a OCC',
  operation_approved: 'OCC aprobó tu operación',
  operation_returned: 'OCC devolvió tu operación',
  agent_message: 'Mensaje del agente',
  occ_message: 'Nuevo mensaje de OCC',
};

export default function NotificationsScreen() {
  const [items, setItems] = useState<readonly OperationalNotificationResponse[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState('');

  useFocusEffect(useCallback(() => subscribeMobileChanges(resources => {
    if (resources.includes('notifications')) setRevision(value => value + 1);
  }), []));

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await getOperationalNotifications(controller.signal);
        if (!controller.signal.aborted) { setItems(result.notifications); setStatus('ready'); }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof MobileServiceError && (error.code === 'unauthenticated' || error.code === 'session_expired')) resetToLogin('session_expired');
        else if (error instanceof MobileServiceError && error.code === 'forbidden') resetToLogin('access_revoked');
        setStatus('error');
      }
    };
    // Solo la primera carga muestra el indicador; después se revalida en sitio.
    setStatus(current => (current === 'ready' ? current : 'loading'));
    void load();
    const stopPolling = startForegroundInterval(() => void load(), 20_000);
    return () => { controller.abort(); stopPolling(); };
    // A retry changes revision to restart this focus-scoped request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]));

  const toggle = useCallback(async (item: OperationalNotificationResponse) => {
    setBusyId(item.id); setWriteError('');
    try {
      const updated = await setOperationalNotificationRead(item.id, !item.readAt);
      setItems(previous => previous.map(current => current.id === updated.id ? updated : current));
    } catch (error) {
      setWriteError(error instanceof MobileServiceError ? error.message : 'No se pudo guardar la lectura.');
    } finally { setBusyId(null); }
  }, []);
  const unreadCount = useMemo(() => items.filter(item => !item.readAt).length, [items]);
  const renderItem = useCallback(({ item }: { item: OperationalNotificationResponse }) => <NotificationCard item={item} busy={busyId === item.id} onToggle={toggle} />, [busyId, toggle]);

  return <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
    <View style={styles.header}><Text style={styles.title}>Notificaciones</Text><Text style={styles.subtitle}>Avisos persistentes de tus operaciones</Text></View>
    {status === 'loading' ? <ActivityIndicator color={colors.navy} style={styles.loading} /> : status === 'error' ? <View style={styles.notice}><Text>No fue posible cargar las notificaciones.</Text><PrimaryButton title="REINTENTAR" onPress={() => setRevision(value => value + 1)} secondary /></View> : <FlatList contentContainerStyle={styles.list} data={items} keyExtractor={notificationKey} renderItem={renderItem}
      ListHeaderComponent={<View style={styles.listHeader}><Text style={styles.count}>{unreadCount} sin leer</Text>{writeError ? <Text style={styles.error}>{writeError}</Text> : null}</View>}
      ListEmptyComponent={<Text style={styles.empty}>Todavía no hay avisos para tu cuenta.</Text>} />}
  </SafeAreaView>;
}

const notificationKey = (item: OperationalNotificationResponse) => item.id;

const NotificationCard = memo(function NotificationCard({ item, busy, onToggle }: Readonly<{ item: OperationalNotificationResponse; busy: boolean; onToggle: (item: OperationalNotificationResponse) => void }>) {
  return <View style={[styles.card, !item.readAt && styles.unread]}>
    <Text style={styles.cardTitle}>{titles[item.kind] ?? 'Evento operativo'}</Text><Text>{item.operationCode} · {item.stationCode}</Text><Text style={styles.date}>{formatLocalDateTime(item.occurredAt)}</Text>
    <View style={styles.actions}><Pressable accessibilityRole="button" onPress={() => item.kind === 'occ_message' || item.kind === 'agent_message' ? router.push({ pathname: '/chat', params: { operationId: item.operationId } }) : router.push({ pathname: '/flight/[id]', params: { id: item.operationId } })} style={styles.open}><Text style={styles.openText}>ABRIR</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => onToggle(item)} style={styles.read}><Text style={styles.readText}>{item.readAt ? 'MARCAR NO LEÍDA' : 'MARCAR LEÍDA'}</Text></Pressable></View>
  </View>;
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: 18, backgroundColor: colors.navy },
  title: { color: colors.white, fontSize: 22, fontWeight: '900' },
  subtitle: { color: '#D5E2F5', fontSize: 12, marginTop: 4 },
  loading: { marginTop: 40 },
  notice: { padding: 20, gap: 12 },
  list: { padding: 14, gap: 10 },
  listHeader: { gap: 6 },
  count: { fontWeight: '800', color: colors.navy },
  empty: { textAlign: 'center', color: colors.muted, padding: 20 },
  error: { color: colors.danger },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, backgroundColor: colors.white, gap: 4 },
  unread: { borderColor: colors.blue, backgroundColor: colors.paleBlue },
  cardTitle: { fontWeight: '800', color: colors.navy, fontSize: 15 },
  date: { fontSize: 12, color: colors.muted },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  open: { minHeight: 44, borderRadius: 9, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: colors.navy },
  openText: { color: colors.white, fontWeight: '800' },
  read: { minHeight: 44, borderRadius: 9, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: colors.navy },
  readText: { color: colors.navy, fontWeight: '800', fontSize: 11 },
});
