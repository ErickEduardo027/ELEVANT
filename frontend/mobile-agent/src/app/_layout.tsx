import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { startMobileChangeFeed, stopMobileChangeFeed } from '../services/mobile-change-feed';
import { colors } from '../theme/colors';
import { ConnectivityIndicator } from '../components/connectivity-indicator';
import {
  startAutomaticMobileSync,
  stopAutomaticMobileSync,
} from '../services/automatic-mobile-sync';

export default function RootLayout() {
  useEffect(() => {
    startMobileChangeFeed();
    startAutomaticMobileSync();
    return () => {
      stopMobileChangeFeed();
      stopAutomaticMobileSync();
    };
  }, []);
  return <>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.white }, headerTintColor: colors.navy, headerTitleStyle: { fontWeight: '800' }, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="flight/[id]" options={{ title: 'Manifiesto operativo' }} />
      <Stack.Screen name="checklist/[id]" options={{ title: 'Checklist operativo' }} />
      <Stack.Screen name="incident/[id]" options={{ title: 'Registrar incidencia' }} />
      <Stack.Screen name="evidence/[id]" options={{ title: 'Evidencias y firma' }} />
      <Stack.Screen name="sync" options={{ title: 'Sincronización' }} />
      <Stack.Screen name="chat" options={{ title: 'Chat con OCC' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notificaciones' }} />
    </Stack>
    <ConnectivityIndicator />
  </>;
}
