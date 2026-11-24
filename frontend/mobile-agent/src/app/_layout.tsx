import { View } from 'react-native';
import { startMobilePresence, stopMobilePresence, refreshMobilePresenceSession, recordMobilePresenceActivity } from '../services/mobile-presence';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { startMobileChangeFeed, stopMobileChangeFeed } from '../services/mobile-change-feed';
import { colors } from '../theme/colors';
import { startFlightReportSync } from '../components/flight-report/connection-badge';
import { SessionEndedBanner, useScreenShowsSessionNotice } from '../components/session-ended-notice';
import { refreshFlightReportQueue } from '../services/flight-report';
import { subscribeMobileSessionEnd, type MobileSessionEnd } from '../services/mobile-auth';

/** The access screen explains an ended session itself (N6). */
const ACCESS_PATH = '/';

export default function RootLayout() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const [ended, setEnded] = useState<MobileSessionEnd | null>(null);
  const screenShowsSessionNotice = useScreenShowsSessionNotice();
  useEffect(() => { void refreshMobilePresenceSession(); void refreshFlightReportQueue().catch(() => {}); }, [pathname]);
  // N6 (D-N6): a session the tablet ends without its agent signing out is announced on every screen, whatever ended it
  // (a screen, the queue, the presence), until the agent is back on the access screen; an end noticed there is not
  // carried into the next sign-in. A screen that shows its own notice (the checklist) shows only that one.
  useEffect(() => {
    pathnameRef.current = pathname;
    if (pathname === ACCESS_PATH) setEnded(null);
  }, [pathname]);
  useEffect(() => subscribeMobileSessionEnd(next => {
    if (pathnameRef.current !== ACCESS_PATH) setEnded(next);
  }), []);
  useEffect(() => {
    startMobileChangeFeed();
    startMobilePresence();
    // The Flight Report queue goes out on its own when the tablet recovers signal (ADR-0031).
    const stopFlightReportSync = startFlightReportSync();
    return () => { stopMobileChangeFeed(); stopMobilePresence(); stopFlightReportSync(); };
  }, []);
  return <View style={{ flex: 1 }} accessible={false} onTouchStart={recordMobilePresenceActivity}>
    <StatusBar style="dark" />
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerStyle: { backgroundColor: colors.white }, headerTintColor: colors.navy, headerTitleStyle: { fontWeight: '900', fontSize: 19, color: colors.ink }, headerShadowVisible: false, contentStyle: { backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border } }}>
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
    </View>
    {ended && pathname !== ACCESS_PATH && !screenShowsSessionNotice && <SessionEndedBanner ended={ended} />}
  </View>;
}
