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
import { PrimaryButton } from '../components/ui';
import {
  changeMobileAgentPassword,
  getMobileSession,
  loginMobileAgent,
  MobileServiceError,
} from '../services/mobile-auth';
import { colors } from '../theme/colors';
import { exitApplication } from '../utils/app-exit';
import {
  isLocalDevelopmentAuthEnabled,
  LOCAL_DEVELOPMENT_EMAIL,
  LOCAL_DEVELOPMENT_TEMPORARY_PASSWORD,
} from '../services/local-development-auth';

export default function LoginScreen() {
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [activationRequired, setActivationRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const localDevelopment = isLocalDevelopmentAuthEnabled();

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
      if (!request.signal.aborted) {
        if (
          loginError instanceof MobileServiceError &&
          loginError.code === 'password_change_required'
        ) {
          setActivationRequired(true);
          setError('');
        } else {
          setError(loginErrorMessage(loginError));
        }
      }
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  const activate = async () => {
    if (newPassword.length < 14) {
      setError('La nueva contraseña debe tener al menos 14 caracteres.');
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    if (newPassword === password) {
      setError('La nueva contraseña debe ser diferente de la temporal.');
      return;
    }

    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setBusy(true);
    setError('');
    try {
      await changeMobileAgentPassword(
        email.trim(),
        password,
        newPassword,
        { signal: request.signal },
      );
      if (!request.signal.aborted) router.replace('/home');
    } catch (activationError) {
      if (!request.signal.aborted) setError(passwordChangeErrorMessage(activationError));
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  const sessionNotice = notice === 'session_expired'
    ? 'Tu sesión terminó. Inicia sesión nuevamente para continuar.'
    : notice === 'access_revoked'
      ? 'Tu cuenta ya no tiene un perfil operativo válido. Contacta a AVIAM antes de reintentar.'
      : '';

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

          <View style={styles.form}>
          <View style={styles.intro}>
            <Text accessibilityRole="header" style={styles.introTitle}>
              {activationRequired ? 'Activa tu cuenta' : 'Acceso operativo'}
            </Text>
            <Text style={styles.introText}>
              {activationRequired
                ? 'Cambia la contraseña temporal antes de iniciar tu primera operación.'
                : 'Usa tu cuenta individual de AVIAM.'}
            </Text>
          </View>

          {!!sessionNotice && (
            <View accessibilityLiveRegion="polite" style={styles.noticeBox}>
              <Ionicons name="time-outline" size={19} color={colors.warning} />
              <Text style={styles.noticeText}>{sessionNotice}</Text>
            </View>
          )}

          {localDevelopment && !activationRequired && (
            <Pressable
              accessibilityLabel="Completar acceso local de desarrollo"
              accessibilityRole="button"
              onPress={() => {
                setEmail(LOCAL_DEVELOPMENT_EMAIL);
                setPassword(LOCAL_DEVELOPMENT_TEMPORARY_PASSWORD);
                setError('');
              }}
              style={styles.localAccess}
            >
              <Ionicons name="construct-outline" size={19} color={colors.warning} />
              <View style={styles.localAccessCopy}>
                <Text style={styles.localAccessTitle}>Acceso local de desarrollo</Text>
                <Text style={styles.localAccessText}>Toca aquí para completar la cuenta temporal.</Text>
              </View>
            </Pressable>
          )}

          <View style={styles.inputBox}>
            <Ionicons name="mail-outline" size={22} color={colors.navy} />
            <TextInput
              accessibilityLabel="Correo de la cuenta AVIAM"
              autoCapitalize="none"
              autoComplete="email"
              editable={!busy && !activationRequired}
              keyboardType="email-address"
              onChangeText={setEmail}
              onSubmitEditing={() => undefined}
              placeholder="correo@aviam.test"
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
              editable={!busy && !activationRequired}
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

          {activationRequired && (
            <>
              <View style={styles.activationNotice}>
                <Ionicons name="key-outline" size={19} color={colors.navy} />
                <Text style={styles.activationNoticeText}>
                  Usa 14 caracteres o más. La contraseña se guarda únicamente en el almacenamiento seguro.
                </Text>
              </View>
              <View style={styles.inputBox}>
                <Ionicons name="lock-closed-outline" size={22} color={colors.navy} />
                <TextInput
                  accessibilityLabel="Nueva contraseña"
                  autoComplete="new-password"
                  editable={!busy}
                  onChangeText={setNewPassword}
                  placeholder="Nueva contraseña"
                  secureTextEntry
                  style={styles.input}
                  textContentType="newPassword"
                  value={newPassword}
                />
              </View>
              <View style={styles.inputBox}>
                <Ionicons name="shield-checkmark-outline" size={22} color={colors.navy} />
                <TextInput
                  accessibilityLabel="Confirmar nueva contraseña"
                  autoComplete="new-password"
                  editable={!busy}
                  onChangeText={setPasswordConfirmation}
                  onSubmitEditing={() => void activate()}
                  placeholder="Confirmar nueva contraseña"
                  returnKeyType="go"
                  secureTextEntry
                  style={styles.input}
                  textContentType="newPassword"
                  value={passwordConfirmation}
                />
              </View>
            </>
          )}

          {!!error && <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text>}
          <PrimaryButton
            title={busy || checkingSession
              ? 'VERIFICANDO…'
              : activationRequired ? 'ACTIVAR Y CONTINUAR' : 'INICIAR SESIÓN'}
            icon={activationRequired ? 'key-outline' : 'log-in-outline'}
            onPress={() => void (activationRequired ? activate() : login())}
            disabled={busy || checkingSession}
          />
          {activationRequired && (
            <PrimaryButton
              title="VOLVER AL ACCESO"
              icon="arrow-back-outline"
              onPress={() => {
                setActivationRequired(false);
                setNewPassword('');
                setPasswordConfirmation('');
                setError('');
              }}
              secondary
            />
          )}
          <PrimaryButton title="SALIR" icon="exit-outline" onPress={exitApplication} secondary />
          <View style={styles.securityNote}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.success} />
            <Text style={styles.securityText}>La sesión se guarda en el almacenamiento seguro del dispositivo.</Text>
          </View>
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
  if (error.code === 'device_conflict') {
    return 'El registro seguro del dispositivo entró en conflicto. Abre la aplicación nuevamente y vuelve a intentar. Si persiste, contacta a AVIAM.';
  }
  if (error.code === 'network_unavailable') return 'No hay conexión con la red privada de ELEVANT.';
  if (error.code === 'request_timeout') return 'ELEVANT tardó demasiado en responder. Inténtalo nuevamente.';
  if (error.code === 'storage_unavailable') return 'No pudimos proteger la sesión en este dispositivo.';
  return 'No pudimos iniciar sesión. Inténtalo nuevamente.';
}

function passwordChangeErrorMessage(error: unknown) {
  if (!(error instanceof MobileServiceError)) {
    return 'No pudimos activar la cuenta. Inténtalo nuevamente.';
  }
  if (error.code === 'cancelled') return '';
  if (error.code === 'authentication_failed') {
    return 'La contraseña temporal dejó de ser válida. Vuelve al acceso e inténtalo nuevamente.';
  }
  if (error.code === 'network_unavailable') return 'No hay conexión con la red privada de ELEVANT.';
  if (error.code === 'request_timeout') return 'ELEVANT tardó demasiado en responder. Inténtalo nuevamente.';
  if (error.code === 'storage_unavailable') return 'No pudimos proteger la nueva sesión en este dispositivo.';
  if (error.code === 'request_failed') return 'La nueva contraseña no cumple la política o el servicio no está disponible.';
  return 'No pudimos activar la cuenta. Inténtalo nuevamente.';
}

const styles = StyleSheet.create({
  checking: { alignItems: 'center', justifyContent: 'center' },
  safe: { flex: 1, backgroundColor: colors.white },
  keyboard: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  hero: { alignItems: 'center', marginTop: 10 },
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
  activationNotice: {
    padding: 11,
    borderRadius: 12,
    backgroundColor: colors.paleBlue,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activationNoticeText: { flex: 1, color: colors.navy, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  localAccess: {
    padding: 11,
    borderWidth: 1,
    borderColor: '#F0C474',
    borderRadius: 12,
    backgroundColor: '#FFF8EA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  localAccessCopy: { flex: 1 },
  localAccessTitle: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  localAccessText: { color: colors.muted, fontSize: 11, marginTop: 2 },
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
  footer: { alignItems: 'center', marginBottom: 22 },
  footerTitle: { color: colors.navy, fontSize: 12, letterSpacing: 2.2, fontWeight: '800' },
  footerAccent: { color: colors.orange, fontSize: 13, letterSpacing: 2.2, fontWeight: '900', marginTop: 4 },
});
