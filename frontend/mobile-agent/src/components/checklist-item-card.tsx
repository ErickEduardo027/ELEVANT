import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { checklistItemNumber } from '../features/checklist/presentation';
import type { RampChecklistDraftAnswer, RampChecklistItem } from '../services/ramp-operation-checklist';
import { colors } from '../theme/colors';
import { Card } from './ui';

/**
 * One control of the checklist: its number, its label and the OK, N/A and NO answers, with the observation a NO asks
 * for. N12 (D-N12): the control carries one number, the one AVIAM's PDF prints (`checklistItemNumber`), and never its
 * internal code next to a second number.
 */
export function ChecklistItemCard({
  answer,
  disabled,
  index,
  invalid,
  item,
  onChange,
}: {
  readonly answer: RampChecklistDraftAnswer | undefined;
  readonly disabled: boolean;
  /** The control's position within its section, from 0; it numbers a control whose code carries no number. */
  readonly index: number;
  readonly invalid: boolean;
  readonly item: RampChecklistItem;
  readonly onChange: (answer: RampChecklistDraftAnswer) => void;
}) {
  const noteRequired = answer?.value === 'NotOk' && item.requiresNoteWhenNotOk;
  return (
    <Card style={[styles.itemCard, invalid && styles.itemCardInvalid]}>
      <View style={styles.itemHeading}>
        <View style={styles.itemNumber}>
          <Text style={styles.itemNumberText}>{checklistItemNumber(item.code, index)}</Text>
        </View>
        <View style={styles.itemCopy}>
          <Text style={styles.itemLabel}>{item.label}</Text>
          <Text style={styles.requiredLabel}>{item.isRequired ? 'Obligatorio' : 'Opcional'}</Text>
        </View>
      </View>
      <View accessibilityRole="radiogroup" style={styles.answerRow}>
        <AnswerChoice
          checked={answer?.value === 'Ok'}
          context={item.label}
          disabled={disabled}
          icon="checkmark"
          label="OK"
          onPress={() => onChange({ value: 'Ok' })}
          tone="success"
        />
        <AnswerChoice
          checked={answer?.value === 'NotApplicable'}
          context={item.label}
          disabled={disabled}
          icon="remove"
          label="N/A"
          onPress={() => onChange({ value: 'NotApplicable' })}
          tone="neutral"
        />
        <AnswerChoice
          checked={answer?.value === 'NotOk'}
          context={item.label}
          disabled={disabled}
          icon="close"
          label="NO"
          onPress={() => onChange({ value: 'NotOk', ...(answer?.note ? { note: answer.note } : {}) })}
          tone="danger"
        />
      </View>
      {answer?.value === 'NotOk' && (
        <View style={styles.noteGroup}>
          <Text style={styles.noteLabel}>
            Observación {item.requiresNoteWhenNotOk ? '(obligatoria)' : '(opcional)'}
          </Text>
          <TextInput
            accessibilityHint={item.requiresNoteWhenNotOk ? 'Describe por qué el control no cumple' : 'Agrega contexto si es necesario'}
            accessibilityLabel={`Observación para ${item.label}`}
            editable={!disabled}
            maxLength={1000}
            multiline
            onChangeText={(note) => onChange({ value: 'NotOk', note })}
            placeholder="Describe la condición encontrada"
            placeholderTextColor="#7C8798"
            style={[styles.noteInput, noteRequired && !answer.note?.trim() && styles.noteInputInvalid]}
            textAlignVertical="top"
            value={answer.note ?? ''}
          />
          {noteRequired && !answer.note?.trim() && (
            <Text accessibilityLiveRegion="polite" style={styles.inlineError}>
              La observación es obligatoria cuando marcas NO.
            </Text>
          )}
        </View>
      )}
      {invalid && !noteRequired && (
        <Text accessibilityLiveRegion="polite" style={styles.inlineError}>
          Selecciona una respuesta para continuar.
        </Text>
      )}
    </Card>
  );
}

function AnswerChoice({
  checked,
  context,
  disabled,
  icon,
  label,
  onPress,
  tone,
}: {
  readonly checked: boolean;
  readonly context: string;
  readonly disabled: boolean;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone: 'success' | 'neutral' | 'danger';
}) {
  const color = tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.navy;
  return (
    <Pressable
      accessibilityLabel={`Marcar ${context} como ${label}`}
      accessibilityRole="radio"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.answerChoice,
        checked && styles.answerChoiceChecked,
        checked && { borderColor: color, backgroundColor: tone === 'success' ? '#E9F7EF' : tone === 'danger' ? '#FDECEC' : colors.paleBlue },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={checked ? color : colors.muted} />
      <Text style={[styles.answerChoiceText, checked && { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  itemCard: { gap: 14 },
  itemCardInvalid: { borderColor: '#E4A4A4' },
  itemHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  // Grows with a number of three digits or a larger font instead of clipping it.
  itemNumber: {
    minWidth: 32,
    minHeight: 32,
    paddingHorizontal: 6,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  itemNumberText: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  itemCopy: { flex: 1, minWidth: 0 },
  // The label leads the card now that the code is gone: its first line sits level with the number.
  itemLabel: { color: colors.ink, fontSize: 15, fontWeight: '800', lineHeight: 21, marginTop: 5 },
  requiredLabel: { color: colors.muted, fontSize: 11, marginTop: 4 },
  answerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  answerChoice: {
    minWidth: 84,
    minHeight: 50,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  answerChoiceChecked: { borderWidth: 2 },
  answerChoiceText: { color: colors.muted, fontSize: 13, fontWeight: '900' },
  noteGroup: { gap: 6 },
  noteLabel: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  noteInput: {
    minHeight: 96,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    backgroundColor: colors.white,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 21,
  },
  noteInputInvalid: { borderColor: colors.danger },
  inlineError: { color: colors.danger, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
});
