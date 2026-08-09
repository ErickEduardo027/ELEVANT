import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../theme/colors';

export default function RootLayout() {
  return <>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.white }, headerTintColor: colors.navy, headerTitleStyle: { fontWeight: '800' }, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="flight/[id]" options={{ title: 'Detalle del vuelo' }} />
      <Stack.Screen name="checklist/[id]" options={{ title: 'Checklist operativo' }} />
      <Stack.Screen name="incident/[id]" options={{ title: 'Registrar incidencia' }} />
      <Stack.Screen name="sync" options={{ title: 'Sincronización' }} />
      <Stack.Screen name="chat" options={{ title: 'Chat con OCC' }} />
    </Stack>
  </>;
}
