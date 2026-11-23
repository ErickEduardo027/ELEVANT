import { router } from 'expo-router';

export type LoginNotice = 'session_expired' | 'access_revoked';

/**
 * Removes every protected screen before presenting the access screen. Only dismisses when there is a stack to
 * dismiss: on the root screen (home right after sign-in) `dismissAll` has nothing to pop and React Navigation reports
 * «The action 'POP_TO_TOP' was not handled by any navigator».
 */
export function resetToLogin(notice?: LoginNotice) {
  if (router.canDismiss()) router.dismissAll();
  router.replace({
    pathname: '/',
    ...(notice ? { params: { notice } } : {}),
  });
}
