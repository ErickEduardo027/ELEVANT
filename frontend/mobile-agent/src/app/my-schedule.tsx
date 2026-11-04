import type { RampAgentDocumentData, RampAgentScheduleData, RampAgentShiftData } from '@elevant/api-client';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/ui';
import { MobileServiceError } from '../services/mobile-service-error';
import { subscribeMobileChanges } from '../services/mobile-change-feed';
import { getOwnSchedule, SCHEDULE_DAYS } from '../services/ramp-schedule';
import { colors } from '../theme/colors';
import { resetToLogin } from '../utils/session-navigation';

const BLOCK: Record<string, string> = { Morning: 'Mañana', Afternoon: 'Tarde', Night: 'Noche' };
const VALIDITY: Record<string, { label: string; color: string }> = {
  Current: { label: 'Vigente', color: colors.success },
  Expiring: { label: 'Vence pronto', color: colors.warning },
  Expired: { label: 'Vencido', color: colors.danger },
};

function day(value: string): string {
  const [year, month, date] = value.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' });
}

const time = (value: string) => value.slice(0, 5);

/** «Mis turnos y documentos» (ADR-0026): the agent's next 14 days and document expiry, read-only. */
export default function MyScheduleScreen() {
  const [data, setData] = useState<RampAgentScheduleData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);

  useFocusEffect(useCallback(() => subscribeMobileChanges(resources => {
    if (resources.includes('ramp_schedule') || resources.includes('hr_shifts') || resources.includes('hr_permits') ||
        resources.includes('hr_qualifications'))
      setRevision(value => value + 1);
  }), []));

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    setStatus(current => (current === 'ready' ? current : 'loading'));
    getOwnSchedule(controller.signal)
      .then(result => { if (!controller.signal.aborted) { setData(result); setStatus('ready'); } })
      .catch(error => {
        if (controller.signal.aborted) return;
        if (error instanceof MobileServiceError && (error.code === 'unauthenticated' || error.code === 'session_expired')) resetToLogin('session_expired');
        else if (error instanceof MobileServiceError && error.code === 'forbidden') resetToLogin('access_revoked');
        setStatus('error');
      });
    return () => controller.abort();
    // A retry or a change signal bumps revision to restart this focus-scoped request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]));

  return <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
    <View style={styles.header}>
      <Text style={styles.title}>Mis turnos y documentos</Text>
      <Text style={styles.subtitle}>Próximos {SCHEDULE_DAYS} días · programados por Gestión Humana</Text>
    </View>
    {status === 'loading' ? <ActivityIndicator color={colors.navy} style={styles.loading} />
      : status === 'error' || !data ? <View style={styles.notice}>
        <Text>No fue posible cargar tus turnos.</Text>
        <PrimaryButton title="REINTENTAR" onPress={() => setRevision(value => value + 1)} secondary />
      </View>
      : <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>Turnos</Text>
        {data.shifts.length === 0
          ? <Text style={styles.empty}>No tienes turnos en los próximos {SCHEDULE_DAYS} días.</Text>
          : data.shifts.map(shift => <ShiftCard key={shift.id} shift={shift} />)}
        <Text style={styles.section}>Documentos</Text>
        {data.documents.length === 0
          ? <Text style={styles.empty}>No hay carnets ni habilitaciones registrados. Consulta con Gestión Humana.</Text>
          : data.documents.map(document => <DocumentCard key={`${document.kind}-${document.label}`} document={document} />)}
      </ScrollView>}
  </SafeAreaView>;
}

function ShiftCard({ shift }: Readonly<{ shift: RampAgentShiftData }>) {
  return <View style={styles.card} accessible accessibilityLabel={`Turno ${day(shift.workDate)} de ${time(shift.startsAtLocal)} a ${time(shift.endsAtLocal)}`}>
    <Text style={styles.cardTitle}>{day(shift.workDate)}</Text>
    <Text style={styles.cardLine}>{time(shift.startsAtLocal)}–{time(shift.endsAtLocal)} · {BLOCK[shift.block] ?? shift.block}</Text>
    <Text style={styles.muted}>{shift.stationCode} · terminal {shift.terminalCode}</Text>
  </View>;
}

function DocumentCard({ document }: Readonly<{ document: RampAgentDocumentData }>) {
  const validity = VALIDITY[document.validity] ?? VALIDITY.Current;
  const [year, month, date] = document.expiresOn.split('-');
  return <View style={styles.card}>
    <View style={styles.row}>
      <Text style={styles.cardTitle}>{document.label}</Text>
      <Text style={[styles.badge, { color: validity.color, borderColor: validity.color }]}>{validity.label}</Text>
    </View>
    <Text style={styles.muted}>{document.number ? `${document.number} · ` : ''}vence el {date}/{month}/{year}</Text>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: 18, backgroundColor: colors.navy },
  title: { color: colors.white, fontSize: 22, fontWeight: '900' },
  subtitle: { color: '#D5E2F5', fontSize: 12, marginTop: 4 },
  loading: { marginTop: 40 },
  notice: { padding: 20, gap: 12 },
  content: { padding: 14, gap: 10 },
  section: { fontWeight: '900', color: colors.navy, fontSize: 16, marginTop: 6 },
  empty: { color: colors.muted, padding: 8 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, backgroundColor: colors.white, gap: 4 },
  cardTitle: { fontWeight: '800', color: colors.navy, fontSize: 15, textTransform: 'capitalize', flexShrink: 1 },
  cardLine: { fontSize: 15, color: colors.navy },
  muted: { fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontSize: 11, fontWeight: '800' },
});
