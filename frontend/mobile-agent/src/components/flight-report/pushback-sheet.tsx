import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { PushbackConcern } from '../../features/assigned-operations/pushback';
import { colors } from '../../theme/colors';
import { space, type } from '../../theme/tokens';
import { SheetFrame } from '../sheet-frame';
import { Card, PrimaryButton } from '../ui';

/**
 * «¿Registrar el push-back ahora?» (N2, D-N2): before the first push-back of an operation whose flight is not recorded
 * as it should be, the tablet lists its reasons and what recording it does, and the agent decides. It only asks:
 * REGISTRAR PUSH-BACK records it, and VOLVER, the header's button and Android's back button close it without recording.
 */
export function PushbackSheet({ eyebrow, concerns, effect, onClose, onConfirm }: Readonly<{
  /** The phase the push-back belongs to, as its tab names it. */
  eyebrow: string;
  concerns: readonly PushbackConcern[];
  /** What recording it does (`pushbackEffect`). */
  effect: string;
  onClose: () => void;
  onConfirm: () => void;
}>) {
  return (
    <SheetFrame
      eyebrow={eyebrow}
      title="¿Registrar el push-back ahora?"
      closeLabel="Cerrar sin registrar"
      onClose={onClose}
      actions={(
        <>
          <PrimaryButton icon="arrow-back" onPress={onClose} secondary title="VOLVER" />
          <PrimaryButton icon="checkmark" onPress={onConfirm} title="REGISTRAR PUSH-BACK" />
        </>
      )}
    >
      <Text style={styles.intro}>Antes de registrarlo, revisa:</Text>
      {/* On white, as the hand-off sheet lists its requirements. */}
      <Card>
        <View style={styles.list}>
          {concerns.map(concern => (
            <View key={concern.kind} accessible accessibilityLabel={concern.text} style={styles.row}>
              <Ionicons name="warning" size={22} color={colors.warning} />
              <Text style={styles.reason}>{concern.text}</Text>
            </View>
          ))}
        </View>
      </Card>
      <View style={styles.effect}>
        <Ionicons name="alert-circle-outline" size={22} color={colors.warning} />
        <Text style={styles.effectText}>{effect}</Text>
      </View>
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  intro: { ...type.body, color: colors.ink },
  list: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  reason: { ...type.body, flex: 1, minWidth: 0, color: colors.ink },
  effect: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0C474',
    backgroundColor: '#FFF8EA',
  },
  effectText: { ...type.body, flex: 1, color: colors.ink },
});
