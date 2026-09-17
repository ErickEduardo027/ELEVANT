import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
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
  getMobileSession,
  loginMobileAgent,
  MobileServiceError,
} from '../services/mobile-auth';
import { colors } from '../theme/colors';
import { exitApplication } from '../utils/app-exit';

export default function LoginScreen() {
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);

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
      if (!request.signal.aborted) setError(loginErrorMessage(loginError));
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  const sessionNotice = notice === 'session_expired'
    ? 'Tu sesión terminó. Inicia sesión nuevamente para continuar.'
    : notice === 'access_revoked'
      ? 'Tu cuenta ya no tiene un perfil operativo válido. Contacta a AVIAM antes de reintentar.'
      : '';

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
            <Text accessibilityRole="header" style={styles.introTitle}>Acceso operativo</Text>
            <Text style={styles.introText}>Usa tu cuenta individual de AVIAM.</Text>
          </View>

          {!!sessionNotice && (
            <View accessibilityLiveRegion="polite" style={styles.noticeBox}>
              <Ionicons name="time-outline" size={19} color={colors.warning} />
              <Text style={styles.noticeText}>{sessionNotice}</Text>
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
  if (error.code === 'forbidden') return 'Esta cuenta no tiene acceso a la aplicación de rampa.';
  if (error.code === 'network_unavailable') return 'No hay conexión con la red privada de ELEVANT.';
  if (error.code === 'storage_unavailable') return 'No pudimos proteger la sesión en este dispositivo.';
  return 'No pudimos iniciar sesión. Inténtalo nuevamente.';
}

const styles = StyleSheet.create({
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
