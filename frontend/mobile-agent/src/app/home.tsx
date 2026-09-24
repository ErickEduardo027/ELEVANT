import type { RampAssignedOperationResponse } from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AssignedOperationCard } from '../components/assigned-operation-card';
import { PrimaryButton } from '../components/ui';
import {
  getAssignedOperations,
  type AssignedOperationsSnapshot,
} from '../services/assigned-operations';
import {
  getMobileSession,
  logoutMobileAgent,
  MobileServiceError,
  type MobileAgentActor,
} from '../services/mobile-auth';
import { colors } from '../theme/colors';
import { exitApplication } from '../utils/app-exit';
import { resetToLogin } from '../utils/session-navigation';

type BlockingState = 'offline' | 'unavailable' | null;

export default function HomeScreen() {
  const [actor, setActor] = useState<MobileAgentActor | null>(null);
  const [operations, setOperations] = useState<readonly RampAssignedOperationResponse[]>([]);
  const [source, setSource] = useState<AssignedOperationsSnapshot['source'] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [blockingState, setBlockingState] = useState<BlockingState>(null);
  const [profileVisible, setProfileVisible] = useState(false);
  const [sessionClosing, setSessionClosing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (refresh = false) => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;

    if (refresh) setRefreshing(true);
    else setLoading(true);
    setBlockingState(null);

    try {
      const session = await getMobileSession();
      if (!session) {
        resetToLogin('session_expired');
        return;
      }

      setActor(session.actor);
      const snapshot = await getAssignedOperations({ signal: request.signal });
      if (request.signal.aborted) return;

      setOperations(snapshot.operations);
      setSource(snapshot.source);
      setUpdatedAt(snapshot.updatedAt);
    } catch (error) {
      if (request.signal.aborted) return;

      if (error instanceof MobileServiceError) {
        if (error.code === 'cancelled') return;
        if (error.code === 'unauthenticated' || error.code === 'session_expired') {
          setActor(null);
          setOperations([]);
          resetToLogin('session_expired');
          return;
        }
        if (error.code === 'forbidden') {
          setActor(null);
          setOperations([]);
          setSource(null);
          setUpdatedAt(null);
          resetToLogin('access_revoked');
          return;
        }
        if (error.code === 'network_unavailable') {
          setBlockingState('offline');
          return;
        }
      }

      setBlockingState('unavailable');
    } finally {
      if (!request.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]));

  const closeSession = useCallback(async () => {
    requestRef.current?.abort();
    setProfileVisible(false);
    setSessionClosing(true);
    try {
      await logoutMobileAgent();
      setActor(null);
      setOperations([]);
      resetToLogin();
    } catch {
      setBlockingState('unavailable');
      setSessionClosing(false);
    }
  }, []);

  const renderOperation = useCallback(
    ({ item }: { item: RampAssignedOperationResponse }) => (
      <AssignedOperationCard
        operation={item}
        onPress={() => router.push({ pathname: '/flight/[id]', params: { id: item.operation.id } })}
      />
    ),
    [],
  );

  const stationCodes = actor?.stationScopes.map(scope => scope.stationCode).join(' · ') ?? 'Sin estación';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>MANIFIESTO OPERATIVO</Text>
          <Text numberOfLines={2} style={styles.name}>{actor?.displayName ?? 'Agente de rampa'}</Text>
          <View style={styles.stationRow}>
            <Ionicons name="location" size={14} color="#C5D4EB" />
            <Text style={styles.stationText}>{stationCodes}</Text>
          </View>
        </View>
        <Pressable
          accessibilityHint="Muestra la cuenta y las opciones de sesión"
          accessibilityLabel="Abrir perfil del agente"
          accessibilityRole="button"
          onPress={() => setProfileVisible(true)}
          style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
        >
          <Image source={require('../../assets/images/elevant-symbol.png')} style={styles.avatarImage} />
        </Pressable>
      </View>

      {source === 'cache' && (
        <View accessibilityLiveRegion="polite" style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.warning} />
          <View style={styles.bannerCopy}>
            <Text style={styles.bannerTitle}>Mostrando información guardada</Text>
            <Text style={styles.bannerText}>
              Sin conexión · última actualización {formatUpdatedAt(updatedAt)}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Reintentar conexión"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => void load(true)}
            style={styles.bannerAction}
          >
            <Ionicons name="refresh" size={21} color={colors.navy} />
          </Pressable>
        </View>
      )}

      <View style={styles.quickActions}>
        <Pressable accessibilityLabel="Abrir chat con OCC" accessibilityRole="button" onPress={() => router.push('/chat')} style={styles.quickAction}><Ionicons name="chatbubbles-outline" size={19} color={colors.navy} /><Text style={styles.quickActionText}>Chat con OCC</Text></Pressable>
        <Pressable accessibilityLabel="Abrir notificaciones" accessibilityRole="button" onPress={() => router.push('/notifications')} style={styles.quickAction}><Ionicons name="notifications-outline" size={19} color={colors.navy} /><Text style={styles.quickActionText}>Notificaciones</Text></Pressable>
      </View>

      <View style={styles.sectionHeader}>
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>Operaciones asignadas</Text>
          <Text style={styles.sectionSubtitle}>Tu cola autorizada por AVIAM</Text>
        </View>
        {!loading && blockingState === null && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{operations.length}</Text>
          </View>
        )}
      </View>

      {loading ? (
        <ScreenState
          icon="airplane-outline"
          loading
          message="Consultando tus asignaciones autorizadas."
          title="Preparando operaciones"
        />
      ) : blockingState ? (
        <BlockingScreen state={blockingState} onRetry={() => void load()} />
      ) : operations.length === 0 ? (
        <ScreenState
          icon="checkmark-done-circle-outline"
          message="Actualiza para consultar nuevas asignaciones de OCC."
          onRetry={() => void load(true)}
          title="No tienes operaciones asignadas"
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={operations}
          keyExtractor={item => item.operation.id}
          refreshControl={(
            <RefreshControl
              accessibilityLabel="Actualizar operaciones asignadas"
              colors={[colors.navy]}
              onRefresh={() => void load(true)}
              refreshing={refreshing}
              tintColor={colors.navy}
            />
          )}
          renderItem={renderOperation}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        animationType="fade"
        onRequestClose={() => setProfileVisible(false)}
        transparent
        visible={profileVisible}
      >
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={() => setProfileVisible(false)}
          style={styles.overlay}
        >
          <Pressable
            accessibilityLabel="Cerrar perfil"
            accessibilityRole="button"
            onPress={() => setProfileVisible(false)}
            style={styles.backdrop}
          />
          <View style={styles.profileCard}>
            <Pressable
              accessibilityLabel="Cerrar perfil"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => setProfileVisible(false)}
              style={styles.profileClose}
            >
              <Ionicons name="close" size={23} color={colors.navy} />
            </Pressable>
            <Image source={require('../../assets/images/elevant-symbol.png')} style={styles.profileLogo} />
            <Text style={styles.profileName}>{actor?.displayName ?? 'Agente de rampa'}</Text>
            <Text style={styles.profileUser}>{actor?.email ?? 'Cuenta de agente'}</Text>
            <View style={styles.profileScope}>
              <Text style={styles.profileScopeLabel}>ACCESO OPERATIVO</Text>
              <Text style={styles.profileScopeValue}>AVIAM · {stationCodes}</Text>
            </View>
            <PrimaryButton title={sessionClosing ? 'CERRANDO SESIÓN…' : 'CERRAR SESIÓN'} icon="log-out-outline" onPress={() => void closeSession()} disabled={sessionClosing} secondary />
            <PrimaryButton title="SALIR DE LA APLICACIÓN" icon="exit-outline" onPress={exitApplication} danger />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ScreenState({
  icon,
  loading = false,
  message,
  onRetry,
  title,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly loading?: boolean;
  readonly message: string;
  readonly onRetry?: () => void;
  readonly title: string;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.state}>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Cargando operaciones" color={colors.navy} size="large" />
      ) : (
        <View style={styles.stateIcon}><Ionicons name={icon} size={33} color={colors.navy} /></View>
      )}
      <Text accessibilityRole="header" style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {onRetry && <PrimaryButton title="ACTUALIZAR" icon="refresh" onPress={onRetry} secondary />}
    </View>
  );
}

function BlockingScreen({
  onRetry,
  state,
}: {
  readonly onRetry: () => void;
  readonly state: Exclude<BlockingState, null>;
}) {
  return (
    <ScreenState
      icon={state === 'offline' ? 'cloud-offline-outline' : 'warning-outline'}
      message={state === 'offline'
        ? 'Conéctate a la red privada de ELEVANT e inténtalo nuevamente.'
        : 'No pudimos consultar tus operaciones. Tus datos de acceso no se mostraron ni se modificaron.'}
      onRetry={onRetry}
      title={state === 'offline' ? 'Sin conexión segura' : 'Operaciones no disponibles'}
    />
  );
}

function formatUpdatedAt(value: string | null) {
  if (!value) return 'desconocida';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'desconocida';
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(date);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  quickActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14 },
  quickAction: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  quickActionText: { color: colors.navy, fontWeight: '800', fontSize: 12 },
  header: {
    minHeight: 158,
    backgroundColor: colors.navy,
    paddingHorizontal: 22,
    paddingTop: 25,
    paddingBottom: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerCopy: { flex: 1, minWidth: 0, paddingRight: 16 },
  eyebrow: { color: colors.orangeOnNavy, fontSize: 12, fontWeight: '900', letterSpacing: 1.8 },
  name: { color: colors.white, fontSize: 24, fontWeight: '900', marginTop: 7 },
  stationRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  stationText: { flex: 1, color: '#C5D4EB', fontSize: 12, fontWeight: '700' },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.orange,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: 54, height: 54 },
  pressed: { opacity: 0.75 },
  offlineBanner: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F0C474',
    borderRadius: 15,
    backgroundColor: '#FFF8EA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  bannerCopy: { flex: 1, minWidth: 0 },
  bannerTitle: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  bannerText: { color: colors.muted, fontSize: 12, marginTop: 2 },
  bannerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: {
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  sectionSubtitle: { color: colors.muted, fontSize: 12, marginTop: 3 },
  countBadge: {
    minWidth: 38,
    height: 30,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: colors.paleBlue,
  },
  countText: { color: colors.navy, fontWeight: '900' },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 36, gap: 13 },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 72,
    gap: 12,
  },
  stateIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  stateTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  stateMessage: { maxWidth: 360, color: colors.muted, lineHeight: 20, textAlign: 'center' },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 28, 58, 0.56)',
  },
  profileCard: {
    width: '100%',
    maxWidth: 380,
    padding: 23,
    borderRadius: 24,
    backgroundColor: colors.white,
    alignItems: 'stretch',
    gap: 11,
  },
  profileClose: {
    position: 'absolute',
    zIndex: 1,
    right: 12,
    top: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  profileLogo: { width: 78, height: 78, borderRadius: 20, alignSelf: 'center' },
  profileName: { color: colors.navy, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  profileUser: { color: colors.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  profileScope: {
    marginVertical: 4,
    padding: 13,
    borderRadius: 13,
    backgroundColor: colors.paleBlue,
  },
  profileScopeLabel: { color: colors.muted, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  profileScopeValue: { color: colors.navy, fontSize: 13, fontWeight: '800', marginTop: 4 },
});
