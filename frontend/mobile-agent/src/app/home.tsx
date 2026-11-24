import type { RampAssignedOperationResponse } from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { MyPositionsCard } from '../components/my-positions-card';
import { PrimaryButton } from '../components/ui';
import { stationTimeZonesByCode } from '../features/assigned-operations/presentation';
import { subscribeMobileChanges } from '../services/mobile-change-feed';
import {
  getAssignedOperations,
  type AssignedOperationsSnapshot,
} from '../services/assigned-operations';
import {
  getMobileSession,
  logoutMobileAgent,
  MobileServiceError,
  readUnsentRecords,
  type MobileAgentActor,
} from '../services/mobile-auth';
import { colors, toneColors } from '../theme/colors';
import { radius, space, touch } from '../theme/tokens';
import { ConnectionBadge } from '../components/flight-report/connection-badge';
import { useMinuteClock } from '../hooks/use-minute-clock';
import { exitApplication } from '../utils/app-exit';
import { signOutPendingEvidenceNote } from '../utils/pending-evidence';
import { resetToLogin } from '../utils/session-navigation';
import { useLayoutClass } from '../utils/layout-class';
import { OperationDetail } from './flight/[id]';
import { formatStationDate, formatStationDateTime } from '../utils/date-format';

type BlockingState = 'offline' | 'unavailable' | null;

const operationKey = (item: RampAssignedOperationResponse) => item.operation.id;

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
  const [unsentOwn, setUnsentOwn] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const hasLoadedRef = useRef(false);
  const layoutClass = useLayoutClass();
  const expanded = layoutClass === 'expanded';
  const columns = layoutClass === 'medium' ? 2 : 1;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // One clock for every card: the list renders again once a minute for the countdowns, not on every tick.
  const now = useMinuteClock();
  const activeId = operations.some(item => item.operation.id === selectedId)
    ? selectedId
    : operations[0]?.operation.id ?? null;

  // Tras la primera carga, volver al inicio revalida en segundo plano: la lista y
  // su posición se conservan y solo cambia lo que devuelva la API.
  const load = useCallback(async (refresh = false) => {
    const silent = !refresh && hasLoadedRef.current;
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;

    if (refresh) setRefreshing(true);
    else if (!silent) setLoading(true);
    if (!silent) setBlockingState(null);

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
      setBlockingState(null);
      hasLoadedRef.current = true;
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
          if (silent) return;
          setBlockingState('offline');
          return;
        }
      }

      if (!silent) setBlockingState('unavailable');
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

  // A new assignment, a stand change or OCC's decision shows up without pulling to refresh.
  useFocusEffect(useCallback(() => subscribeMobileChanges(resources => {
    if (resources.includes('ramp_operations') || resources.includes('notifications')) void load();
  }), [load]));

  const closeSession = useCallback(async () => {
    requestRef.current?.abort();
    setProfileVisible(false);
    setSessionClosing(true);
    try {
      await logoutMobileAgent();
      setActor(null);
      setOperations([]);
      hasLoadedRef.current = false;
      resetToLogin();
    } catch {
      setBlockingState('unavailable');
      setSessionClosing(false);
    }
  }, []);

  // 3-N12: before signing out the agent sees that what is still unsent stays on the tablet for the same account.
  const openProfile = useCallback(() => {
    setProfileVisible(true);
    void readUnsentRecords().then(count => setUnsentOwn(count?.current ?? 0));
  }, []);
  const signOutNote = signOutPendingEvidenceNote(unsentOwn);

  // En tablet horizontal el manifiesto se abre junto a la lista; en el resto, en su propia pantalla.
  const openOperation = useCallback((operationId: string) => {
    if (expanded) setSelectedId(operationId);
    else router.push({ pathname: '/flight/[id]', params: { id: operationId } });
  }, [expanded]);

  const renderOperation = useCallback(
    ({ item }: { item: RampAssignedOperationResponse }) => (
      <View style={columns > 1 ? styles.gridCell : undefined}>
        <AssignedOperationCard now={now} operation={item} onOpen={openOperation}
          selected={expanded && item.operation.id === activeId} />
      </View>
    ),
    [activeId, columns, expanded, now, openOperation],
  );

  const stationCodes = actor?.stationScopes.map(scope => scope.stationCode).join(' · ') ?? 'Sin estación';
  // N11: times in the station's zone, which only the operations carry; without one, AVIAM's calendar.
  const timeZones = useMemo(() => stationTimeZonesByCode(operations), [operations]);
  const agentTimeZone = actor?.stationScopes.map(scope => timeZones.get(scope.stationCode)).find(Boolean);
  const summary = useMemo(() => queueSummary(operations), [operations]);
  const today = formatStationDate(new Date(now), agentTimeZone);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Image source={require('../../assets/images/elevant-symbol.png')} style={styles.brandMark} />
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{`Rampa ${stationCodes} · ${today}`}</Text>
            <Text numberOfLines={1} style={styles.name}>{actor?.displayName ?? 'Agente de rampa'}</Text>
          </View>
          <ConnectionBadge />
          <Pressable
            accessibilityHint="Muestra la cuenta y las opciones de sesión"
            accessibilityLabel="Abrir perfil del agente"
            accessibilityRole="button"
            onPress={openProfile}
            style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
          >
            <Text style={styles.avatarText}>{initialsOf(actor?.displayName)}</Text>
          </Pressable>
        </View>

        <View style={styles.quickActions}>
          <QuickAction icon="chatbubbles-outline" label="Chat con OCC" spoken="Abrir chat con OCC"
            onPress={() => router.push('/chat')} />
          <QuickAction icon="notifications-outline" label="Notificaciones" spoken="Abrir notificaciones"
            onPress={() => router.push('/notifications')} />
          <QuickAction icon="calendar-outline" label="Mis turnos" spoken="Abrir mis turnos y documentos"
            onPress={() => router.push('/my-schedule')} />
        </View>
      </View>

      {source === 'cache' && (
        <View accessibilityLiveRegion="polite" style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.warning} />
          <View style={styles.bannerCopy}>
            <Text style={styles.bannerTitle}>Mostrando información guardada</Text>
            <Text style={styles.bannerText}>
              Sin conexión · última actualización {updatedAt ? formatStationDateTime(updatedAt, agentTimeZone) : 'desconocida'}
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

      {!loading && blockingState === null && operations.length > 0 && (
        <View accessibilityRole="summary" style={styles.summary}>
          <SummaryTile icon="airplane-outline" label="Asignadas" value={summary.total} />
          <SummaryTile icon="play-circle-outline" label="En atención" value={summary.active} tone="brand" />
          <SummaryTile icon="time-outline" label="En revisión OCC" value={summary.review} tone="info" />
          <SummaryTile icon="checkmark-done-outline" label="Aprobadas" value={summary.approved} tone="success" />
        </View>
      )}

      <MyPositionsCard timeZones={timeZones} />

      <View style={styles.sectionHeader}>
        <View style={styles.sectionCopy}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Operaciones asignadas</Text>
          <Text style={styles.sectionSubtitle}>{`Tu cola autorizada por AVIAM · hora local de ${stationCodes}`}</Text>
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
        <View style={expanded ? styles.split : styles.fill}>
        <FlatList
          key={`columns-${columns}`}
          columnWrapperStyle={columns > 1 ? styles.gridRow : undefined}
          contentContainerStyle={[styles.list, columns > 1 && styles.gridList]}
          data={operations}
          extraData={activeId}
          initialNumToRender={6}
          keyExtractor={operationKey}
          numColumns={columns}
          removeClippedSubviews
          style={expanded ? styles.splitList : undefined}
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
        {expanded && activeId && (
          <View style={styles.splitDetail}>
            <OperationDetail key={activeId} operationId={activeId} />
          </View>
        )}
        </View>
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
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>{initialsOf(actor?.displayName)}</Text>
            </View>
            <Text style={styles.profileName}>{actor?.displayName ?? 'Agente de rampa'}</Text>
            <Text style={styles.profileUser}>{actor?.email ?? 'Cuenta de agente'}</Text>
            <View style={styles.profileScope}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.navy} />
              <View style={styles.profileScopeCopy}>
                <Text style={styles.profileScopeLabel}>Acceso operativo</Text>
                <Text style={styles.profileScopeValue}>AVIAM · {stationCodes}</Text>
              </View>
            </View>
            {!!signOutNote && (
              <View accessibilityLiveRegion="polite" style={styles.profileNote}>
                <Ionicons name="cloud-upload-outline" size={18} color={colors.warning} />
                <Text style={styles.profileNoteText}>{signOutNote}</Text>
              </View>
            )}
            <PrimaryButton title={sessionClosing ? 'CERRANDO SESIÓN…' : 'CERRAR SESIÓN'} icon="log-out-outline" onPress={() => void closeSession()} disabled={sessionClosing} secondary />
            <PrimaryButton title="SALIR DE LA APLICACIÓN" icon="exit-outline" onPress={exitApplication} danger />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** «PG» for «Pedro Guzmán»; the agent's monogram in the header and the profile. */
function initialsOf(name: string | null | undefined) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'AR';
  return words.slice(0, 2).map(word => word[0]!.toUpperCase()).join('');
}

/** The queue at a glance: how many operations the agent holds and where each one stands. */
function queueSummary(operations: readonly RampAssignedOperationResponse[]) {
  let active = 0;
  let review = 0;
  let approved = 0;
  for (const item of operations) {
    const status = item.operation.status;
    if (status === 'InProgress' || status === 'Returned') active += 1;
    else if (status === 'PendingReview' || status === 'InReview') review += 1;
    else if (status === 'Approved') approved += 1;
  }
  return { total: operations.length, active, review, approved };
}

function QuickAction({ icon, label, spoken, onPress }: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly spoken: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable accessibilityLabel={spoken} accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}>
      <Ionicons name={icon} size={21} color={colors.white} />
      <Text numberOfLines={1} style={styles.quickActionText}>{label}</Text>
    </Pressable>
  );
}

function SummaryTile({ icon, label, value, tone = 'neutral' }: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly value: number;
  readonly tone?: 'neutral' | 'brand' | 'info' | 'success';
}) {
  const palette = toneColors[tone];
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.summaryTile}>
      <View style={[styles.summaryIcon, { backgroundColor: palette.bg }]}>
        <Ionicons name={icon} size={18} color={tone === 'neutral' ? colors.navy : palette.fg} />
      </View>
      <View style={styles.summaryCopy}>
        <Text style={styles.summaryValue}>{value}</Text>
        <Text numberOfLines={1} style={styles.summaryLabel}>{label}</Text>
      </View>
    </View>
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
        <View style={styles.stateIcon}><Ionicons name={icon} size={34} color={colors.navy} /></View>
      )}
      <Text accessibilityRole="header" style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {onRetry && <View style={styles.stateAction}><PrimaryButton title="ACTUALIZAR" icon="refresh" onPress={onRetry} secondary /></View>}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    gap: space.lg,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  brandMark: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.white },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.orangeOnNavy, fontSize: 13, fontWeight: '800' },
  name: { color: colors.white, fontSize: 24, fontWeight: '900', marginTop: 2, letterSpacing: -0.2 },
  avatar: {
    width: touch.min,
    height: touch.min,
    borderRadius: touch.min / 2,
    backgroundColor: colors.navyRaised,
    borderWidth: 2,
    borderColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.white, fontSize: 18, fontWeight: '900' },
  pressed: { opacity: 0.75 },
  quickActions: { flexDirection: 'row', gap: space.md },
  quickAction: {
    flex: 1,
    minHeight: touch.min,
    borderRadius: radius.md,
    backgroundColor: colors.navyRaised,
    borderWidth: 1,
    borderColor: colors.navyLine,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
  },
  quickActionText: { flexShrink: 1, color: colors.white, fontWeight: '800', fontSize: 14 },
  offlineBanner: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.amberLine,
    borderRadius: radius.md,
    backgroundColor: colors.paleAmber,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bannerCopy: { flex: 1, minWidth: 0 },
  bannerTitle: { color: colors.warning, fontSize: 14, fontWeight: '900' },
  bannerText: { color: colors.inkSoft, fontSize: 13, marginTop: 2 },
  bannerAction: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  summaryTile: {
    flexGrow: 1,
    flexBasis: 150,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  summaryCopy: { flex: 1, minWidth: 0 },
  summaryValue: { color: colors.ink, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  summaryLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  sectionHeader: {
    paddingHorizontal: space.xl - 4,
    paddingTop: space.lg,
    paddingBottom: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  sectionSubtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  countBadge: {
    minWidth: 40,
    height: 32,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.navy,
  },
  countText: { color: colors.white, fontWeight: '900', fontVariant: ['tabular-nums'] },
  list: { paddingHorizontal: space.lg, paddingTop: 2, paddingBottom: 40, gap: 14 },
  fill: { flex: 1 },
  gridList: { width: '100%', maxWidth: 1180, alignSelf: 'center' },
  gridRow: { gap: 14 },
  gridCell: { flex: 1 },
  split: { flex: 1, flexDirection: 'row' },
  splitList: { width: 460, flexGrow: 0, borderRightWidth: 1, borderRightColor: colors.border },
  splitDetail: { flex: 1 },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 72,
    gap: 12,
  },
  stateIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  stateTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  stateMessage: { maxWidth: 380, color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  stateAction: { minWidth: 240, marginTop: 6 },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 29, 71, 0.6)',
  },
  profileCard: {
    width: '100%',
    maxWidth: 400,
    padding: space.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    alignItems: 'stretch',
    gap: space.md,
  },
  profileClose: {
    position: 'absolute',
    zIndex: 1,
    right: 12,
    top: 12,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  profileAvatar: {
    width: 76, height: 76, borderRadius: 38, alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.navy, borderWidth: 3, borderColor: colors.orange,
  },
  profileAvatarText: { color: colors.white, fontSize: 26, fontWeight: '900' },
  profileName: { color: colors.ink, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  profileUser: { color: colors.muted, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  profileScope: {
    marginVertical: 4,
    padding: 13,
    borderRadius: radius.md,
    backgroundColor: colors.paleBlue,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileScopeCopy: { flex: 1 },
  profileScopeLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  profileScopeValue: { color: colors.navy, fontSize: 14, fontWeight: '800', marginTop: 2 },
  profileNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: radius.sm,
    backgroundColor: colors.paleOrange,
  },
  profileNoteText: { flex: 1, color: colors.warning, fontSize: 13, fontWeight: '700', lineHeight: 18 },
});
