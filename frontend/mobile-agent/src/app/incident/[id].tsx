import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, PrimaryButton, StatusPill } from '../../components/ui';
import { incidentStatusLabel } from '../../features/assigned-operations/presentation';
import { getAssignedOperations } from '../../services/assigned-operations';
import { MobileServiceError } from '../../services/mobile-auth';
import {
  loadRampIncidentCenter, reserveRampIncident,
  type RampIncidentCenter, type RampIncidentSeverity, type RampIncidentType,
} from '../../services/ramp-incidents';
import { serverNow } from '../../synchronization/server-clock';
import { colors } from '../../theme/colors';
import { resetToLogin } from '../../utils/session-navigation';
import { formatLocalDateTime } from '../../utils/date-format';

const types: readonly { value: RampIncidentType; label: string }[] = [
  { value: 'Operational', label: 'Operativa' },
  { value: 'Safety', label: 'Seguridad' },
  { value: 'Equipment', label: 'Equipo' },
  { value: 'Documentation', label: 'Documentación' },
];
const severities: readonly { value: RampIncidentSeverity; label: string }[] = [
  { value: 'Low', label: 'Baja' },
  { value: 'Medium', label: 'Media' },
  { value: 'High', label: 'Alta' },
  { value: 'Critical', label: 'Crítica' },
];

function handleSessionError(error: unknown) {
  if (!(error instanceof MobileServiceError)) return false;
  if (error.code === 'unauthenticated' || error.code === 'session_expired') {
    resetToLogin('session_expired');
    return true;
  }
  if (error.code === 'forbidden') {
    resetToLogin('access_revoked');
    return true;
  }
  return false;
}

function labelFor(value: string) {
  if (value === 'Deviation') return 'Desviación';
  return types.find(item => item.value === value)?.label ??
    severities.find(item => item.value === value)?.label ?? value;
}

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatLocalDateTime(value) : 'Hora no disponible';
}

export default function IncidentScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [center, setCenter] = useState<RampIncidentCenter | null>(null);
  const [operationCode, setOperationCode] = useState<string | null>(null);
  const [canReport, setCanReport] = useState(false);
  const [incidentType, setIncidentType] = useState<RampIncidentType>('Operational');
  const [severity, setSeverity] = useState<RampIncidentSeverity>('Medium');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  // Las recargas conservan la lista visible; solo la primera consulta muestra el indicador.
  const incidentsNewestFirst = useMemo(() => [...(center?.incidents ?? [])].reverse(), [center?.incidents]);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setLoading(true);
    try {
      if (typeof id !== 'string') {
        setNotice('Esta operación no está disponible. Regresa al listado.');
        return;
      }
      try {
        const assigned = await getAssignedOperations({ signal: request.signal });
        if (request.signal.aborted) return;
        const operation = assigned.operations.find(item => item.operation.id === id);
        setOperationCode(operation?.turnaround.operationCode ?? null);
        setCanReport(operation?.operation.status === 'InProgress');
      } catch (error) {
        if (request.signal.aborted || handleSessionError(error)) return;
        setCanReport(false);
      }

      const snapshot = await loadRampIncidentCenter(id, { signal: request.signal });
      if (request.signal.aborted) return;
      setCenter(snapshot);
      if (snapshot.issue?.code === 'not_found' || snapshot.issue?.code === 'conflict') {
        setCanReport(false);
      }
      if (snapshot.sent > 0) {
        setNotice(`${snapshot.sent} ${snapshot.sent === 1 ? 'incidencia sincronizada' : 'incidencias sincronizadas'} con ELEVANT.`);
      } else if (snapshot.issue) {
        setNotice(snapshot.issue.code === 'network_unavailable' || snapshot.issue.code === 'request_timeout'
          ? 'Sin conexión. Los reportes guardados permanecen en este dispositivo.'
          : 'No pudimos confirmar el estado remoto. Los reportes locales permanecen guardados.');
      } else setNotice(null);
    } catch (error) {
      if (request.signal.aborted || handleSessionError(error)) return;
      if (error instanceof MobileServiceError && error.code === 'cancelled') return;
      setNotice('No pudimos comprobar las incidencias. Los reportes locales no se borraron.');
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]));

  const submit = useCallback(async () => {
    if (sending || typeof id !== 'string' || !canReport) return;
    const detail = description.trim();
    if (detail.length < 8 || detail.length > 2000) {
      setFormError('Describe lo ocurrido en 8 a 2000 caracteres.');
      return;
    }
    setFormError(null);
    setSending(true);
    try {
      // 3-N18: the moment of the report by ELEVANT's clock, even when the tablet's runs ahead.
      const reserved = await reserveRampIncident(id, {
        incidentType, severity, description: detail, occurredAt: serverNow().toISOString(),
      });
      setCenter(current => current
        ? { ...current, outbox: reserved }
        : { incidents: [], outbox: reserved, online: false, sent: 0 });
      setDescription('');
      setNotice('Reporte guardado en este dispositivo. Verificando entrega…');
      await load();
    } catch (error) {
      if (handleSessionError(error)) return;
      setFormError(error instanceof MobileServiceError && error.code === 'storage_unavailable'
        ? 'No pudimos guardar el reporte localmente. Conserva el texto y vuelve a intentar.'
        : 'No pudimos guardar el reporte. Conserva el texto y vuelve a intentar.');
    } finally {
      setSending(false);
    }
  }, [canReport, description, id, incidentType, load, sending, severity]);

  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="alert-circle-outline" size={26} color={colors.orange} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>OPERACIÓN {operationCode ?? 'DE RAMPA'}</Text>
              <Text style={styles.title}>Incidencias</Text>
              <Text style={styles.subtitle}>Registra hechos operativos y conserva cada reporte hasta su confirmación.</Text>
            </View>
          </View>

          {center && !center.online &&
            (center.issue?.code === 'network_unavailable' || center.issue?.code === 'request_timeout') && (
            <Card style={styles.offlineCard}>
              <Ionicons name="cloud-offline-outline" size={22} color={colors.warning} />
              <Text style={styles.offlineText}>Sin conexión. Puedes guardar un reporte de una operación iniciada; se enviará al reconectar.</Text>
            </Card>
          )}
          {notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}

          <Card style={styles.formCard}>
            <Text style={styles.sectionTitle}>Nuevo reporte</Text>
            <Text style={styles.helper}>La hora del suceso se registra automáticamente al guardar.</Text>
            <Text style={styles.label}>Tipo de incidencia *</Text>
            <View accessibilityRole="radiogroup" style={styles.choices}>
              {types.map(item => (
                <Pressable
                  accessibilityLabel={`Tipo ${item.label}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: incidentType === item.value, disabled: !canReport || sending }}
                  disabled={!canReport || sending}
                  key={item.value}
                  onPress={() => setIncidentType(item.value)}
                  style={({ pressed }) => [styles.choice, incidentType === item.value && styles.choiceSelected, pressed && styles.pressed]}
                >
                  <Text style={[styles.choiceText, incidentType === item.value && styles.choiceTextSelected]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Impacto *</Text>
            <View accessibilityRole="radiogroup" style={styles.choices}>
              {severities.map(item => (
                <Pressable
                  accessibilityLabel={`Impacto ${item.label}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: severity === item.value, disabled: !canReport || sending }}
                  disabled={!canReport || sending}
                  key={item.value}
                  onPress={() => setSeverity(item.value)}
                  style={({ pressed }) => [styles.choice, severity === item.value && styles.choiceSelected, pressed && styles.pressed]}
                >
                  <Text style={[styles.choiceText, severity === item.value && styles.choiceTextSelected]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Descripción *</Text>
            <TextInput
              accessibilityLabel="Descripción de la incidencia"
              accessibilityHint="Describe qué ocurrió, dónde y qué acción inmediata se tomó"
              editable={canReport && !sending}
              maxLength={2000}
              multiline
              onChangeText={text => { setDescription(text); setFormError(null); }}
              placeholder="Describe el hecho y la acción inmediata…"
              placeholderTextColor={colors.muted}
              style={styles.input}
              textAlignVertical="top"
              value={description}
            />
            <Text style={styles.counter}>{description.length}/2000</Text>
            {formError && <Text accessibilityLiveRegion="assertive" style={styles.error}>{formError}</Text>}
            {!canReport && <Text style={styles.helper}>Inicia la operación y confirma que aparece en tus asignaciones para registrar una incidencia.</Text>}
            <PrimaryButton
              disabled={!canReport || sending || loading || description.trim().length < 8}
              icon="save-outline"
              onPress={() => void submit()}
              title={sending ? 'GUARDANDO…' : 'GUARDAR Y ENVIAR'}
            />
          </Card>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Reportes de esta operación</Text>
            <Pressable
              accessibilityLabel="Actualizar y reintentar incidencias pendientes"
              accessibilityRole="button"
              disabled={loading || sending}
              onPress={() => void load()}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            >
              <Ionicons name="refresh-outline" size={20} color={colors.navy} />
              <Text style={styles.retryText}>Actualizar</Text>
            </Pressable>
          </View>
          {loading && !center && <ActivityIndicator accessibilityLabel="Cargando incidencias" color={colors.navy} size="large" />}
          {center?.outbox.map(item => (
            <Card key={item.idempotencyKey} style={styles.reportCard}>
              <View style={styles.reportTop}>
                <StatusPill text={item.state === 'pending' ? 'PENDIENTE DE ENVÍO' : 'REQUIERE REVISIÓN'} tone={item.state === 'pending' ? 'orange' : 'red'} />
                <Text style={styles.time}>{displayTime(item.createdAt)}</Text>
              </View>
              <Text style={styles.reportTitle}>{labelFor(item.request.incidentType)} · {labelFor(item.request.severity)}</Text>
              <Text style={styles.reportDescription}>{item.request.description}</Text>
              <Text style={styles.helper}>{item.state === 'pending'
                ? 'Conservado en este dispositivo. Actualiza para reintentar con la misma clave.'
                : 'El servidor no aceptó este reporte. No se borró; verifica la operación con OCC.'}</Text>
            </Card>
          ))}
          {incidentsNewestFirst.map(incident => (
            <Card key={incident.id} style={styles.reportCard}>
              <View style={styles.reportTop}>
                <StatusPill text={incidentStatusLabel(incident.status).toUpperCase()} tone="green" />
                <Text style={styles.time}>{displayTime(incident.reportedAt)}</Text>
              </View>
              <Text style={styles.reportTitle}>{labelFor(incident.incidentType)} · {labelFor(incident.severity)}</Text>
              <Text style={styles.reportDescription}>{incident.description}</Text>
            </Card>
          ))}
          {center?.online && center.incidents.length === 0 && center.outbox.length === 0 && (
            <Card style={styles.emptyCard}>
              <Ionicons name="checkmark-circle-outline" size={30} color={colors.success} />
              <Text style={styles.emptyTitle}>Sin incidencias registradas</Text>
              <Text style={styles.helper}>Los reportes confirmados aparecerán aquí.</Text>
            </Card>
          )}
          <PrimaryButton secondary title="VOLVER A LA OPERACIÓN" onPress={() => router.back()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 820, alignSelf: 'center', padding: 16, paddingBottom: 40, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingVertical: 8 },
  headerIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.paleOrange, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  eyebrow: { color: colors.orange, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 4 },
  offlineCard: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.paleOrange },
  offlineText: { flex: 1, color: colors.warning, fontSize: 14, lineHeight: 20 },
  notice: { color: colors.navy, backgroundColor: colors.paleBlue, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 20 },
  formCard: { gap: 12 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 48, minWidth: 88, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  choiceSelected: { borderColor: colors.navy, backgroundColor: colors.paleBlue },
  choiceText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  choiceTextSelected: { color: colors.navy, fontWeight: '800' },
  pressed: { opacity: 0.72 },
  input: { minHeight: 128, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.ink, backgroundColor: colors.white, fontSize: 16, lineHeight: 23, padding: 14 },
  counter: { alignSelf: 'flex-end', color: colors.muted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  retry: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10 },
  retryText: { color: colors.navy, fontSize: 14, fontWeight: '700' },
  reportCard: { gap: 12 },
  reportTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  time: { color: colors.muted, fontSize: 12 },
  reportTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  reportDescription: { color: colors.ink, fontSize: 15, lineHeight: 23 },
  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
});
