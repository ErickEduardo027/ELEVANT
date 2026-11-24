import type { RampOwnCoverageResponse } from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { subscribeMobileChanges } from '../services/mobile-change-feed';
import { getOwnCoverage } from '../services/ramp-coverage';
import { colors } from '../theme/colors';
import { formatStationTime } from '../utils/date-format';
import { standDisplayCode } from '../utils/stand-codes';

/**
 * «Mis posiciones de hoy» (ADR-0030): the stands OCC handed this agent, with the window, the
 * mentor or trainee and the vehicle. Flights that block on these stands arrive on their own.
 * N11: each window is in its station's time, from `timeZones` (station code → IANA zone); a station
 * without one uses AVIAM's calendar.
 */
export function MyPositionsCard({ timeZones }: { readonly timeZones?: ReadonlyMap<string, string> }) {
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
  const time = (value: string, stationCode: string) => formatStationTime(value, timeZones?.get(stationCode));
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
                {/* CN-21: each stand as OCC's map shows it («A1», never «A01»). */}
                {item.stands.map(code => <Text key={code} style={styles.stand}>{standDisplayCode(code)}</Text>)}
              </View>
              <Text style={styles.detail}>
                Terminal {item.terminalCode} · {time(item.startsAt, item.stationCode)}–{time(item.endsAt, item.stationCode)}
                {item.partner ? ` · con ${item.partner}` : ''}{item.vehicleCode ? ` · vehículo ${item.vehicleCode}` : ''}
                {item.isReinforcement ? ' · refuerzo' : ''}
              </Text>
            </View>
          ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 18, backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.border, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '900', color: colors.ink },
  muted: { color: colors.muted, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  stands: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stand: { minWidth: 60, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.navy,
    color: colors.white, fontSize: 18, fontWeight: '900', textAlign: 'center', overflow: 'hidden' },
  detail: { flexShrink: 1, color: colors.inkSoft, fontSize: 14, fontWeight: '600' },
});
