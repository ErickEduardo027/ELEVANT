import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme/colors';
import { meetsPasswordPolicy, PASSWORD_MAX_LENGTH, passwordRules } from '../utils/password-policy';
import { PrimaryButton } from './ui';

export type TemporaryPasswordChangeStatus = 'idle' | 'changing' | 'signing_in';

/**
 * «Cambia tu contraseña temporal»: an account Gestión Humana created with a temporary password replaces it before its
 * first session. The screen that renders it decides what submitting does; the passwords live only in this state.
 */
export function TemporaryPasswordChange({
  email,
  initialCurrentPassword,
  status,
  error,
  onSubmit,
  onCancel,
}: {
  email: string;
  initialCurrentPassword: string;
  status: TemporaryPasswordChangeStatus;
  error: string;
  onSubmit: (currentPassword: string, newPassword: string) => void;
  onCancel: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState(initialCurrentPassword);
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [localError, setLocalError] = useState('');
  const busy = status !== 'idle';
  const rules = passwordRules(newPassword, currentPassword);

  const submit = () => {
    if (busy) return;
    if (!currentPassword) {
      setLocalError('Escribe la contraseña temporal que te entregó Gestión Humana.');
      return;
    }
    if (!meetsPasswordPolicy(newPassword, currentPassword)) {
      setLocalError('La nueva contraseña todavía no cumple todos los requisitos de la lista.');
      return;
    }
    if (newPassword !== confirmation) {
      setLocalError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    setLocalError('');
    onSubmit(currentPassword, newPassword);
  };

  const shownError = localError || error;
  const field = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: { autoComplete: 'current-password' | 'new-password'; placeholder: string; last?: boolean },
  ) => (
    <View style={styles.inputBox}>
      <Ionicons name="lock-closed-outline" size={22} color={colors.navy} />
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoComplete={options.autoComplete}
        autoCorrect={false}
        editable={!busy}
        maxLength={PASSWORD_MAX_LENGTH}
        onChangeText={text => {
          onChange(text);
          setLocalError('');
        }}
        onSubmitEditing={options.last ? submit : undefined}
        placeholder={options.placeholder}
        returnKeyType={options.last ? 'go' : 'next'}
        secureTextEntry={!visible}
        style={styles.input}
        textContentType={options.autoComplete === 'new-password' ? 'newPassword' : 'password'}
        value={value}
      />
    </View>
  );

  return (
    <View style={styles.form}>
      <View>
        <Text accessibilityRole="header" style={styles.title}>Cambia tu contraseña temporal</Text>
        <Text style={styles.text}>
          Antes de entrar debes reemplazar la contraseña temporal de <Text style={styles.email}>{email}</Text>.
        </Text>
      </View>

      {field('Contraseña temporal', currentPassword, setCurrentPassword, {
        autoComplete: 'current-password',
        placeholder: 'Contraseña temporal',
      })}
      {field('Nueva contraseña', newPassword, setNewPassword, {
        autoComplete: 'new-password',
        placeholder: 'Nueva contraseña',
      })}
      {field('Confirmar nueva contraseña', confirmation, setConfirmation, {
        autoComplete: 'new-password',
        placeholder: 'Confirmar nueva contraseña',
        last: true,
      })}

      <Pressable
        accessibilityLabel={visible ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
        accessibilityRole="button"
        accessibilityState={{ checked: visible }}
        onPress={() => setVisible(value => !value)}
        style={styles.toggle}
      >
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.navy} />
        <Text style={styles.toggleText}>{visible ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}</Text>
      </Pressable>

      <View accessibilityLabel="Requisitos de la nueva contraseña" style={styles.rules}>
        {rules.map(rule => (
          <View
            accessible
            accessibilityLabel={`${rule.label}: ${rule.met ? 'cumplido' : 'pendiente'}`}
            key={rule.id}
            style={styles.rule}
            testID={`password-rule-${rule.id}`}
          >
            <Ionicons
              name={rule.met ? 'checkmark-circle' : 'ellipse-outline'}
              size={18}
              color={rule.met ? colors.success : colors.muted}
            />
            <Text style={[styles.ruleText, rule.met && styles.ruleMet]}>{rule.label}</Text>
          </View>
        ))}
        {confirmation.length > 0 && (
          <View accessible accessibilityLabel={`La confirmación ${confirmation === newPassword ? 'coincide' : 'no coincide'}`} style={styles.rule}>
            <Ionicons
              name={confirmation === newPassword ? 'checkmark-circle' : 'close-circle-outline'}
              size={18}
              color={confirmation === newPassword ? colors.success : colors.danger}
            />
            <Text style={[styles.ruleText, confirmation === newPassword && styles.ruleMet]}>
              {confirmation === newPassword ? 'La confirmación coincide' : 'La confirmación no coincide'}
            </Text>
          </View>
        )}
      </View>

      {!!shownError && <Text accessibilityLiveRegion="assertive" style={styles.error}>{shownError}</Text>}
      <PrimaryButton
        title={status === 'changing' ? 'CAMBIANDO…' : status === 'signing_in' ? 'INICIANDO SESIÓN…' : 'CAMBIAR CONTRASEÑA'}
        icon="key-outline"
        onPress={submit}
        disabled={busy}
      />
      <PrimaryButton title="VOLVER" icon="arrow-back-outline" onPress={onCancel} disabled={busy} secondary />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  title: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  text: { color: colors.muted, fontSize: 13, marginTop: 3, lineHeight: 18 },
  email: { color: colors.ink, fontWeight: '800' },
  inputBox: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 15,
    backgroundColor: '#FBFCFE',
  },
  input: { flex: 1, minHeight: 54, fontSize: 16, color: colors.ink },
  toggle: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8 },
  toggleText: { color: colors.navy, fontSize: 14, fontWeight: '800' },
  rules: { gap: 6, padding: 12, borderRadius: 12, backgroundColor: colors.background },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleText: { color: colors.muted, fontSize: 13 },
  ruleMet: { color: colors.success, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 12, fontWeight: '700', lineHeight: 17 },
});
