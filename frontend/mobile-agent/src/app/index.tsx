import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '../theme/colors';
import { PrimaryButton } from '../components/ui';
import { exitApplication } from '../utils/app-exit';
import { loginAgent } from '../services/prototype-api';

export default function LoginScreen() {
  const [user, setUser] = useState('agente@elevant.test');
  const [password, setPassword] = useState('Elevant2026!');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const login = async () => {
    if (!user.trim() || !password.trim()) return setError('Completa el usuario y la contraseña.');
    try { setError(''); await loginAgent(user, password); router.replace('/home'); }
    catch (loginError) { setError(loginError instanceof Error ? loginError.message : 'No fue posible iniciar sesión.'); }
  };
  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <View style={styles.hero}>
        <Image source={require('../../assets/images/elevant-logo.jpeg')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.agent}>AGENTE DE RAMPA</Text>
        <Text style={styles.subtitle}>Operaciones en tierra ágiles, seguras y trazables.</Text>
      </View>
      <View style={styles.form}>
        <View style={styles.inputBox}><Ionicons name="person-outline" size={22} color={colors.navy} /><TextInput value={user} onChangeText={setUser} placeholder="Usuario" autoCapitalize="none" style={styles.input} /></View>
        <View style={styles.inputBox}><Ionicons name="lock-closed-outline" size={22} color={colors.navy} /><TextInput value={password} onChangeText={setPassword} placeholder="Contraseña" secureTextEntry={!visible} style={styles.input} /><Pressable onPress={() => setVisible(!visible)}><Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={23} color={colors.navy} /></Pressable></View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton title="INICIAR SESIÓN" icon="log-in-outline" onPress={login} />
        <PrimaryButton title="SALIR" icon="exit-outline" onPress={exitApplication} secondary />
        <Text style={styles.demo}>Prototipo: puedes usar los datos precargados.</Text>
      </View>
      <View style={styles.footer}><Text style={styles.footerTitle}>ELEVANDO LA GESTIÓN DE</Text><Text style={styles.footerAccent}>OPERACIONES EN TIERRA.</Text></View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white }, container: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  hero: { alignItems: 'center', marginTop: 18 }, logo: { width: 245, height: 245 }, agent: { marginTop: -22, color: colors.navy, fontSize: 20, fontWeight: '900', letterSpacing: 3 }, subtitle: { color: colors.muted, marginTop: 10, textAlign: 'center' },
  form: { gap: 13 }, inputBox: { minHeight: 56, borderWidth: 1, borderColor: colors.border, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, backgroundColor: '#FBFCFE' }, input: { flex: 1, fontSize: 16, color: colors.ink }, error: { color: colors.danger, fontWeight: '600' }, demo: { textAlign: 'center', color: colors.muted, fontSize: 12 },
  footer: { alignItems: 'center', marginBottom: 24 }, footerTitle: { color: colors.navy, fontSize: 12, letterSpacing: 2.2, fontWeight: '800' }, footerAccent: { color: colors.orange, fontSize: 13, letterSpacing: 2.2, fontWeight: '900', marginTop: 4 },
});
