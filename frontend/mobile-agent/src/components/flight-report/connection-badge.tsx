import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { flushFlightReport, refreshFlightReportQueue, subscribeFlightReport } from '../../services/flight-report';
import { colors } from '../../theme/colors';
import { radius, space, touch } from '../../theme/tokens';

/**
 * Starts the Flight Report sync for the session: reads the queue, and sends it again the moment
 * the tablet recovers signal (ADR-0031). Returns the stop function.
 */
export function startFlightReportSync() {
  void refreshFlightReportQueue().then(() => flushFlightReport()).catch(() => {});
  let wasOnline = true;
  return NetInfo.addEventListener(state => {
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    if (online && !wasOnline) void flushFlightReport();
    wasOnline = online;
  });
}

/** Always-visible connection and queue state; tapping opens «Sincronización». */
export function ConnectionBadge() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => NetInfo.addEventListener(state =>
    setOnline(state.isConnected !== false && state.isInternetReachable !== false)), []);
  useEffect(() => subscribeFlightReport(snapshot => {
    setPending(snapshot.items.filter(item => item.state === 'pending').length);
    setBlocked(snapshot.items.filter(item => item.state === 'blocked').length);
    setSyncing(snapshot.syncing);
  }), []);
  const tone = blocked > 0 ? 'blocked' : !online ? 'offline' : pending > 0 || syncing ? 'syncing' : 'online';
  const look = {
    online: { bg: '#E6F4EC', fg: colors.success, icon: 'cloud-done-outline' as const, text: 'En línea' },
    syncing: { bg: colors.paleBlue, fg: colors.navy, icon: 'sync' as const, text: `Enviando ${pending}` },
    offline: { bg: colors.paleOrange, fg: colors.warning, icon: 'cloud-offline-outline' as const,
      text: pending ? `Sin señal · ${pending} en el dispositivo` : 'Sin señal' },
    blocked: { bg: '#FBEAEA', fg: colors.danger, icon: 'alert-circle' as const, text: `${blocked} por revisar` },
  }[tone];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${look.text}. Abrir sincronización`}
      onPress={() => router.push('/sync')} style={[styles.badge, { backgroundColor: look.bg }]}>
      <Ionicons name={look.icon} size={18} color={look.fg} />
      <Text style={[styles.text, { color: look.fg }]}>{look.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { minHeight: touch.min - 12, flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start',
    borderRadius: radius.pill, paddingHorizontal: space.md },
  text: { fontSize: 13, fontWeight: '800' },
});
