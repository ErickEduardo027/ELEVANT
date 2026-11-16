import { View } from 'react-native';
import { startMobilePresence, stopMobilePresence, refreshMobilePresenceSession, recordMobilePresenceActivity } from '../services/mobile-presence';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { startMobileChangeFeed, stopMobileChangeFeed } from '../services/mobile-change-feed';
import { colors } from '../theme/colors';
import { startFlightReportSync } from '../components/flight-report/connection-badge';
import { refreshFlightReportQueue } from '../services/flight-report';

export default function RootLayout() {
  const pathname = usePathname();
  useEffect(() => { void refreshMobilePresenceSession(); void refreshFlightReportQueue().catch(() => {}); }, [pathname]);
  useEffect(() => {
    startMobileChangeFeed();
    startMobilePresence();
    // The Flight Report queue goes out on its own when the tablet recovers signal (ADR-0031).
    const stopFlightReportSync = startFlightReportSync();
    return () => { stopMobileChangeFeed(); stopMobilePresence(); stopFlightReportSync(); };
  }, []);
  return <View style={{ flex: 1 }} accessible={false} onTouchStart={recordMobilePresenceActivity}>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.white }, headerTintColor: colors.navy, headerTitleStyle: { fontWeight: '800' }, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="flight/[id]" options={{ title: 'Manifiesto operativo' }} />
      <Stack.Screen name="checklist/[id]" options={{ title: 'Checklist operativo' }} />
      <Stack.Screen name="incident/[id]" options={{ title: 'Registrar incidencia' }} />
      <Stack.Screen name="sync" options={{ title: 'Sincronización' }} />
      <Stack.Screen name="chat" options={{ title: 'Chat con OCC' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notificaciones' }} />
      <Stack.Screen name="my-schedule" options={{ title: 'Mis turnos' }} />
    </Stack>
  </View>;
}
