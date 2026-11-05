import {
  AIRCRAFT_SILHOUETTE,
  type OperationDocumentKind,
  type OperationDocumentResponse,
  type OperationDocumentsResponse,
  type OperationSignatureRole,
} from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Polygon, Text as SvgText } from 'react-native-svg';
import { getMobileSessionRequestContext } from '../../services/mobile-auth';
import {
  loadOperationDocuments,
  markDamage,
  signDocument,
  subscribeFlightReport,
  type FlightReportSnapshot,
} from '../../services/flight-report';
import type { FlightReportOutboxItem } from '../../synchronization/flight-report-outbox';
import { colors } from '../../theme/colors';
import { radius, space, syncTone, touch, type } from '../../theme/tokens';
import { PrimaryButton } from '../ui';
import { SignaturePad, type Strokes } from './signature-pad';

const TITLES: Record<OperationDocumentKind, string> = {
  ServiceOrder: 'Orden de Servicio',
  FlightReport: 'Reporte de Vuelo',
  BridgeChecklist: 'Check-List del puente',
  CharterServiceRequest: 'Solicitud de Servicio',
};

const ROLES: Record<OperationSignatureRole, string> = {
  AirlineRepresentative: 'Representante de la aerolínea',
  AviamAgent: 'AVIAM · Responsable',
  Coordinator: 'Coordinador',
  BridgeOperator: 'Operador del puente',
};

/** Roles AVIAM signs: the name is the agent's own; the airline representative types theirs. */
const AVIAM_ROLES = new Set<OperationSignatureRole>(['AviamAgent', 'Coordinator', 'BridgeOperator']);

function useFlightReportSnapshot() {
  const [snapshot, setSnapshot] = useState<FlightReportSnapshot | null>(null);
  useEffect(() => subscribeFlightReport(setSnapshot), []);
  return snapshot;
}

function pendingOf(items: readonly FlightReportOutboxItem[], operationId: string) {
  return items.filter(item => item.command.operationId === operationId);
}

/** Billing units as the agent says them on the ramp. */
function unitLabel(unit: string) {
  const key = unit.toLowerCase();
  if (['perhour', 'hour', 'hours'].includes(key)) return 'h';
  if (['perservice', 'service', 'peroperation', 'operation', 'turnaround'].includes(key)) return 'serv.';
  if (['unit', 'perunit', 'each'].includes(key)) return 'unid.';
  return unit;
}

function money(amount: number | null | undefined, currency: string | null | undefined) {
  return amount == null ? '—' : `${currency ?? 'USD'} ${amount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * «Formularios y firmas» (ADR-0032): the AVIAM forms of the operation, generated from what was
 * already captured. Each shows who still has to sign; a signature is saved on the device and sent
 * with signal, and a form that changed after signing asks only for its own signatures again.
 */
export function DocumentsPanel({ operationId, editable }: { operationId: string; editable: boolean }) {
  const snapshot = useFlightReportSnapshot();
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [signing, setSigning] = useState<{ document: OperationDocumentResponse; role: OperationSignatureRole } | null>(null);
  const [agentName, setAgentName] = useState('');
  const documents = snapshot?.documents[operationId];
  const queued = pendingOf(snapshot?.items ?? [], operationId);
  const syncedCount = queued.length;

  useEffect(() => {
    let alive = true;
    void getMobileSessionRequestContext().then(context => { if (alive) setAgentName(context.session.actor.displayName); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    loadOperationDocuments(operationId).then(() => { if (alive) setState('ready'); })
      .catch(() => { if (alive) setState('offline'); });
    return () => { alive = false; };
  }, [operationId, syncedCount]);

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Ionicons name="document-text-outline" size={22} color={colors.navy} />
        <Text style={styles.panelTitle}>Formularios y firmas</Text>
      </View>
      <Text style={styles.hint}>Se llenan solos con lo que ya registró. Quien firma revisa los datos en pantalla.</Text>
      {!documents && state === 'loading' && <Text style={styles.hint}>Cargando formularios…</Text>}
      {!documents && state === 'offline' && (
        <View style={styles.notice}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.warning} />
          <Text style={styles.noticeText}>Los formularios necesitan señal la primera vez. Lo capturado sigue guardado.</Text>
        </View>
      )}
      {documents?.documents.map(document => (
        <DocumentRow key={document.kind} document={document} queued={queued} editable={editable}
          onSign={role => setSigning({ document, role })} />
      ))}
      {signing && (
        <SignSheet document={signing.document} role={signing.role} defaultName={AVIAM_ROLES.has(signing.role) ? agentName : ''}
          onClose={() => setSigning(null)}
          onSign={(name, strokes, identification) => {
            void signDocument(operationId, signing.document.kind as OperationDocumentKind, signing.role, name,
              signing.document.contentSha256, strokes, identification);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setSigning(null);
          }} />
      )}
    </View>
  );
}

function DocumentRow({ document, queued, editable, onSign }: {
  document: OperationDocumentResponse; queued: readonly FlightReportOutboxItem[]; editable: boolean;
  onSign: (role: OperationSignatureRole) => void;
}) {
  const kind = document.kind as OperationDocumentKind;
  return (
    <View style={[styles.document, document.isFullySigned && styles.documentDone]}>
      <View style={styles.documentHeader}>
        <Ionicons name={document.isFullySigned ? 'checkmark-circle' : 'create-outline'} size={24}
          color={document.isFullySigned ? colors.success : colors.navy} />
        <View style={styles.documentTitleBox}>
          <Text style={styles.documentTitle}>{TITLES[kind] ?? document.title}</Text>
          <Text style={styles.documentMeta}>{document.number} · {document.formCode}</Text>
        </View>
        {document.isFullySigned && <Text style={styles.doneChip}>Firmado</Text>}
      </View>
      {(document.requiredRoles as OperationSignatureRole[]).map(role => {
        const signature = document.signatures.find(item => item.role === role);
        const pending = queued.find(item => item.command.kind === 'signature' && item.command.documentKind === kind &&
          item.command.role === role);
        const stale = (document.staleRoles as string[]).includes(role);
        const tone = signature ? syncTone.confirmed : pending ? (pending.state === 'blocked' ? syncTone.blocked : syncTone.device)
          : null;
        return (
          <View key={role} style={styles.role}>
            <View style={styles.roleText}>
              <Text style={styles.roleLabel}>{ROLES[role]}</Text>
              {signature && <Text style={styles.roleDetail}>{signature.signerName}</Text>}
              {!signature && pending?.command.kind === 'signature' && (
                <Text style={styles.roleDetail}>{pending.command.signerName}</Text>)}
              {!signature && !pending && stale && (
                <Text style={[styles.roleDetail, { color: colors.warning }]}>Los datos cambiaron después de firmar: firme de nuevo.</Text>)}
            </View>
            {tone ? (
              <View style={[styles.chip, { backgroundColor: tone.bg }]}>
                <Ionicons name={tone.icon} size={16} color={tone.fg} />
                <Text style={[styles.chipText, { color: tone.fg }]}>{tone.label}</Text>
              </View>
            ) : (
              <Pressable accessibilityRole="button" disabled={!editable} onPress={() => onSign(role)}
                style={({ pressed }) => [styles.signButton, !editable && styles.disabled, pressed && styles.pressed]}>
                <Ionicons name="pencil" size={18} color={colors.white} />
                <Text style={styles.signText}>FIRMAR</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function SignSheet({ document, role, defaultName, onClose, onSign }: {
  document: OperationDocumentResponse; role: OperationSignatureRole; defaultName: string;
  onClose: () => void; onSign: (name: string, strokes: Strokes, identification?: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  // The charter request is the flight's agreement: whoever signs it leaves an ID or passport (ADR-0033).
  const asksIdentification = document.kind === 'CharterServiceRequest';
  const [identification, setIdentification] = useState('');
  const normalizedId = identification.replace(/s+/g, '').toUpperCase();
  const idValid = !asksIdentification || /^[A-Z0-9-]{4,40}$/.test(normalizedId);
  const [strokes, setStrokes] = useState<Strokes>([]);
  const [drawing, setDrawing] = useState(false);
  const summary = document.summary;
  const ready = name.trim().length >= 2 && strokes.length > 0 && idValid;
  return (
    <Modal animationType="slide" visible onRequestClose={onClose}>
      <ScrollView scrollEnabled={!drawing} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <Text style={styles.sheetEyebrow}>{ROLES[role]}</Text>
        <Text style={styles.sheetTitle}>{TITLES[document.kind as OperationDocumentKind] ?? document.title} · {document.number}</Text>
        <View style={styles.summary}>
          <Fact label="Vuelos" value={[summary.flightIn, summary.flightOut].filter(Boolean).join(' / ') || '—'} />
          <Fact label="Matrícula" value={summary.registration ?? '—'} />
          <Fact label="Aeronave" value={summary.aircraftType ?? '—'} />
          <Fact label="Posición" value={summary.position ?? '—'} />
          <Fact label="Pasajeros" value={`${summary.passengersIn ?? '—'} llegan · ${summary.passengersOut ?? '—'} salen`} />
          <Fact label="MTOW" value={summary.mtowKg ? `${summary.mtowKg.toLocaleString('es-DO')} kg` : '—'} />
        </View>
        {document.kind === 'ServiceOrder' || document.kind === 'CharterServiceRequest' ? (
          <View style={styles.lines}>
            {summary.services.length === 0 && <Text style={styles.hint}>Sin servicios registrados.</Text>}
            {summary.services.map(line => (
              <View key={line.code} style={styles.line}>
                <Text style={styles.lineName}>{line.name}</Text>
                <Text style={styles.lineQty}>{line.quantity.toLocaleString('es-DO')} {unitLabel(line.unit)}</Text>
                <Text style={styles.lineAmount}>{money(line.amount, summary.currencyCode)}</Text>
              </View>
            ))}
            {summary.surcharges.map(item => <Text key={item} style={styles.surcharge}>Recargo: {item}</Text>)}
            <View style={styles.total}>
              <Text style={styles.totalLabel}>Monto total</Text>
              <Text style={styles.totalValue}>{money(summary.totalAmount, summary.currencyCode)}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.hint}>
            {summary.milestoneCount} tiempos · {summary.checklistAnswered}/{summary.checklistTotal} puntos del checklist ·{' '}
            {summary.damageCount} daño(s) marcados
          </Text>
        )}
        <Text style={styles.fieldLabel}>Nombre de quien firma</Text>
        <TextInput accessibilityLabel="Nombre de quien firma" value={name} onChangeText={setName} maxLength={120}
          autoCapitalize="words" placeholder="Nombre y apellido" style={styles.input} />
        {asksIdentification && (
          <>
            <Text style={styles.fieldLabel}>Cédula o pasaporte</Text>
            <TextInput accessibilityLabel="Cédula o pasaporte" value={identification} onChangeText={setIdentification}
              maxLength={44} autoCapitalize="characters" autoCorrect={false} placeholder="Número del documento" style={styles.input} />
            {identification.length > 0 && !idValid && <Text style={styles.error}>Use solo letras, números o guiones (4 a 40).</Text>}
          </>
        )}
        <SignaturePad value={strokes} onChange={setStrokes} onDrawing={setDrawing} />
        <Text style={styles.fingerprint}>Huella del documento {document.contentSha256.slice(0, 12)}…{document.contentSha256.slice(-6)}</Text>
        <PrimaryButton icon="checkmark" title="FIRMAR" disabled={!ready} onPress={() => onSign(name.trim(), strokes, asksIdentification ? normalizedId : undefined)} />
        <PrimaryButton secondary title="CANCELAR" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

/**
 * Walk-around 360° (ADR-0032): tap the silhouette where the damage is, write what you see and take
 * a photo. The mark and the photo are saved on the device and reach OCC with signal.
 */
export function WalkaroundCard({ operationId, editable }: { operationId: string; editable: boolean }) {
  const snapshot = useFlightReportSnapshot();
  const [width, setWidth] = useState(0);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const height = width / AIRCRAFT_SILHOUETTE.aspect;
  const confirmedMarks = snapshot?.documents[operationId]?.damageMarks;
  const items = snapshot?.items;
  const marks = useMemo(() => {
    const confirmed: OperationDocumentsResponse['damageMarks'] = confirmedMarks ?? [];
    const queued = pendingOf(items ?? [], operationId);
    const photoQueued = new Set(queued.flatMap(item => item.command.kind === 'damagePhoto' ? [item.command.markId] : []));
    const local = queued.flatMap(item => {
      const command = item.command;
      return command.kind === 'damageMark' && !confirmed.some(mark => mark.id === command.markId)
        ? [{ id: command.markId, x: command.x, y: command.y, note: command.note, onDevice: true,
          hasPhoto: photoQueued.has(command.markId) }]
        : [];
    });
    return [...confirmed.map(mark => ({ ...mark, onDevice: photoQueued.has(mark.id) })), ...local];
  }, [confirmedMarks, items, operationId]);
  const points = AIRCRAFT_SILHOUETTE.outline.map(([x, y]) => `${x * width},${y * height}`).join(' ');

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Ionicons name="airplane-outline" size={22} color={colors.navy} />
        <Text style={styles.panelTitle}>Walk-around 360°</Text>
        <Text style={styles.count}>{marks.length} daño(s)</Text>
      </View>
      <Text style={styles.hint}>Toque el avión donde encontró una anomalía. Agregue una nota y una foto.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Silueta del avión: toque para marcar un daño" disabled={!editable}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
        onPress={event => width > 0 && setDraft({
          x: Math.min(1, Math.max(0, event.nativeEvent.locationX / width)),
          y: Math.min(1, Math.max(0, event.nativeEvent.locationY / height)),
        })}
        style={[styles.silhouette, { height: height || 200 }]}>
        {width > 0 && (
          <Svg width={width} height={height} pointerEvents="none">
            <Polygon points={points} fill={colors.paleBlue} stroke={colors.navy} strokeWidth={2} />
            {marks.map((mark, index) => (
              <Circle key={mark.id} cx={mark.x * width} cy={mark.y * height} r={14}
                fill={mark.onDevice ? colors.paleOrange : '#FBEAEA'} stroke={mark.onDevice ? colors.warning : colors.danger}
                strokeWidth={3} />
            ))}
            {marks.map((mark, index) => (
              <SvgText key={`${mark.id}-n`} x={mark.x * width} y={mark.y * height + 5} fontSize={14} fontWeight="bold"
                fill={mark.onDevice ? colors.warning : colors.danger} textAnchor="middle">{index + 1}</SvgText>
            ))}
          </Svg>
        )}
      </Pressable>
      {marks.map((mark, index) => (
        <View key={mark.id} style={styles.markRow}>
          <Text style={styles.markIndex}>{index + 1}</Text>
          <Text style={styles.markNote}>{mark.note}</Text>
          {mark.hasPhoto && <Ionicons name="camera" size={18} color={colors.muted} />}
          <Ionicons name={mark.onDevice ? syncTone.device.icon : syncTone.confirmed.icon} size={18}
            color={mark.onDevice ? syncTone.device.fg : syncTone.confirmed.fg} />
        </View>
      ))}
      {draft && (
        <DamageSheet onClose={() => setDraft(null)} onSave={(note, photo) => {
          void markDamage(operationId, { ...draft, note }, photo);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setDraft(null);
        }} />
      )}
    </View>
  );
}

function DamageSheet({ onClose, onSave }: {
  onClose: () => void;
  onSave: (note: string, photo?: { uri: string; contentType: 'image/jpeg' | 'image/png' }) => void;
}) {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; contentType: 'image/jpeg' | 'image/png' } | null>(null);
  const [cameraIssue, setCameraIssue] = useState<string | null>(null);
  const takePhoto = async () => {
    setCameraIssue(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setCameraIssue('Sin permiso de cámara: actívelo en los ajustes de la tablet.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, exif: false });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) setPhoto({ uri: asset.uri, contentType: asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg' });
  };
  return (
    <Modal animationType="slide" visible onRequestClose={onClose}>
      <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <Text style={styles.sheetTitle}>Daño en el walk-around</Text>
        <TextInput accessibilityLabel="Qué encontró" value={note} onChangeText={setNote} maxLength={500} multiline
          placeholder="Qué encontró (mínimo 3 caracteres)" style={[styles.input, styles.note]} />
        {photo ? <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" /> : null}
        {cameraIssue && <Text accessibilityRole="alert" style={styles.error}>{cameraIssue}</Text>}
        <PrimaryButton secondary icon="camera" title={photo ? 'TOMAR OTRA FOTO' : 'TOMAR FOTO'} onPress={() => void takePhoto()} />
        <PrimaryButton icon="save-outline" title="GUARDAR DAÑO" disabled={note.trim().length < 3}
          onPress={() => onSave(note.trim(), photo ?? undefined)} />
        <PrimaryButton secondary title="CANCELAR" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.md },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  panelTitle: { ...type.title, color: colors.navy, flex: 1 },
  count: { ...type.caption, color: colors.muted },
  hint: { ...type.body, color: colors.muted },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'center', backgroundColor: colors.paleOrange, borderRadius: radius.md, padding: space.md },
  noticeText: { ...type.body, color: colors.warning, flex: 1 },
  document: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm },
  documentDone: { borderColor: colors.success, backgroundColor: '#F3FAF6' },
  documentHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  documentTitleBox: { flex: 1 },
  documentTitle: { ...type.label, color: colors.ink, fontSize: 17 },
  documentMeta: { ...type.caption, color: colors.muted },
  doneChip: { ...type.caption, color: colors.success },
  role: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch.min, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
  roleText: { flex: 1, gap: 2 },
  roleLabel: { ...type.label, color: colors.ink },
  roleDetail: { ...type.body, color: colors.muted },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill },
  chipText: { ...type.caption },
  signButton: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.orange, minHeight: touch.min,
    paddingHorizontal: space.xl, borderRadius: radius.pill },
  signText: { ...type.label, color: colors.white, letterSpacing: 0.6 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  sheet: { padding: space.xl, gap: space.md, backgroundColor: colors.background, flexGrow: 1 },
  sheetEyebrow: { ...type.caption, color: colors.orange, textTransform: 'uppercase' },
  sheetTitle: { ...type.title, color: colors.navy, fontSize: 22 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  fact: { flexGrow: 1, flexBasis: 200, backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md },
  factLabel: { ...type.caption, color: colors.muted },
  factValue: { ...type.label, color: colors.ink, fontSize: 17 },
  lines: { backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.sm },
  line: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  lineName: { ...type.body, color: colors.ink, flex: 1 },
  lineQty: { ...type.body, color: colors.muted, fontVariant: ['tabular-nums'] },
  lineAmount: { ...type.label, color: colors.ink, minWidth: 110, textAlign: 'right', fontVariant: ['tabular-nums'] },
  surcharge: { ...type.caption, color: colors.warning },
  total: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm },
  totalLabel: { ...type.label, color: colors.navy },
  totalValue: { ...type.time, color: colors.navy },
  fieldLabel: { ...type.label, color: colors.ink },
  input: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, minHeight: touch.min,
    paddingHorizontal: space.md, ...type.body, fontSize: 18, color: colors.ink },
  note: { minHeight: 110, textAlignVertical: 'top', paddingTop: space.md },
  fingerprint: { ...type.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  silhouette: { borderRadius: radius.md, backgroundColor: colors.background, overflow: 'hidden' },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
  markIndex: { ...type.label, color: colors.white, backgroundColor: colors.danger, width: 26, height: 26, borderRadius: 13,
    textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden' },
  markNote: { ...type.body, color: colors.ink, flex: 1 },
  photo: { width: '100%', height: 260, borderRadius: radius.md },
  error: { ...type.body, color: colors.danger },
});
