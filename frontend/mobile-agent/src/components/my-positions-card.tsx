import type { RampOwnCoverageResponse } from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { subscribeMobileChanges } from '../services/mobile-change-feed';
import { getOwnCoverage } from '../services/ramp-coverage';
import { colors } from '../theme/colors';

const TIME = new Intl.DateTimeFormat('es-DO', { hour: '2-digit', minute: '2-digit', hour12: false });
const time = (value: string) => TIME.format(new Date(value));

/**
 * «Mis posiciones de hoy» (ADR-0030): the stands OCC handed this agent, with the window, the
 * mentor or trainee and the vehicle. Flights that block on these stands arrive on their own.
 */
export function MyPositionsCard() {
  const [coverages, setCoverages] = useState<readonly RampOwnCoverageResponse[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useFocusEffect(useCallback(() => subscribeMobileChanges(resources => {
    if (resources.includes('ramp_schedule')) setRevision(value => value + 1);
  }), []));

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    getOwnCoverage(controller.signal)
      .then(result => { if (!controller.signal.aborted) { setCoverages(result.coverages); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
    // A change hint bumps revision to restart this focus-scoped read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]));

  if (coverages === null && !failed) return null;
  return (
    <View accessibilityLabel="Mis posiciones de hoy" style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="location-outline" size={20} color={colors.navy} />
        <Text style={styles.title}>Mis posiciones de hoy</Text>
      </View>
      {failed && !coverages ? <Text style={styles.muted}>No se pudieron consultar tus posiciones. Desliza para actualizar.</Text>
        : coverages?.length === 0 ? <Text style={styles.muted}>OCC aún no te ha asignado posiciones para este turno.</Text>
          : coverages?.map(item => (
            <View key={item.id} style={styles.row}>
              <View style={styles.stands}>
                {item.stands.map(code => <Text key={code} style={styles.stand}>{code}</Text>)}
              </View>
              <Text style={styles.detail}>
                Terminal {item.terminalCode} · {time(item.startsAt)}–{time(item.endsAt)}
                {item.partner ? ` · con ${item.partner}` : ''}{item.vehicleCode ? ` · vehículo ${item.vehicleCode}` : ''}
                {item.isReinforcement ? ' · refuerzo' : ''}
              </Text>
            </View>
          ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 16, backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.border, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '800', color: colors.navy },
  muted: { color: colors.muted, fontSize: 13 },
  row: { gap: 6 },
  stands: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stand: { minWidth: 56, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.navy,
    color: colors.white, fontSize: 16, fontWeight: '900', textAlign: 'center', overflow: 'hidden' },
  detail: { color: colors.ink, fontSize: 13 },
});
