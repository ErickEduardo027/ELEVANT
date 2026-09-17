import type {
  RampAssignedOperationResponse,
  RampFlightLegResponse,
  RampOperationServiceResponse,
} from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Card, PrimaryButton, StatusPill } from '../../components/ui';
import {
  flightLegTimeLabel,
  formatOperationDate,
  formatOperationTime,
  operationAircraftLabel,
  operationFlightLabel,
  operationStandLabel,
  operationStatusLabel,
  operationStatusTone,
  serviceStatusLabel,
  serviceStatusTone,
} from '../../features/assigned-operations/presentation';
import { getAssignedOperations } from '../../services/assigned-operations';
import { MobileServiceError } from '../../services/mobile-auth';
import { colors } from '../../theme/colors';
import { resetToLogin } from '../../utils/session-navigation';

type DetailState = 'loading' | 'ready' | 'not-found' | 'offline' | 'unavailable';

export default function OperationDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [operation, setOperation] = useState<RampAssignedOperationResponse | null>(null);
  const [state, setState] = useState<DetailState>('loading');
  const [cached, setCached] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (refresh = false) => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    if (refresh) setRefreshing(true);
    else setState('loading');

    try {
      const snapshot = await getAssignedOperations({ signal: request.signal });
      if (request.signal.aborted) return;

      const found = snapshot.operations.find(item => item.operation.id === id) ?? null;
      setOperation(found);
      setCached(snapshot.source === 'cache');
      setState(found ? 'ready' : 'not-found');
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof MobileServiceError) {
        if (error.code === 'cancelled') return;
        if (error.code === 'unauthenticated' || error.code === 'session_expired') {
          setOperation(null);
          resetToLogin('session_expired');
          return;
        }
        if (error.code === 'forbidden') {
          setOperation(null);
          resetToLogin('access_revoked');
          return;
        }
        if (error.code === 'network_unavailable') {
          setState('offline');
          return;
        }
      }
      setState('unavailable');
    } finally {
      if (!request.signal.aborted) setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]));

  if (state !== 'ready' || !operation) {
    return <DetailStateScreen onRetry={() => void load()} state={state} />;
  }

  const { assignment, turnaround } = operation;
  const timeZone = turnaround.station.ianaTimeZone;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={(
        <RefreshControl
          accessibilityLabel="Actualizar detalle de la operación"
          colors={[colors.navy]}
          onRefresh={() => void load(true)}
          refreshing={refreshing}
          tintColor={colors.navy}
        />
      )}
    >
      {cached && (
        <View accessibilityLiveRegion="polite" style={styles.cachedBanner}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.warning} />
          <Text style={styles.cachedText}>Vista guardada · desliza hacia abajo para reconectar.</Text>
        </View>
      )}

      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroTitle}>
            <Text style={styles.eyebrow}>OPERACIÓN {turnaround.operationCode}</Text>
            <Text style={styles.flight}>{operationFlightLabel(operation)}</Text>
            <Text style={styles.airline}>{turnaround.airline.name}</Text>
          </View>
          <StatusPill
            text={operationStatusLabel(operation.operation.status)}
            tone={operationStatusTone(operation.operation.status)}
          />
        </View>

        <View style={styles.heroMeta}>
          <Meta icon="calendar-outline" label={formatOperationDate(turnaround.operationDate)} />
          <Meta icon="location-outline" label={`${turnaround.station.code} · ${turnaround.station.name}`} />
          <Meta icon="navigate-outline" label={operationStandLabel(operation)} />
          <Meta icon="airplane-outline" label={operationAircraftLabel(operation)} />
        </View>
      </Card>

      <SectionTitle title="Movimiento aéreo" subtitle={`Horario local · ${timeZone}`} />
      <View style={styles.legs}>
        {turnaround.arrival && (
          <FlightLegCard kind="Llegada" leg={turnaround.arrival} timeZone={timeZone} />
        )}
        {turnaround.departure && (
          <FlightLegCard kind="Salida" leg={turnaround.departure} timeZone={timeZone} />
        )}
        {!turnaround.arrival && !turnaround.departure && (
          <Card style={styles.pendingCard}>
            <Ionicons name="time-outline" size={24} color={colors.warning} />
            <View style={styles.pendingCopy}>
              <Text style={styles.pendingTitle}>Movimiento por confirmar</Text>
              <Text style={styles.pendingText}>OCC todavía no ha asociado una llegada o salida.</Text>
            </View>
          </Card>
        )}
      </View>

      <SectionTitle
        title="Servicios contratados"
        subtitle={`${operation.services.length} ${operation.services.length === 1 ? 'línea' : 'líneas'} de servicio`}
      />
      <Card style={styles.servicesCard}>
        {operation.services.length > 0 ? operation.services.map((service, index) => (
          <ServiceRow
            key={service.id}
            last={index === operation.services.length - 1}
            service={service}
          />
        )) : (
          <View style={styles.noServices}>
            <Ionicons name="construct-outline" size={23} color={colors.muted} />
            <Text style={styles.noServicesText}>No hay servicios asociados a esta operación.</Text>
          </View>
        )}
      </Card>

      <SectionTitle title="Asignación" />
      <Card style={styles.assignmentCard}>
        <Meta icon="briefcase-outline" label={assignment.assignmentRole} dark />
        <Meta
          icon="ribbon-outline"
          label={assignment.position ? `${assignment.position.code} · ${assignment.position.name}` : 'Posición operativa no especificada'}
          dark
        />
        <Meta
          icon="time-outline"
          label={`Asignada ${formatDateTime(assignment.assignedAt, timeZone)}`}
          dark
        />
      </Card>

      <View style={styles.nextPhase}>
        <View style={styles.nextPhaseIcon}>
          <Ionicons name="shield-checkmark-outline" size={26} color={colors.navy} />
        </View>
        <View style={styles.nextPhaseCopy}>
          <Text style={styles.nextPhaseTitle}>Consulta operativa segura</Text>
          <Text style={styles.nextPhaseText}>
            El inicio, el checklist, las incidencias y el cierre estarán disponibles en una próxima etapa. Esta versión mantiene la operación en modo consulta.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function DetailStateScreen({ onRetry, state }: { readonly onRetry: () => void; readonly state: DetailState }) {
  if (state === 'loading') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.stateScreen}>
        <ActivityIndicator accessibilityLabel="Cargando detalle" color={colors.navy} size="large" />
        <Text accessibilityRole="header" style={styles.stateTitle}>Cargando operación</Text>
      </View>
    );
  }

  const copy: readonly [string, string] = state === 'not-found'
    ? ['Operación no disponible', 'La asignación ya no existe o dejó de pertenecer a tu cuenta.']
    : state === 'offline'
      ? ['Sin conexión segura', 'No existe una copia guardada de esta operación en tu dispositivo.']
      : ['Detalle no disponible', 'No pudimos consultar esta operación en este momento.'];

  return (
    <View accessibilityLiveRegion="assertive" style={styles.stateScreen}>
      <View style={styles.stateIcon}>
        <Ionicons name="warning-outline" size={34} color={colors.warning} />
      </View>
      <Text accessibilityRole="header" style={styles.stateTitle}>{copy[0]}</Text>
      <Text style={styles.stateMessage}>{copy[1]}</Text>
      <PrimaryButton title="REINTENTAR" icon="refresh" onPress={onRetry} secondary />
      <PrimaryButton title="VOLVER A OPERACIONES" icon="arrow-back" onPress={() => router.replace('/home')} secondary />
    </View>
  );
}

function SectionTitle({ subtitle, title }: { readonly subtitle?: string; readonly title: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
  );
}

function FlightLegCard({
  kind,
  leg,
  timeZone,
}: {
  readonly kind: 'Llegada' | 'Salida';
  readonly leg: RampFlightLegResponse;
  readonly timeZone: string;
}) {
  const currentTime = flightLegTimeLabel(leg);
  return (
    <Card style={styles.legCard}>
      <View style={styles.legHeader}>
        <View style={styles.legKind}>
          <Ionicons name={kind === 'Llegada' ? 'log-in-outline' : 'log-out-outline'} size={18} color={colors.navy} />
          <Text style={styles.legKindText}>{kind.toUpperCase()}</Text>
        </View>
        <Text style={styles.legFlight}>{leg.flightNumber}</Text>
      </View>
      <View style={styles.routeRow}>
        <Airport code={leg.origin.iataCode} name={leg.origin.name} />
        <View style={styles.routeLine}>
          <View style={styles.routeDot} />
          <Ionicons name="airplane" size={18} color={colors.orange} />
          <View style={styles.routeDot} />
        </View>
        <Airport align="right" code={leg.destination.iataCode} name={leg.destination.name} />
      </View>
      <View style={styles.legTime}>
        <Text style={styles.timeLabel}>{currentTime.label}</Text>
        <Text style={styles.timeValue}>{formatOperationTime(currentTime.value, timeZone)}</Text>
      </View>
    </Card>
  );
}

function Airport({ align = 'left', code, name }: { readonly align?: 'left' | 'right'; readonly code: string; readonly name: string }) {
  return (
    <View style={[styles.airport, align === 'right' && styles.airportRight]}>
      <Text style={styles.airportCode}>{code}</Text>
      <Text numberOfLines={2} style={[styles.airportName, align === 'right' && styles.textRight]}>{name}</Text>
    </View>
  );
}

function ServiceRow({
  last,
  service,
}: {
  readonly last: boolean;
  readonly service: RampOperationServiceResponse;
}) {
  return (
    <View style={[styles.serviceRow, !last && styles.serviceSeparator]}>
      <View style={styles.serviceNumber}><Text style={styles.serviceNumberText}>{service.lineNumber}</Text></View>
      <View style={styles.serviceCopy}>
        <Text style={styles.serviceName}>{service.name}</Text>
        <Text style={styles.serviceCode}>{service.code}</Text>
        <Text style={styles.serviceQuantity}>
          {formatQuantity(service.executedQuantity)} / {formatQuantity(service.contractedQuantity)} {service.billingUnit}
        </Text>
      </View>
      <StatusPill text={serviceStatusLabel(service.status)} tone={serviceStatusTone(service.status)} />
    </View>
  );
}

function Meta({
  dark = false,
  icon,
  label,
}: {
  readonly dark?: boolean;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
}) {
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={17} color={dark ? colors.navy : '#C5D4EB'} />
      <Text style={[styles.metaText, dark && styles.metaTextDark]}>{label}</Text>
    </View>
  );
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('es-DO', { maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'por confirmar';
  try {
    return new Intl.DateTimeFormat('es-DO', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      timeZone,
    }).format(date);
  } catch {
    return 'por confirmar';
  }
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 38, gap: 12 },
  cachedBanner: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#F0C474',
    borderRadius: 14,
    backgroundColor: '#FFF8EA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  cachedText: { flex: 1, color: colors.warning, fontSize: 12, fontWeight: '700' },
  hero: { padding: 19, backgroundColor: colors.navy, borderColor: colors.navy },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heroTitle: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.orangeOnNavy, fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
  flight: { color: colors.white, fontSize: 26, fontWeight: '900', marginTop: 5 },
  airline: { color: '#C5D4EB', fontSize: 12, marginTop: 3 },
  heroMeta: { borderTopWidth: 1, borderTopColor: '#34558A', marginTop: 17, paddingTop: 14, gap: 9 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { flex: 1, color: colors.white, fontSize: 12, fontWeight: '700' },
  metaTextDark: { color: colors.ink },
  sectionTitleRow: { marginTop: 7 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  sectionSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  legs: { gap: 10 },
  legCard: { gap: 15 },
  legHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  legKind: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legKindText: { color: colors.navy, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  legFlight: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  airport: { width: 76 },
  airportRight: { alignItems: 'flex-end' },
  airportCode: { color: colors.navy, fontSize: 20, fontWeight: '900' },
  airportName: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  textRight: { textAlign: 'right' },
  routeLine: {
    flex: 1,
    height: 23,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#CBD6E6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  routeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#9EACC0' },
  legTime: { paddingTop: 11, borderTopWidth: 1, borderTopColor: '#E7ECF3', flexDirection: 'row', justifyContent: 'space-between' },
  timeLabel: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  timeValue: { color: colors.navy, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  pendingCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pendingCopy: { flex: 1 },
  pendingTitle: { color: colors.ink, fontWeight: '900' },
  pendingText: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  servicesCard: { paddingVertical: 6 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  serviceSeparator: { borderBottomWidth: 1, borderBottomColor: colors.border },
  serviceNumber: { width: 29, height: 29, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleBlue },
  serviceNumberText: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  serviceCopy: { flex: 1, minWidth: 0 },
  serviceName: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  serviceCode: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: 2 },
  serviceQuantity: { color: colors.navy, fontSize: 12, fontWeight: '700', marginTop: 4 },
  noServices: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  noServicesText: { flex: 1, color: colors.muted, fontSize: 12 },
  assignmentCard: { gap: 10 },
  nextPhase: {
    marginTop: 6,
    padding: 15,
    borderWidth: 1,
    borderColor: '#C8D7EC',
    borderRadius: 17,
    backgroundColor: '#EDF4FC',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  nextPhaseIcon: { width: 45, height: 45, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  nextPhaseCopy: { flex: 1 },
  nextPhaseTitle: { color: colors.navy, fontWeight: '900' },
  nextPhaseText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  stateScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 13, backgroundColor: colors.background },
  stateIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8EA' },
  stateTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  stateMessage: { maxWidth: 360, color: colors.muted, lineHeight: 20, textAlign: 'center' },
});
