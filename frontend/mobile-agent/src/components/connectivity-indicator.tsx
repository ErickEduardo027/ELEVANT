import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useConnectivity } from '../hooks/use-connectivity';
import { colors } from '../theme/colors';

export function ConnectivityIndicator() {
  const connectivity = useConnectivity();
  const pathname = usePathname();
  if (pathname === '/') return null;

  const offline = connectivity === 'offline';
  const label = offline ? 'Sin conexión' : connectivity === 'online' ? 'En línea' : 'Comprobando red';
  return (
    <Pressable
      accessibilityHint="Abre el centro de sincronización"
      accessibilityLabel={`${label}. Abrir sincronización`}
      accessibilityRole="button"
      onPress={() => router.push('/sync')}
      style={[styles.indicator, offline && styles.offline]}
    >
      <Ionicons
        name={offline ? 'cloud-offline-outline' : 'cloud-done-outline'}
        size={16}
        color={offline ? colors.warning : colors.success}
      />
      <Text style={[styles.text, offline && styles.offlineText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  indicator: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    zIndex: 100,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#B8DFC8',
    backgroundColor: '#F1FBF5',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  offline: { borderColor: '#F0C474', backgroundColor: '#FFF8EA' },
  text: { color: colors.success, fontSize: 11, fontWeight: '900' },
  offlineText: { color: colors.warning },
});
