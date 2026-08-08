import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

export function PrimaryButton({ title, onPress, icon, disabled, secondary = false }: {
  title: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean; secondary?: boolean;
}) {
  return <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, secondary && styles.secondary, disabled && styles.disabled, pressed && styles.pressed]}>
    {icon && <Ionicons name={icon} size={20} color={secondary ? colors.navy : colors.white} />}
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text>
  </Pressable>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function StatusPill({ text, tone = 'blue' }: { text: string; tone?: 'blue' | 'green' | 'orange' | 'red' }) {
  const palette = tone === 'green' ? [colors.success, '#E9F7EF'] : tone === 'orange' ? [colors.warning, '#FFF7E6'] : tone === 'red' ? [colors.danger, '#FDECEC'] : [colors.blue, colors.paleBlue];
  return <View style={[styles.pill, { backgroundColor: palette[1] }]}><Text style={[styles.pillText, { color: palette[0] }]}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 14, backgroundColor: colors.navy, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 },
  secondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.navy },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.8 },
  buttonText: { color: colors.white, fontWeight: '800', fontSize: 15 }, secondaryText: { color: colors.navy },
  card: { backgroundColor: colors.white, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border, shadowColor: '#081C3A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  pill: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 99 },
  pillText: { fontSize: 12, fontWeight: '800' },
});
