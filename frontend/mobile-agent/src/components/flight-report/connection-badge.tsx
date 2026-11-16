import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  currentFlightReportSnapshot,
  flushFlightReport,
  refreshFlightReportQueue,
  subscribeFlightReport,
} from '../../services/flight-report';
import { flushPendingRampIncidents } from '../../services/ramp-incidents';
import { clockSkewWarning, loadServerClock, subscribeServerClock } from '../../synchronization/server-clock';
import { colors } from '../../theme/colors';
import { radius, space, touch } from '../../theme/tokens';

/** While something waits on the device, the queue is tried again this often even if no event arrives (3-I). */
export const FLIGHT_REPORT_RETRY_MS = 60_000;

/** The Flight Report queue first (the start goes before anything of its operation), then the incident reports. */
function sendEverything() {
  return flushFlightReport().catch(() => {}).then(() => flushPendingRampIncidents()).catch(() => {});
}

/**
 * Starts the device's sync for the session (ADR-0031, 3-I): reads the queue and sends it at once, again the moment
 * the tablet recovers signal or returns to the foreground, and every minute while something still waits; the incident
 * reports go right after. Returns the stop function.
 */
export function startFlightReportSync() {
  void loadServerClock();
  void refreshFlightReportQueue().catch(() => {}).then(sendEverything);
  let wasOnline = true;
  const stopNetInfo = NetInfo.addEventListener(state => {
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    if (online && !wasOnline) void sendEverything();
    wasOnline = online;
  });
  const foreground = AppState.addEventListener('change', state => {
    if (state === 'active') void sendEverything();
  });
  const timer = setInterval(() => {
    if (currentFlightReportSnapshot().items.some(item => item.state === 'pending')) void sendEverything();
  }, FLIGHT_REPORT_RETRY_MS);
  return () => {
    stopNetInfo();
    foreground.remove();
    clearInterval(timer);
  };
}

/**
 * Always-visible connection and queue state; tapping opens «Sincronización». While the tablet's clock is off by more
 * than ELEVANT tolerates, a notice says so (3-N18): the captured times are corrected anyway.
 */
export function ConnectionBadge() {
  const [online, setOnline] = useState(true);
  const [clockOffset, setClockOffset] = useState(0);
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
  useEffect(() => subscribeServerClock(setClockOffset), []);
  const clockWarning = clockSkewWarning(clockOffset);
  const tone = blocked > 0 ? 'blocked' : !online ? 'offline' : pending > 0 || syncing ? 'syncing' : 'online';
  const look = {
    online: { bg: '#E6F4EC', fg: colors.success, icon: 'cloud-done-outline' as const, text: 'En línea' },
    syncing: { bg: colors.paleBlue, fg: colors.navy, icon: 'sync' as const, text: `Enviando ${pending}` },
    offline: { bg: colors.paleOrange, fg: colors.warning, icon: 'cloud-offline-outline' as const,
      text: pending ? `Sin señal · ${pending} en el dispositivo` : 'Sin señal' },
    blocked: { bg: '#FBEAEA', fg: colors.danger, icon: 'alert-circle' as const, text: `${blocked} por revisar` },
  }[tone];
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${look.text}. Abrir sincronización`}
        onPress={() => router.push('/sync')} style={[styles.badge, { backgroundColor: look.bg }]}>
        <Ionicons name={look.icon} size={18} color={look.fg} />
        <Text style={[styles.text, { color: look.fg }]}>{look.text}</Text>
      </Pressable>
      {clockWarning ? (
        <View accessibilityLiveRegion="polite" style={styles.clock}>
          <Ionicons name="time-outline" size={18} color={colors.warning} />
          <Text style={styles.clockText}>{clockWarning}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  badge: { minHeight: touch.min - 12, flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start',
    borderRadius: radius.pill, paddingHorizontal: space.md },
  text: { fontSize: 13, fontWeight: '800' },
  clock: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md,
    backgroundColor: colors.paleOrange },
  clockText: { flex: 1, color: colors.warning, fontSize: 13, fontWeight: '700' },
});
