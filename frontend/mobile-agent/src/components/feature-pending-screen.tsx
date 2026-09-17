import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { PrimaryButton } from './ui';

export function FeaturePendingScreen({
  description,
  title,
}: {
  readonly description: string;
  readonly title: string;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.container}>
      <View style={styles.icon}>
        <Ionicons name="shield-checkmark-outline" size={38} color={colors.navy} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={20} color={colors.blue} />
        <Text style={styles.noteText}>
          Esta versión evita registrar acciones incompletas. La función se habilitará cuando su ejecución pueda guardarse y auditarse de forma segura.
        </Text>
      </View>
      <PrimaryButton
        title="VOLVER A OPERACIONES"
        icon="arrow-back"
        onPress={() => router.replace('/home')}
        secondary
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 13,
    backgroundColor: colors.background,
  },
  icon: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paleBlue,
  },
  title: { color: colors.ink, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  description: { maxWidth: 380, color: colors.muted, lineHeight: 21, textAlign: 'center' },
  note: {
    maxWidth: 400,
    marginVertical: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#C8D7EC',
    borderRadius: 14,
    backgroundColor: '#EDF4FC',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  noteText: { flex: 1, color: colors.navy, fontSize: 13, lineHeight: 19, fontWeight: '700' },
});
