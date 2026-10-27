import { router } from 'expo-router';

export type LoginNotice = 'session_expired' | 'access_revoked';

/** Removes every protected screen before presenting the access screen. */
export function resetToLogin(notice?: LoginNotice) {
  if (router.canDismiss()) {
    router.dismissAll();
  }
  router.replace({
    pathname: '/',
    ...(notice ? { params: { notice } } : {}),
  });
}
