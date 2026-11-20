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
import {
  flightDataQueuedFor,
  isOptionalForHandoff,
  serviceOrderHasSignature,
} from '../../features/assigned-operations/handoff';
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
import { SheetFrame } from '../sheet-frame';
import { PrimaryButton } from '../ui';
import { SignaturePad, type Strokes } from './signature-pad';
import { billingUnitAbbreviation } from '../../utils/billing-units';
import { missingFlightData, orderFlightDataWarning } from '../../utils/flight-data';
import { isValidSignerIdentification, normalizeSignerIdentification } from '../../utils/signer-identification';

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

/** N3 (D-N3): beside a form whose signatures the hand-off to OCC does not wait for. */
const NOT_NEEDED_FOR_HANDOFF = 'No hace falta para entregar a OCC';
/** N4 (D-N4): under the Service Order's total, on the tablet only; the PDF keeps its own wording. */
const SUBTOTAL_NOTE = 'Subtotal a precio de contrato, sin ITBIS. El importe final lo calcula Finanzas al facturar.';
const SURCHARGES_NOTE = 'Los recargos listados se valoran al facturar.';

/** N13 (D-N13): the damages marked, in words: «Sin daños», «1 daño», «2 daños», never «daño(s)». */
export function damageCountLabel(count: number) {
  if (count === 0) return 'Sin daños';
  return count === 1 ? '1 daño' : `${count} daños`;
}

/** N13: the milestones a form counts, by the name of the panel that records them, «Hitos del vuelo». */
function milestoneCountLabel(count: number) {
  return count === 1 ? '1 hito' : `${count} hitos`;
}

function useFlightReportSnapshot() {
  const [snapshot, setSnapshot] = useState<FlightReportSnapshot | null>(null);
  useEffect(() => subscribeFlightReport(setSnapshot), []);
  return snapshot;
}

function pendingOf(items: readonly FlightReportOutboxItem[], operationId: string) {
  return items.filter(item => item.command.operationId === operationId);
}

function money(amount: number | null | undefined, currency: string | null | undefined) {
  return amount == null ? '—' : `${currency ?? 'USD'} ${amount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * S1 (D-S1): what the Service Order lacks of the flight data, said on its row and at the top of its signature sheet. It
 * never holds the signature: 0 passengers is a value and a missing MTOW only warns. Null for the other forms, for
 * complete data and for a form read without its summary. `signed` is `serviceOrderHasSignature`, the push-back's rule:
 * a signature waiting on the device counts.
 */
function flightDataWarningFor(document: OperationDocumentResponse,
  situation: Readonly<{ queued: boolean; signed: boolean; executionOpen: boolean }>) {
  if (document.kind !== 'ServiceOrder') return null;
  const missing = missingFlightData(document.summary);
  return missing && orderFlightDataWarning(missing, {
    signed: situation.signed,
    queued: situation.queued,
    editable: situation.executionOpen,
  });
}

/**
 * «Formularios y firmas» (ADR-0032): the AVIAM forms of the operation, generated from what was
 * already captured. Each shows who still has to sign; a signature is saved on the device and sent
 * with signal, and a form that changed after signing asks only for its own signatures again.
 */
export function DocumentsPanel({ operationId, editable, executionOpen }: {
  operationId: string;
  /** The forms can be signed: while in progress, pending OCC's review or returned for correction. */
  editable: boolean;
  /** The operation is in progress, its hand-off to OCC still ahead (N3). */
  executionOpen: boolean;
}) {
  const snapshot = useFlightReportSnapshot();
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [signing, setSigning] = useState<{ document: OperationDocumentResponse; role: OperationSignatureRole } | null>(null);
  const [agentName, setAgentName] = useState('');
  const documents = snapshot?.documents[operationId];
  // A charter (ADR-0033) is the only flight with a Service Request; its forms are priced at Finance's base tariff.
  const charterFlight = documents?.documents.some(item => item.kind === 'CharterServiceRequest') ?? false;
  const queued = pendingOf(snapshot?.items ?? [], operationId);
  const syncedCount = queued.length;
  const flightData = {
    queued: flightDataQueuedFor(snapshot?.items ?? [], operationId),
    signed: serviceOrderHasSignature(documents, snapshot?.items ?? [], operationId),
    executionOpen,
  };

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
      <Text style={styles.hint}>Se llenan solos con lo que ya registraste. Quien firma revisa los datos en pantalla.</Text>
      {!documents && state === 'loading' && <Text style={styles.hint}>Cargando formularios…</Text>}
      {!documents && state === 'offline' && (
        <View style={styles.notice}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.warning} />
          <Text style={styles.noticeText}>Los formularios necesitan señal la primera vez. Lo capturado sigue guardado.</Text>
        </View>
      )}
      {documents?.documents.map(document => (
        <DocumentRow key={document.kind} document={document} queued={queued} editable={editable}
          executionOpen={executionOpen} flightDataWarning={flightDataWarningFor(document, flightData)}
          onSign={role => setSigning({ document, role })} />
      ))}
      {signing && (
        <SignSheet document={signing.document} role={signing.role} defaultName={AVIAM_ROLES.has(signing.role) ? agentName : ''}
          charterFlight={charterFlight} flightDataWarning={flightDataWarningFor(signing.document, flightData)}
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

function DocumentRow({ document, queued, editable, executionOpen, flightDataWarning, onSign }: {
  document: OperationDocumentResponse; queued: readonly FlightReportOutboxItem[]; editable: boolean; executionOpen: boolean;
  /** S1: what the Service Order lacks of the flight data; it warns and never holds the signature. */
  flightDataWarning: string | null;
  onSign: (role: OperationSignatureRole) => void;
}) {
  const kind = document.kind as OperationDocumentKind;
  const signers = (document.requiredRoles as OperationSignatureRole[]).map(role => ({
    role,
    signature: document.signatures.find(item => item.role === role),
    pending: queued.find(item => item.command.kind === 'signature' && item.command.documentKind === kind &&
      item.command.role === role),
    stale: (document.staleRoles as string[]).includes(role),
  }));
  // N3 (D-N3): the hand-off waits only for the Service Order. A form it does not wait for signs with a secondary
  // button, and says so while the execution is open and one of its signatures is still to give.
  const optional = isOptionalForHandoff(kind);
  const notNeeded = optional && editable && executionOpen && signers.some(item => !item.signature && !item.pending);
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
      {flightDataWarning && <FlightDataWarning text={flightDataWarning} />}
      {notNeeded && (
        <View style={styles.notNeeded}>
          <Ionicons name="information-circle-outline" size={20} color={colors.muted} />
          <Text style={styles.notNeededText}>{NOT_NEEDED_FOR_HANDOFF}</Text>
        </View>
      )}
      {signers.map(({ role, signature, pending, stale }) => {
        const tone = signature ? syncTone.confirmed : pending ? (pending.state === 'blocked' ? syncTone.blocked : syncTone.device)
          : null;
        return (
          <View key={role} style={styles.role}>
            <View style={styles.roleText}>
              <Text style={styles.roleLabel}>{ROLES[role]}</Text>
              {signature && <Text style={styles.roleDetail}>{signature.signerName}</Text>}
              {!signature && pending?.command.kind === 'signature' && (
                <Text style={styles.roleDetail}>{pending.command.signerName}</Text>)}
              {/* N13 (D-N13): neutral, the agent reads it about whoever signs. */}
              {!signature && !pending && stale && (
                <Text style={[styles.roleDetail, { color: colors.warning }]}>
                  Los datos cambiaron después de la firma: hay que firmar de nuevo.
                </Text>)}
            </View>
            {tone ? (
              <View style={[styles.chip, { backgroundColor: tone.bg }]}>
                <Ionicons name={tone.icon} size={16} color={tone.fg} />
                <Text style={[styles.chipText, { color: tone.fg }]}>{tone.label}</Text>
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={`Firmar: ${ROLES[role]}`}
                accessibilityHint={notNeeded ? NOT_NEEDED_FOR_HANDOFF : flightDataWarning ?? undefined} disabled={!editable}
                onPress={() => onSign(role)}
                style={({ pressed }) => [styles.signButton, optional && styles.signButtonSecondary,
                  !editable && styles.disabled, pressed && styles.pressed]}>
                <Ionicons name="pencil" size={18} color={optional ? colors.navy : colors.white} />
                <Text style={[styles.signText, optional && styles.signTextSecondary]}>FIRMAR</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function SignSheet({ document, role, defaultName, charterFlight, flightDataWarning, onClose, onSign }: {
  document: OperationDocumentResponse; role: OperationSignatureRole; defaultName: string;
  /** The flight is a charter (ADR-0033): no contract prices its forms. */
  charterFlight: boolean;
  /** S1: what the Service Order lacks of the flight data, said before anything else; FIRMAR is never held by it. */
  flightDataWarning: string | null;
  onClose: () => void; onSign: (name: string, strokes: Strokes, identification?: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  // The charter request is the flight's agreement: whoever signs it leaves an ID or passport (ADR-0033).
  const asksIdentification = document.kind === 'CharterServiceRequest';
  const [identification, setIdentification] = useState('');
  const normalizedId = normalizeSignerIdentification(identification);
  const idValid = !asksIdentification || isValidSignerIdentification(identification);
  const [strokes, setStrokes] = useState<Strokes>([]);
  const [drawing, setDrawing] = useState(false);
  const summary = document.summary;
  // N4 (D-N4): the Service Order's total is the services at contract price, before ITBIS and before the listed
  // surcharges are valued; Finance invoices the final amount. Not on a charter: its prices are the base tariff's.
  const subtotalNote = document.kind === 'ServiceOrder' && !charterFlight && summary.totalAmount != null
    ? (summary.surcharges.length > 0 ? `${SUBTOTAL_NOTE} ${SURCHARGES_NOTE}` : SUBTOTAL_NOTE)
    : null;
  const ready = name.trim().length >= 2 && strokes.length > 0 && idValid;
  const fingerprint = `${document.contentSha256.slice(0, 12)}…${document.contentSha256.slice(-6)}`;
  // S2: FIRMAR and CANCELAR stay in the frame's fixed footer, within reach in landscape; only the body scrolls, and
  // not while a finger is on the pad.
  return (
    <SheetFrame eyebrow={ROLES[role]}
      title={`${TITLES[document.kind as OperationDocumentKind] ?? document.title} · ${document.number}`}
      closeLabel="Cerrar sin firmar" onClose={onClose} scrollEnabled={!drawing}
      footerNote={<Text style={styles.fingerprint}>{`Huella del documento ${fingerprint}`}</Text>}
      actions={(
        <>
          <PrimaryButton secondary title="CANCELAR" onPress={onClose} />
          <PrimaryButton icon="checkmark" title="FIRMAR" disabled={!ready}
            onPress={() => onSign(name.trim(), strokes, asksIdentification ? normalizedId : undefined)} />
        </>
      )}>
      {/* S1 (D-S1): the warning goes first, before the signer reads the data or signs. */}
      {flightDataWarning && <FlightDataWarning text={flightDataWarning} />}
      {/* Who signs comes first, where the fixed footer never covers the fields. */}
      <Text style={styles.fieldLabel}>Nombre de quien firma</Text>
      <TextInput accessibilityLabel="Nombre de quien firma" value={name} onChangeText={setName} maxLength={120}
        autoCapitalize="words" placeholder="Nombre y apellido" style={styles.input} />
      {asksIdentification && (
        <>
          <Text style={styles.fieldLabel}>Cédula o pasaporte</Text>
          <TextInput accessibilityLabel="Cédula o pasaporte" value={identification} onChangeText={setIdentification}
            maxLength={44} autoCapitalize="characters" autoCorrect={false} placeholder="Número del documento" style={styles.input} />
          {identification.length > 0 && !idValid && <Text style={styles.error}>Solo letras, números o guiones (4 a 40).</Text>}
        </>
      )}
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
              <Text style={styles.lineQty}>{line.quantity.toLocaleString('es-DO')} {billingUnitAbbreviation(line.unit)}</Text>
              <Text style={styles.lineAmount}>{money(line.amount, summary.currencyCode)}</Text>
            </View>
          ))}
          {summary.surcharges.map(item => <Text key={item} style={styles.surcharge}>Recargo: {item}</Text>)}
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Monto total</Text>
            {/* Null until there are lines and every one has a price: no amount yet, so no note either. */}
            {summary.totalAmount == null
              ? <Text style={styles.totalPending}>Pendiente de valoración</Text>
              : <Text style={styles.totalValue}>{money(summary.totalAmount, summary.currencyCode)}</Text>}
          </View>
          {subtotalNote && <Text style={styles.totalNote}>{subtotalNote}</Text>}
        </View>
      ) : (
        <Text style={styles.hint}>
          {`${milestoneCountLabel(summary.milestoneCount)} · ${summary.checklistAnswered}/${summary.checklistTotal} ` +
            `puntos del checklist · ${damageCountLabel(summary.damageCount)}`}
        </Text>
      )}
      <SignaturePad value={strokes} onChange={setStrokes} onDrawing={setDrawing} />
    </SheetFrame>
  );
}

/** S1: a Service Order that lacks flight data, with a shape besides its colour (ADR-0031); 5.96:1 on pale orange. */
function FlightDataWarning({ text }: { text: string }) {
  return (
    <View style={styles.notice}>
      <Ionicons name="warning-outline" size={20} color={colors.warning} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
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
        <Text style={styles.count}>{damageCountLabel(marks.length)}</Text>
      </View>
      <Text style={styles.hint}>Toca el avión donde encontraste una anomalía. Agrega una nota y una foto.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Silueta del avión: toca para marcar un daño" disabled={!editable}
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
    if (!permission.granted) { setCameraIssue('Sin permiso de cámara: actívalo en los ajustes de la tablet.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, exif: false });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) setPhoto({ uri: asset.uri, contentType: asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg' });
  };
  return (
    <Modal animationType="slide" visible onRequestClose={onClose}>
      <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <Text style={styles.sheetTitle}>Daño en el walk-around</Text>
        <TextInput accessibilityLabel="Qué encontraste" value={note} onChangeText={setNote} maxLength={500} multiline
          placeholder="Qué encontraste (mínimo 3 caracteres)" style={[styles.input, styles.note]} />
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
  // N3: a signature the hand-off does not wait for. Navy on white is 13.5:1 (AA asks 4.5:1 for text, 3:1 for the edge).
  signButtonSecondary: { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.navy },
  signTextSecondary: { color: colors.navy },
  notNeeded: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  notNeededText: { ...type.body, color: colors.muted, flex: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  sheet: { padding: space.xl, gap: space.md, backgroundColor: colors.background, flexGrow: 1 },
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
  totalPending: { ...type.label, color: colors.navy, flexShrink: 1, textAlign: 'right' },
  totalNote: { ...type.body, color: colors.muted },
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
