import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { HandoffRequirement, HandoffRequirementState } from '../features/assigned-operations/handoff';
import { colors } from '../theme/colors';
import { space, type } from '../theme/tokens';
import { SheetFrame } from './sheet-frame';
import { Card, PrimaryButton } from './ui';

/** Each state has its shape and colour (ADR-0031) and a word, which is what a screen reader says for it. */
const STATES: Readonly<Record<HandoffRequirementState, Readonly<{
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  word: string;
}>>> = {
  ok: { icon: 'checkmark-circle', color: colors.success, word: 'listo' },
  missing: { icon: 'close-circle', color: colors.danger, word: 'falta' },
  unknown: { icon: 'help-circle-outline', color: colors.muted, word: 'por confirmar' },
  warning: { icon: 'warning', color: colors.warning, word: 'revisar' },
};

/**
 * The requirements of the hand-off to OCC with their state (N1), one row each: what the hand-off needs, where it stands
 * and, when the close offers one, the button that leads to it. A row is read as one sentence, «Checklist enviado:
 * falta. Sin enviar: …»; its button stays a separate stop for the screen reader.
 */
export function HandoffRequirementList({ requirements, actionFor }: Readonly<{
  requirements: readonly HandoffRequirement[];
  /** The button a row offers, such as ABRIR CHECKLIST; the confirmation sheet offers none. */
  actionFor?: (requirement: HandoffRequirement) => ReactNode;
}>) {
  return (
    <View style={styles.list}>
      {requirements.map(requirement => {
        const state = STATES[requirement.state];
        const action = actionFor?.(requirement);
        return (
          <View key={requirement.kind} style={styles.item}>
            <View
              accessible
              accessibilityLabel={`${requirement.label}: ${state.word}${requirement.detail ? `. ${requirement.detail}` : ''}`}
              style={styles.row}
            >
              <Ionicons name={state.icon} size={22} color={state.color} />
              <View style={styles.copy}>
                <Text style={styles.label}>{requirement.label}</Text>
                {requirement.detail ? (
                  <Text style={[styles.detail, requirement.state === 'missing' && styles.detailMissing]}>
                    {requirement.detail}
                  </Text>
                ) : null}
              </View>
            </View>
            {action ? <View style={styles.action}>{action}</View> : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * The tablet's own confirmation of the hand-off (N1), instead of a native dialog that asked the agent to confirm what
 * the tablet checks: it lists what the tablet checked and says that the execution closes. SEGUIR REVISANDO, the
 * header's button and Android's back button close it without handing off.
 */
export function HandoffSheet({ title, requirements, canConfirm, onClose, onConfirm }: Readonly<{
  title: string;
  requirements: readonly HandoffRequirement[];
  /** False while something holds the hand-off again, such as a record that just landed in the queue. */
  canConfirm: boolean;
  onClose: () => void;
  onConfirm: () => void;
}>) {
  return (
    <SheetFrame
      eyebrow="CIERRE DE EJECUCIÓN"
      title={title}
      closeLabel="Seguir revisando"
      onClose={onClose}
      actions={(
        <>
          <PrimaryButton icon="arrow-back" onPress={onClose} secondary title="SEGUIR REVISANDO" />
          <PrimaryButton disabled={!canConfirm} icon="send-outline" onPress={onConfirm} title="ENTREGAR A OCC" />
        </>
      )}
    >
      <Text style={styles.intro}>La tablet comprobó lo que la entrega necesita:</Text>
      {/* On white, as on the hand-off card: the muted details keep the AA contrast (4.8:1). */}
      <Card>
        <HandoffRequirementList requirements={requirements} />
      </Card>
      <View style={styles.closing}>
        <Ionicons name="lock-closed-outline" size={22} color={colors.warning} />
        <Text style={styles.closingText}>
          Al entregar, la ejecución queda cerrada para la revisión de OCC: ya no podrás cambiar los servicios, los
          cargos ni el checklist.
        </Text>
      </View>
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  item: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { ...type.label, color: colors.ink },
  detail: { ...type.body, fontSize: 14, color: colors.muted },
  detailMissing: { color: colors.ink },
  action: { paddingLeft: 22 + space.sm },
  intro: { ...type.body, color: colors.ink },
  closing: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0C474',
    backgroundColor: '#FFF8EA',
  },
  closingText: { ...type.body, flex: 1, color: colors.ink },
});
