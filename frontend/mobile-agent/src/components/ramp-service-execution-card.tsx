import type { RampOperationServiceResponse } from '@elevant/api-client';
import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  serviceStatusLabel,
  serviceStatusTone,
} from '../features/assigned-operations/presentation';
import type {
  RampOperationServiceTargetStatus,
  RampServicePendingTransition,
  TransitionRampOperationServiceRequest,
} from '../services/ramp-operation-service-execution';
import { colors } from '../theme/colors';
import {
  billingUnitDecimals,
  billingUnitName,
  MAX_QUANTITY_DECIMALS,
} from '../utils/billing-units';
import { Card, PrimaryButton, StatusPill } from './ui';

export type ServiceExecutionNotice = Readonly<{
  tone: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}>;

type TerminalTarget = 'Completed' | 'NotPerformed' | 'Exception';

export const RampServiceExecutionCard = memo(function RampServiceExecutionCard({
  actionable,
  busy,
  correctionMode = false,
  disabledReason,
  notice,
  onTransition,
  pending,
  queue,
  service,
}: {
  readonly actionable: boolean;
  readonly busy: boolean;
  readonly correctionMode?: boolean;
  readonly disabledReason?: string;
  readonly notice?: ServiceExecutionNotice;
  readonly onTransition: (request: TransitionRampOperationServiceRequest) => void;
  readonly pending?: RampServicePendingTransition;
  /**
   * 3-I: the service's last transition waits in the device's queue (the card already shows its target status), or
   * ELEVANT refused one, with its message.
   */
  readonly queue?: Readonly<{ tone: 'device' | 'blocked'; message?: string }>;
  readonly service: RampOperationServiceResponse;
}) {
  const [target, setTarget] = useState<TerminalTarget | null>(
    pending && pending.request.targetStatus !== 'InProgress'
      ? pending.request.targetStatus
      : null,
  );
  const [quantity, setQuantity] = useState(() => initialQuantity(service, target, pending));
  const [note, setNote] = useState(pending?.request.note ?? '');
  const [validationRequested, setValidationRequested] = useState(false);
  const frozen = pending !== undefined;
  const terminal = isTerminalStatus(service.status);
  const executableStatus = service.status === 'Planned' || service.status === 'InProgress';

  useEffect(() => {
    const pendingTarget = pending?.request.targetStatus;
    const nextTarget = pendingTarget && pendingTarget !== 'InProgress'
      ? pendingTarget
      : null;
    setTarget(nextTarget);
    setQuantity(initialQuantity(service, nextTarget, pending));
    setNote(pending?.request.note ?? '');
    setValidationRequested(false);
  }, [pending, service]);

  // S5 (D-S5): the unit in Spanish, never its code; a unit that counts things takes whole numbers only, but the
  // contracted quantity the card proposes is accepted even when it is fractional.
  const decimals = billingUnitDecimals(service.billingUnit);
  const wholeNumbers = decimals === 0;
  const unitName = billingUnitName(service.billingUnit);
  const quantityLabel = unitName ? `Cantidad ejecutada (${unitName})` : 'Cantidad ejecutada';
  const parsedQuantity = useMemo(
    () => parseQuantity(quantity, decimals) ?? contractedQuantityOf(quantity, service.contractedQuantity),
    [decimals, quantity, service.contractedQuantity],
  );
  const noteRequired = target === 'NotPerformed' || target === 'Exception';
  const quantityRequired = target !== null;
  const formValid = (
    target !== null &&
    (!quantityRequired || parsedQuantity !== null) &&
    (!noteRequired || note.trim().length > 0)
  );

  const chooseTarget = (next: TerminalTarget) => {
    if (busy || frozen || !actionable) return;
    setTarget(next);
    setQuantity(
      next === 'NotPerformed'
        ? '0'
        : formatQuantityInput(
            next === 'Completed'
              ? service.contractedQuantity
              : service.executedQuantity,
          ),
    );
    setNote('');
    setValidationRequested(false);
  };

  const submitTerminal = () => {
    if (!target || busy || !actionable) return;
    // A reserved command is not validated again: its retry sends exactly what was reserved, even a fractional quantity
    // in a count unit.
    if (pending) {
      onTransition(pending.request);
      return;
    }
    if (!formValid || parsedQuantity === null) {
      setValidationRequested(true);
      return;
    }
    const normalizedNote = note.trim();
    onTransition({
      targetStatus: target,
      executedQuantity: target === 'NotPerformed' ? 0 : parsedQuantity,
      ...(normalizedNote ? { note: normalizedNote } : {}),
    });
  };

  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.number}><Text style={styles.numberText}>{service.lineNumber}</Text></View>
        <View style={styles.copy}>
          <Text style={styles.name}>{service.name}</Text>
          <Text style={styles.code}>{service.code}</Text>
          <Text style={styles.quantitySummary}>{quantitySummary(service)}</Text>
        </View>
        <StatusPill
          text={serviceStatusLabel(service.status)}
          tone={serviceStatusTone(service.status)}
        />
      </View>

      {queue && (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.queueHint, queue.tone === 'blocked' && styles.queueHintBlocked]}
        >
          <Ionicons
            name={queue.tone === 'blocked' ? 'alert-circle' : 'phone-portrait-outline'}
            size={18}
            color={queue.tone === 'blocked' ? colors.danger : colors.warning}
          />
          <Text style={[styles.queueHintText, queue.tone === 'blocked' && styles.queueHintTextBlocked]}>
            {queue.tone === 'blocked'
              ? `Rechazado por ELEVANT. ${queue.message ?? ''} Revísalo en Sincronización.`
              : 'En el dispositivo · se envía a ELEVANT en cuanto haya señal, con la hora en que lo tocaste.'}
          </Text>
        </View>
      )}

      {terminal && correctionMode && (
        <View style={styles.executionArea}>
          <Text style={styles.actionPrompt}>¿Necesitas corregir este servicio?</Text>
          <Text style={styles.helperText}>
            Registra una justificación para reabrirlo. El resultado enviado anteriormente permanece en el historial.
          </Text>
          <TextInput
            accessibilityLabel={`Motivo de corrección de ${service.name}`}
            accessibilityHint="Explica por qué se corrige el servicio"
            editable={actionable && !busy && !frozen}
            maxLength={1000}
            multiline
            onChangeText={setNote}
            placeholder="Describe el ajuste solicitado por OCC"
            placeholderTextColor={colors.muted}
            style={[styles.noteInput, validationRequested && !note.trim() && styles.inputInvalid]}
            textAlignVertical="top"
            value={note}
          />
          {validationRequested && !note.trim() && (
            <Text accessibilityLiveRegion="polite" style={styles.inlineError}>
              Explica el motivo antes de corregir el servicio.
            </Text>
          )}
          {frozen && pending?.request.targetStatus === 'InProgress' && (
            <Text style={styles.replayHintText}>
              Reintenta con el mismo motivo y la misma clave reservada.
            </Text>
          )}
          <PrimaryButton
            disabled={!actionable || busy}
            icon="create-outline"
            onPress={() => {
              if (!note.trim()) { setValidationRequested(true); return; }
              onTransition({ targetStatus: 'InProgress', note: note.trim() });
            }}
            title={busy ? 'REGISTRANDO…' : frozen ? 'REINTENTAR CORRECCIÓN' : 'CORREGIR SERVICIO'}
          />
        </View>
      )}

      {!terminal && (
        <View style={styles.executionArea}>
          {!executableStatus && (
            <View accessibilityLiveRegion="polite" style={styles.disabledHint}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.warning} />
              <Text style={styles.disabledHintText}>
                El estado actual no admite comandos desde Mobile Agent.
              </Text>
            </View>
          )}
          {!actionable && (
            <View accessibilityLiveRegion="polite" style={styles.disabledHint}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.warning} />
              <Text style={styles.disabledHintText}>
                {disabledReason ?? 'Actualiza el estado canónico antes de ejecutar este servicio.'}
              </Text>
            </View>
          )}

          {service.status === 'Planned' && !target && (
            <>
              <PrimaryButton
                disabled={!actionable || busy}
                icon="play"
                onPress={() => onTransition({ targetStatus: 'InProgress' })}
                title={busy ? 'REGISTRANDO…' : frozen ? 'REINTENTAR INICIO' : 'INICIAR SERVICIO'}
              />
              <Text style={styles.alternateLabel}>O registra una excepción sin iniciar:</Text>
              <TerminalChoices
                actionable={actionable}
                busy={busy}
                frozen={frozen}
                onSelect={chooseTarget}
                selected={target}
                statuses={['NotPerformed', 'Exception']}
              />
            </>
          )}

          {service.status === 'InProgress' && !target && (
            <>
              <Text style={styles.actionPrompt}>Selecciona el resultado del servicio:</Text>
              <TerminalChoices
                actionable={actionable}
                busy={busy}
                frozen={frozen}
                onSelect={chooseTarget}
                selected={target}
                statuses={['Completed', 'NotPerformed', 'Exception']}
              />
            </>
          )}

          {target && (
            <View style={styles.form}>
              <View style={styles.formHeading}>
                <View style={styles.formHeadingCopy}>
                  <Text style={styles.formEyebrow}>RESULTADO SELECCIONADO</Text>
                  <Text style={styles.formTitle}>{targetLabel(target)}</Text>
                </View>
                {!frozen && (
                  <Pressable
                    accessibilityLabel="Cancelar edición del resultado"
                    accessibilityRole="button"
                    disabled={busy}
                    hitSlop={8}
                    onPress={() => {
                      setTarget(null);
                      setValidationRequested(false);
                    }}
                    style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="close" size={21} color={colors.navy} />
                  </Pressable>
                )}
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{quantityLabel}</Text>
                <TextInput
                  accessibilityHint={wholeNumbers ? 'Usa solo números enteros' : 'Usa hasta cuatro decimales'}
                  accessibilityLabel={quantityLabel}
                  editable={actionable && !busy && !frozen && target !== 'NotPerformed'}
                  keyboardType={wholeNumbers ? 'number-pad' : 'decimal-pad'}
                  maxLength={20}
                  onChangeText={setQuantity}
                  placeholder="0"
                  placeholderTextColor="#7C8798"
                  style={[
                    styles.input,
                    target === 'NotPerformed' && styles.readOnlyInput,
                    validationRequested && parsedQuantity === null && styles.inputInvalid,
                  ]}
                  value={quantity}
                />
                <Text style={styles.helperText}>
                  {wholeNumbers ? 'Solo números enteros.' : 'Máximo 4 decimales.'}
                </Text>
                {validationRequested && parsedQuantity === null && (
                  <Text accessibilityLiveRegion="polite" style={styles.inlineError}>
                    Ingresa una cantidad válida, igual o mayor que cero.
                  </Text>
                )}
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  Nota {noteRequired ? '(obligatoria)' : '(opcional)'}
                </Text>
                <TextInput
                  accessibilityHint={noteRequired ? 'Describe la causa del resultado' : 'Agrega contexto operativo si es necesario'}
                  accessibilityLabel={`Nota para ${service.name}`}
                  editable={actionable && !busy && !frozen}
                  maxLength={1000}
                  multiline
                  onChangeText={setNote}
                  placeholder={noteRequired ? 'Describe lo ocurrido' : 'Contexto adicional'}
                  placeholderTextColor="#7C8798"
                  style={[
                    styles.noteInput,
                    validationRequested && noteRequired && !note.trim() && styles.inputInvalid,
                  ]}
                  textAlignVertical="top"
                  value={note}
                />
                {validationRequested && noteRequired && !note.trim() && (
                  <Text accessibilityLiveRegion="polite" style={styles.inlineError}>
                    La nota es obligatoria para este resultado.
                  </Text>
                )}
              </View>

              {frozen && (
                <View accessibilityLiveRegion="polite" style={styles.replayHint}>
                  <Ionicons name="shield-checkmark-outline" size={19} color={colors.warning} />
                  <Text style={styles.replayHintText}>
                    Payload reservado. El reintento usa exactamente la cantidad, la nota y la clave originales.
                  </Text>
                </View>
              )}

              <PrimaryButton
                disabled={!actionable || busy}
                icon="checkmark-circle-outline"
                onPress={submitTerminal}
                title={busy ? 'REGISTRANDO…' : frozen ? 'REINTENTAR COMANDO' : `CONFIRMAR ${targetShortLabel(target)}`}
              />
            </View>
          )}
        </View>
      )}

      {notice && <ServiceNotice notice={notice} />}
    </Card>
  );
});

function TerminalChoices({
  actionable,
  busy,
  frozen,
  onSelect,
  selected,
  statuses,
}: {
  readonly actionable: boolean;
  readonly busy: boolean;
  readonly frozen: boolean;
  readonly onSelect: (status: TerminalTarget) => void;
  readonly selected: TerminalTarget | null;
  readonly statuses: readonly TerminalTarget[];
}) {
  return (
    <View style={styles.choiceRow}>
      {statuses.map((status) => {
        const danger = status !== 'Completed';
        return (
          <Pressable
            accessibilityLabel={targetLabel(status)}
            accessibilityRole="button"
            accessibilityState={{ disabled: !actionable || busy || frozen, selected: selected === status }}
            disabled={!actionable || busy || frozen}
            key={status}
            onPress={() => onSelect(status)}
            style={({ pressed }) => [
              styles.choice,
              danger && styles.choiceDanger,
              selected === status && styles.choiceSelected,
              (!actionable || busy || frozen) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={status === 'Completed' ? 'checkmark-circle-outline' : status === 'NotPerformed' ? 'remove-circle-outline' : 'warning-outline'}
              size={19}
              color={danger ? colors.danger : colors.success}
            />
            <Text style={[styles.choiceText, danger && styles.choiceTextDanger]}>
              {targetShortLabel(status)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ServiceNotice({ notice }: { readonly notice: ServiceExecutionNotice }) {
  const color = notice.tone === 'success'
    ? colors.success
    : notice.tone === 'warning'
      ? colors.warning
      : colors.danger;
  return (
    <View
      accessibilityLiveRegion={notice.tone === 'error' ? 'assertive' : 'polite'}
      style={[
        styles.notice,
        notice.tone === 'success' && styles.noticeSuccess,
        notice.tone === 'warning' && styles.noticeWarning,
        notice.tone === 'error' && styles.noticeError,
      ]}
    >
      <Ionicons
        name={notice.tone === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
        size={20}
        color={color}
      />
      <View style={styles.noticeCopy}>
        <Text style={styles.noticeTitle}>{notice.title}</Text>
        <Text style={styles.noticeText}>{notice.message}</Text>
      </View>
    </View>
  );
}

function isTerminalStatus(status: string) {
  return status === 'Completed' || status === 'NotPerformed' || status === 'Exception';
}

function initialQuantity(
  service: RampOperationServiceResponse,
  target: RampOperationServiceTargetStatus | null,
  pending?: RampServicePendingTransition,
) {
  if (typeof pending?.request.executedQuantity === 'number') {
    return formatQuantityInput(pending.request.executedQuantity);
  }
  if (target === 'NotPerformed') return '0';
  return formatQuantityInput(
    target === 'Completed' ? service.contractedQuantity : service.executedQuantity,
  );
}

/** A quantity written with a comma or a point and at most `decimals` decimals (none in a count unit). */
function parseQuantity(raw: string, decimals: number) {
  const normalized = raw.trim().replace(',', '.');
  const match = /^\d{1,14}(?:\.(\d{1,4}))?$/.exec(normalized);
  if (!match || (match[1]?.length ?? 0) > decimals) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > 99_999_999_999_999.9999) {
    return null;
  }
  return value;
}

/** The contracted quantity when that is what the field holds: the card proposes it even if a count unit has decimals. */
function contractedQuantityOf(raw: string, contracted: number) {
  const value = parseQuantity(raw, MAX_QUANTITY_DECIMALS);
  return value !== null && value === contracted ? value : null;
}

function formatQuantityInput(value: number) {
  return Number.isFinite(value) ? String(value) : '0';
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('es-DO', { maximumFractionDigits: 4 }).format(value);
}

/** «0 / 1 hora» in one string: the unit, in Spanish, agrees with the contracted quantity next to it. */
function quantitySummary(service: RampOperationServiceResponse) {
  const quantities = `${formatQuantity(service.executedQuantity)} / ${formatQuantity(service.contractedQuantity)}`;
  const unit = billingUnitName(service.billingUnit, service.contractedQuantity);
  return unit ? `${quantities} ${unit}` : quantities;
}

function targetLabel(target: TerminalTarget) {
  if (target === 'Completed') return 'Servicio completado';
  if (target === 'NotPerformed') return 'Servicio no realizado';
  return 'Servicio con excepción';
}

function targetShortLabel(target: TerminalTarget) {
  if (target === 'Completed') return 'COMPLETADO';
  if (target === 'NotPerformed') return 'NO REALIZADO';
  return 'EXCEPCIÓN';
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  queueHint: { padding: 10, borderRadius: 12, backgroundColor: colors.paleOrange, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  queueHintBlocked: { backgroundColor: '#FBEAEA' },
  queueHintText: { flex: 1, color: colors.warning, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  queueHintTextBlocked: { color: colors.danger },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  number: { width: 31, height: 31, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleBlue },
  numberText: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  copy: { flex: 1, minWidth: 0 },
  name: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  code: { color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: 2 },
  quantitySummary: { color: colors.navy, fontSize: 12, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  executionArea: { paddingTop: 13, borderTopWidth: 1, borderTopColor: colors.border, gap: 11 },
  disabledHint: { padding: 10, borderRadius: 12, backgroundColor: '#FFF8EA', flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  disabledHintText: { flex: 1, color: colors.warning, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  alternateLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  actionPrompt: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 48, flexGrow: 1, minWidth: 128, paddingHorizontal: 11, borderWidth: 1, borderColor: '#B9DFC9', borderRadius: 12, backgroundColor: '#F2FAF5', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  choiceDanger: { borderColor: '#F1BBBB', backgroundColor: '#FFF7F7' },
  choiceSelected: { borderWidth: 2 },
  choiceText: { color: colors.success, fontSize: 11, fontWeight: '900' },
  choiceTextDanger: { color: colors.danger },
  form: { gap: 13 },
  formHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  formHeadingCopy: { flex: 1, minWidth: 0 },
  formEyebrow: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  formTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 2 },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleBlue },
  fieldGroup: { gap: 6 },
  fieldLabel: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white, color: colors.ink, fontSize: 16, fontVariant: ['tabular-nums'] },
  noteInput: { minHeight: 90, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white, color: colors.ink, fontSize: 15, lineHeight: 21 },
  readOnlyInput: { backgroundColor: colors.background, color: colors.muted },
  inputInvalid: { borderColor: colors.danger },
  helperText: { color: colors.muted, fontSize: 11 },
  inlineError: { color: colors.danger, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  replayHint: { padding: 10, borderRadius: 12, backgroundColor: '#FFF8EA', flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  replayHintText: { flex: 1, color: colors.warning, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  notice: { padding: 11, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  noticeSuccess: { borderColor: '#B9DFC9', backgroundColor: '#E9F7EF' },
  noticeWarning: { borderColor: '#F0C474', backgroundColor: '#FFF8EA' },
  noticeError: { borderColor: '#F1BBBB', backgroundColor: '#FDECEC' },
  noticeCopy: { flex: 1, minWidth: 0 },
  noticeTitle: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  noticeText: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
});
