import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  TemporaryPasswordChange,
  type TemporaryPasswordChangeStatus,
} from '../components/temporary-password-change';
import { PrimaryButton } from '../components/ui';
import {
  changeTemporaryPassword,
  getMobileSession,
  loginMobileAgent,
  MobileServiceError,
  readEndedSession,
  readUnsentRecords,
  type EndedMobileSession,
  type PendingEvidenceCount,
} from '../services/mobile-auth';
import { colors } from '../theme/colors';
import { exitApplication } from '../utils/app-exit';
import { loginPendingEvidenceNotice } from '../utils/pending-evidence';

/** What the previous session left for the access screen: how it ended (N5) and what the tablet keeps unsent (3-N12). */
type PreviousSession = Readonly<{
  ended: EndedMobileSession | null;
  unsent: PendingEvidenceCount | null;
}>;

/** The notice of how the previous session ended (N7); `revoked`: its account lost its access to the app. */
type PreviousSessionNotice = Readonly<{ message: string; revoked: boolean }>;

export default function LoginScreen() {
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const [previous, setPrevious] = useState<PreviousSession | null>(null);
  // N7: the notice of how the previous session ended lasts until the next attempt; a new route notice brings it back.
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  // Gestión Humana's temporary password (409 password_change_required) is replaced on this same screen.
  const [passwordChange, setPasswordChange] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [changeStatus, setChangeStatus] = useState<TemporaryPasswordChangeStatus>('idle');
  const [changeError, setChangeError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const noticeKey = notice ?? '';

  // 3-N12 and N7: how the previous session ended and what it left unsent stay on the tablet; the agent is told before
  // signing in. Reading them first ends a session that already expired.
  useEffect(() => {
    let mounted = true;
    void Promise.all([readEndedSession(), readUnsentRecords()]).then(([ended, unsent]) => {
      if (mounted) setPrevious({ ended, unsent });
    });
    return () => {
      mounted = false;
    };
  }, [notice]);

  useEffect(() => {
    let mounted = true;
    void getMobileSession()
      .then(session => {
        if (mounted && session) router.replace('/home');
      })
      .catch(() => {
        if (mounted) setError('No pudimos abrir el almacenamiento seguro del dispositivo.');
      })
      .finally(() => {
        if (mounted) setCheckingSession(false);
      });

    return () => {
      mounted = false;
      requestRef.current?.abort();
    };
  }, []);

  const login = async () => {
    // N7: from here on the notice of the previous session would read as the outcome of this attempt.
    setDismissedNotice(noticeKey);
    if (!email.trim() || !password) {
      setError('Completa el correo y la contraseña.');
      return;
    }

    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setBusy(true);
    setError('');

    try {
      await loginMobileAgent(email.trim(), password, { signal: request.signal });
      if (!request.signal.aborted) router.replace('/home');
    } catch (loginError) {
      if (request.signal.aborted) return;
      if (loginError instanceof MobileServiceError && loginError.code === 'password_change_required') {
        setPasswordChange({ email: email.trim(), temporaryPassword: password });
        setPassword('');
        setChangeError('');
        setChangeStatus('idle');
      } else {
        setError(loginErrorMessage(loginError));
      }
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!passwordChange) return;
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setChangeError('');
    setChangeStatus('changing');

    try {
      await changeTemporaryPassword(passwordChange.email, currentPassword, newPassword, { signal: request.signal });
    } catch (changeFailure) {
      if (request.signal.aborted) return;
      setChangeStatus('idle');
      setChangeError(passwordChangeErrorMessage(changeFailure));
      return;
    }
    if (request.signal.aborted) return;

    // The temporary password no longer works: sign in with the new one and continue as any other sign-in.
    setChangeStatus('signing_in');
    try {
      await loginMobileAgent(passwordChange.email, newPassword, { signal: request.signal });
      if (!request.signal.aborted) router.replace('/home');
    } catch (loginError) {
      if (request.signal.aborted) return;
      const reason = loginErrorMessage(loginError);
      setEmail(passwordChange.email);
      setPassword('');
      setPasswordChange(null);
      setChangeStatus('idle');
      setError(`Tu contraseña se cambió, pero no pudimos iniciar sesión. ${reason ? `${reason} ` : ''}Entra con tu nueva contraseña.`);
    }
  };

  const cancelPasswordChange = () => {
    requestRef.current?.abort();
    setPasswordChange(null);
    setChangeStatus('idle');
    setChangeError('');
    setError('');
  };

  const sessionNotice = previous && dismissedNotice !== noticeKey ? previousSessionNotice(notice, previous.ended) : null;
  // N7: the agent whose session ended and who comes back to sign in again counts only that account's records; another
  // account's are never its own, and an account that lost its access cannot send them.
  const endedAccountReturns = notice === 'session_expired' && !!previous?.ended && previous.ended.reason !== 'forbidden';
  const evidenceNotice = previous?.unsent ? loginPendingEvidenceNotice(previous.unsent, endedAccountReturns) : null;

  // Mientras se lee la sesión guardada no se muestra el formulario: si existe,
  // la app pasa directo al inicio sin parpadear la pantalla de acceso.
  if (checkingSession && !notice) {
    return (
      <SafeAreaView style={[styles.safe, styles.checking]}>
        <ActivityIndicator accessibilityLabel="Comprobando la sesión" color={colors.navy} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* N7: the logo and the form are one block in the middle of the screen, also in portrait. */}
          <View style={styles.main}>
            <View style={styles.hero}>
              <Image
                accessibilityIgnoresInvertColors
                accessibilityLabel="ELEVANT"
                resizeMode="contain"
                source={require('../../assets/images/elevant-logo.jpeg')}
                style={styles.logo}
              />
              <Text style={styles.agent}>AGENTE DE RAMPA</Text>
              <Text style={styles.subtitle}>Operaciones en tierra ágiles, seguras y trazables.</Text>
            </View>

            {passwordChange ? (
              <TemporaryPasswordChange
                email={passwordChange.email}
                error={changeError}
                initialCurrentPassword={passwordChange.temporaryPassword}
                onCancel={cancelPasswordChange}
                onSubmit={(currentPassword, newPassword) => void changePassword(currentPassword, newPassword)}
                status={changeStatus}
              />
            ) : (
              <View style={styles.form}>
                <View style={styles.intro}>
                  <Text accessibilityRole="header" style={styles.introTitle}>Acceso operativo</Text>
                  <Text style={styles.introText}>Usa tu cuenta individual de AVIAM.</Text>
                </View>

                {sessionNotice && (
                  <View accessibilityLiveRegion="polite" style={styles.noticeBox}>
                    <Ionicons
                      name={sessionNotice.revoked ? 'lock-closed-outline' : 'time-outline'}
                      size={19}
                      color={colors.warning}
                    />
                    <Text style={styles.noticeText}>{sessionNotice.message}</Text>
                  </View>
                )}

                {!!evidenceNotice && (
                  <View accessibilityLiveRegion="polite" style={styles.noticeBox}>
                    <Ionicons name="cloud-upload-outline" size={19} color={colors.warning} />
                    <Text style={styles.noticeText}>{evidenceNotice}</Text>
                  </View>
                )}

                <View style={styles.inputBox}>
                  <Ionicons name="mail-outline" size={22} color={colors.navy} />
                  <TextInput
                    accessibilityLabel="Correo de la cuenta AVIAM"
                    autoCapitalize="none"
                    autoComplete="email"
                    editable={!busy}
                    keyboardType="email-address"
                    onChangeText={setEmail}
                    onSubmitEditing={() => undefined}
                    placeholder="Correo de tu cuenta AVIAM"
                    returnKeyType="next"
                    style={styles.input}
                    textContentType="username"
                    value={email}
                  />
                </View>

                <View style={styles.inputBox}>
                  <Ionicons name="lock-closed-outline" size={22} color={colors.navy} />
                  <TextInput
                    accessibilityLabel="Contraseña de la cuenta AVIAM"
                    autoComplete="password"
                    editable={!busy}
                    onChangeText={setPassword}
                    onSubmitEditing={() => void login()}
                    placeholder="Contraseña"
                    returnKeyType="go"
                    secureTextEntry={!passwordVisible}
                    style={styles.input}
                    textContentType="password"
                    value={password}
                  />
                  <Pressable
                    accessibilityLabel={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() => setPasswordVisible(value => !value)}
                    style={styles.visibilityButton}
                  >
                    <Ionicons
                      name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
                      size={23}
                      color={colors.navy}
                    />
                  </Pressable>
                </View>

                {!!error && <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text>}
                <PrimaryButton
                  title={busy || checkingSession ? 'VERIFICANDO…' : 'INICIAR SESIÓN'}
                  icon="log-in-outline"
                  onPress={() => void login()}
                  disabled={busy || checkingSession}
                />
                <PrimaryButton title="SALIR" icon="exit-outline" onPress={exitApplication} secondary />
                <View style={styles.securityNote}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={colors.success} />
                  <Text style={styles.securityText}>La sesión se guarda en el almacenamiento seguro del dispositivo.</Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerTitle}>ELEVANDO LA GESTIÓN DE</Text>
            <Text style={styles.footerAccent}>OPERACIONES EN TIERRA.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * How the previous session ended, in the past tense and with its cause (N7): the marker of the last session that ended
 * without its agent signing out names it (N5). A 403 the screens met (`access_revoked`) wins: that account cannot
 * sign in again until AVIAM restores its access. Null when no session ended.
 */
function previousSessionNotice(
  notice: string | undefined,
  ended: EndedMobileSession | null,
): PreviousSessionNotice | null {
  const cause = notice === 'access_revoked'
    ? 'forbidden'
    : ended?.reason ?? (notice === 'session_expired' ? 'ended' : null);
  switch (cause) {
    case 'expired':
      return { message: 'La sesión anterior venció. Inicia sesión de nuevo para continuar.', revoked: false };
    case 'refused':
      return {
        message: 'ELEVANT cerró la sesión anterior. Inicia sesión de nuevo; si no puedes entrar, avisa a OCC.',
        revoked: false,
      };
    case 'forbidden':
      return {
        message: 'La cuenta de la sesión anterior perdió el acceso a la aplicación de rampa. '
          + 'Contacta a AVIAM antes de volver a entrar.',
        revoked: true,
      };
    case 'ended':
      return { message: 'La sesión anterior terminó. Inicia sesión de nuevo para continuar.', revoked: false };
    default:
      return null;
  }
}

function loginErrorMessage(error: unknown) {
  if (!(error instanceof MobileServiceError)) {
    return 'No pudimos iniciar sesión. Inténtalo nuevamente.';
  }

  if (error.code === 'cancelled') return '';
  if (error.code === 'authentication_failed') return 'El correo o la contraseña no son válidos.';
  if (error.code === 'unauthenticated' || error.code === 'session_expired') {
    return 'La sesión no pudo confirmarse. Inicia sesión nuevamente.';
  }
  if (error.code === 'forbidden') return 'Esta cuenta no tiene acceso a la aplicación de rampa.';
  // N7 (D-N7): the binding outlives the other agent's session while its operation is in progress, so only OCC can free
  // the tablet; who holds it is not shown.
  if (error.code === 'device_in_use') {
    return 'Esta tablet sigue a nombre de otro agente con una operación en curso. Pide a OCC que la libere en «Tablets» y vuelve a intentarlo.';
  }
  if (error.code === 'device_revoked') {
    return 'OCC revocó esta tablet y ya no puede usarse con ELEVANT. Entrégala a OCC y usa otra tablet.';
  }
  if (error.code === 'device_conflict') {
    return 'El registro seguro del dispositivo entró en conflicto. Abre la aplicación nuevamente y vuelve a intentar. Si persiste, contacta a AVIAM.';
  }
  if (error.code === 'network_unavailable') return 'No hay conexión con la red privada de ELEVANT.';
  if (error.code === 'request_timeout') return 'ELEVANT tardó demasiado en responder. Inténtalo nuevamente.';
  if (error.code === 'storage_unavailable') {
    return 'La tablet no pudo guardar la sesión. Vuelve a intentarlo; si sigue fallando, cierra la app, ábrela de nuevo y avisa a OCC.';
  }
  if (error.code === 'rate_limited') return 'Demasiados intentos. Espera un minuto antes de reintentar.';
  return 'No pudimos iniciar sesión. Inténtalo nuevamente.';
}

function passwordChangeErrorMessage(error: unknown) {
  if (!(error instanceof MobileServiceError)) {
    return 'No pudimos cambiar la contraseña. Inténtalo nuevamente.';
  }

  if (error.code === 'cancelled') return '';
  if (error.code === 'password_policy_rejected') {
    return 'La nueva contraseña no cumple la política: mínimo 14 caracteres, mayúscula, minúscula, número y símbolo.';
  }
  if (error.code === 'current_password_invalid') {
    return 'La contraseña temporal no es válida. Revísala o pide a Gestión Humana una nueva.';
  }
  if (error.code === 'rate_limited') return 'Demasiados intentos. Espera un minuto antes de reintentar.';
  if (error.code === 'network_unavailable') return 'No hay conexión con la red privada de ELEVANT.';
  if (error.code === 'request_timeout') return 'ELEVANT tardó demasiado en responder. Inténtalo nuevamente.';
  return 'No pudimos cambiar la contraseña. Inténtalo nuevamente.';
}

const styles = StyleSheet.create({
  checking: { alignItems: 'center', justifyContent: 'center' },
  safe: { flex: 1, backgroundColor: colors.white },
  keyboard: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16 },
  // N7: the free height goes above this block and above the footer, so the logo and the form sit in the middle of the
  // screen, also in portrait; without free height the block starts at the top and the screen scrolls.
  main: { marginTop: 'auto', gap: 24 },
  hero: { alignItems: 'center' },
  logo: { width: 220, height: 220 },
  agent: { marginTop: -22, color: colors.navy, fontSize: 19, fontWeight: '900', letterSpacing: 3 },
  subtitle: { color: colors.muted, marginTop: 9, textAlign: 'center' },
  form: { gap: 12 },
  intro: { marginBottom: 2 },
  introTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  introText: { color: colors.muted, fontSize: 12, marginTop: 3 },
  noticeBox: {
    padding: 11,
    borderRadius: 12,
    backgroundColor: '#FFF8EA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeText: { flex: 1, color: colors.warning, fontSize: 12, fontWeight: '700' },
  inputBox: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 15,
    backgroundColor: '#FBFCFE',
  },
  input: { flex: 1, minHeight: 54, fontSize: 16, color: colors.ink },
  visibilityButton: { width: 48, height: 54, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  securityNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 8 },
  securityText: { flexShrink: 1, color: colors.muted, fontSize: 12, textAlign: 'center' },
  footer: { alignItems: 'center', marginTop: 'auto', paddingTop: 24, marginBottom: 22 },
  footerTitle: { color: colors.navy, fontSize: 12, letterSpacing: 2.2, fontWeight: '800' },
  footerAccent: { color: colors.orange, fontSize: 13, letterSpacing: 2.2, fontWeight: '900', marginTop: 4 },
});
