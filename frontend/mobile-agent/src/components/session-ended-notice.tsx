import { Ionicons } from '@expo/vector-icons';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MobileSessionEnd } from '../services/mobile-auth';
import { colors } from '../theme/colors';
import { resetToLogin } from '../utils/session-navigation';
import { PrimaryButton } from './ui';

/** How many screens show their own session notice right now (N6). */
let screenNotices = 0;
const screenNoticeListeners = new Set<() => void>();

function changeScreenNotices(by: 1 | -1) {
  screenNotices += by;
  screenNoticeListeners.forEach((listener) => listener());
}

function subscribeScreenNotices(listener: () => void) {
  screenNoticeListeners.add(listener);
  return () => {
    screenNoticeListeners.delete(listener);
  };
}

/**
 * A screen that shows its own SessionEndedNotice says so while it shows it (N6): the layout's banner waits meanwhile,
 * so the screen shows one notice, one ENTRAR DE NUEVO and one announcement. It is declared before the screen is drawn.
 */
export function useScreenSessionNotice(shown: boolean) {
  useLayoutEffect(() => {
    if (!shown) return undefined;
    changeScreenNotices(1);
    return () => changeScreenNotices(-1);
  }, [shown]);
}

/** Whether a screen shows its own session notice now (N6). */
export function useScreenShowsSessionNotice() {
  return useSyncExternalStore(subscribeScreenNotices, () => screenNotices > 0);
}

/**
 * The session ended without its agent signing out (N6). The notice says so, never blames the device, and offers
 * ENTRAR DE NUEVO instead of leaving the screen on its own (D-N6), so what the agent was doing stays in view.
 * `revoked`: the account lost its access to the app (403), and the access screen explains it.
 */
export function SessionEndedNotice({ message, revoked = false }: {
  readonly message: string;
  readonly revoked?: boolean;
}) {
  return (
    <View accessibilityLiveRegion="assertive" style={styles.notice}>
      <View style={styles.heading}>
        <Ionicons color={colors.danger} name={revoked ? 'lock-closed-outline' : 'time-outline'} size={21} />
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.title}>
            {revoked ? 'Tu cuenta ya no tiene acceso a la aplicación de rampa' : 'Tu sesión terminó'}
          </Text>
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
      <PrimaryButton
        icon="log-in-outline"
        onPress={() => resetToLogin(revoked ? 'access_revoked' : 'session_expired')}
        title="ENTRAR DE NUEVO"
      />
    </View>
  );
}

/**
 * The notice every screen but the access one shows once the tablet ended the session (N6, D-N6): it stays until the
 * agent is back on the access screen, and waits while a screen shows its own notice. What the agent recorded stays on
 * the tablet for its account (3-N12).
 */
export function SessionEndedBanner({ ended }: { readonly ended: MobileSessionEnd }) {
  const revoked = ended.reason === 'forbidden';
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.banner}>
      <SessionEndedNotice
        message={revoked
          ? 'Lo que registraste queda guardado en esta tablet. Contacta a AVIAM antes de volver a entrar.'
          : 'Lo que registraste queda guardado en esta tablet. Entra de nuevo con tu cuenta para enviarlo a ELEVANT.'}
        revoked={revoked}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  notice: {
    padding: 13,
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    borderColor: '#F1BBBB',
    backgroundColor: '#FDECEC',
  },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  copy: { flex: 1, minWidth: 0 },
  title: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  message: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 3 },
  banner: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
});
