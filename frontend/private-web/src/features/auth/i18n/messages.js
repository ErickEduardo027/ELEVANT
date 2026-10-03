export const SUPPORTED_LANGUAGES = ['es', 'en'];
export const DEFAULT_LANGUAGE = 'es';

export const messages = {
  es: {
    brandAlt: 'ELEVANT',
    showcase: {
      caption: 'Operamos con las mejores aerolíneas',
      airlines: 'Aerolíneas con las que operamos',
    },
    controls: {
      language: 'Idioma',
      languageOption: { es: 'Español', en: 'English' },
      theme: 'Tema',
      light: 'Cambiar a tema claro',
      dark: 'Cambiar a tema oscuro',
    },
    login: {
      welcome: 'Bienvenido a',
      subtitle: 'Elevando la gestión de operaciones en tierra.',
      email: 'Correo electrónico',
      password: 'Contraseña',
      showPassword: 'Mostrar contraseña',
      hidePassword: 'Ocultar contraseña',
      remember: 'Recordar sesión',
      forgot: '¿Olvidaste tu contraseña?',
      recoveryHelp: 'La recuperación en línea aún no está disponible. Contacta al equipo responsable de tu acceso para recibir ayuda.',
      submit: 'Iniciar sesión',
      submitting: 'Autenticando…',
      done: 'Acceso concedido',
      restricted: 'Acceso exclusivo para personal autorizado',
    },
    activation: {
      title: 'Activa tu cuenta',
      subtitle: 'Cambia la contraseña temporal de {email} antes de iniciar sesión. No recibirás una sesión hasta completar este paso.',
      current: 'Contraseña temporal',
      next: 'Nueva contraseña',
      confirm: 'Confirmar nueva contraseña',
      submit: 'Cambiar contraseña',
      submitting: 'Cambiando…',
      back: 'Volver al inicio de sesión',
      show: 'Mostrar',
      hide: 'Ocultar',
    },
    validation: {
      emailRequired: 'Ingresa tu correo electrónico.',
      emailInvalid: 'Ingresa un correo electrónico válido.',
      passwordRequired: 'Ingresa tu contraseña.',
      confirmationMismatch: 'La confirmación no coincide con la nueva contraseña.',
    },
    errors: {
      invalid_credentials: 'Credenciales inválidas.',
      no_access: 'Esta cuenta no tiene acceso a AVIAM Web.',
      invalid_current_password: 'La contraseña actual no es válida.',
      password_policy: 'La nueva contraseña no cumple la política: mínimo 14 caracteres, mayúscula, minúscula, número y símbolo.',
      generic: 'No fue posible completar la autenticación.',
      change_generic: 'No fue posible cambiar la contraseña.',
    },
    notices: {
      password_updated: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.',
    },
  },
  en: {
    brandAlt: 'ELEVANT',
    showcase: {
      caption: 'We operate with the best airlines',
      airlines: 'Airlines we operate with',
    },
    controls: {
      language: 'Language',
      languageOption: { es: 'Español', en: 'English' },
      theme: 'Theme',
      light: 'Switch to light theme',
      dark: 'Switch to dark theme',
    },
    login: {
      welcome: 'Welcome to',
      subtitle: 'Elevating the management of ground operations.',
      email: 'Email address',
      password: 'Password',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      remember: 'Remember me',
      forgot: 'Forgot your password?',
      recoveryHelp: 'Online recovery is not available yet. Contact the team responsible for your access to get help.',
      submit: 'Sign in',
      submitting: 'Signing in…',
      done: 'Access granted',
      restricted: 'Exclusive access for authorized personnel',
    },
    activation: {
      title: 'Activate your account',
      subtitle: 'Change the temporary password for {email} before signing in. You will not receive a session until this step is complete.',
      current: 'Temporary password',
      next: 'New password',
      confirm: 'Confirm new password',
      submit: 'Change password',
      submitting: 'Changing…',
      back: 'Back to sign in',
      show: 'Show',
      hide: 'Hide',
    },
    validation: {
      emailRequired: 'Enter your email address.',
      emailInvalid: 'Enter a valid email address.',
      passwordRequired: 'Enter your password.',
      confirmationMismatch: 'The confirmation does not match the new password.',
    },
    errors: {
      invalid_credentials: 'Invalid credentials.',
      no_access: 'This account does not have access to AVIAM Web.',
      invalid_current_password: 'The current password is not valid.',
      password_policy: 'The new password does not meet the policy: at least 14 characters, uppercase, lowercase, number and symbol.',
      generic: 'We could not complete the authentication.',
      change_generic: 'We could not change the password.',
    },
    notices: {
      password_updated: 'Password updated. Sign in with your new password.',
    },
  },
};

// Spanish messages thrown by authService before error codes existed.
const LEGACY_MESSAGE_CODES = {
  'Credenciales inválidas.': 'invalid_credentials',
  'Esta cuenta no tiene acceso a AVIAM Web.': 'no_access',
  'La contraseña actual no es válida.': 'invalid_current_password',
};

export function resolveErrorCode(error, fallback = 'generic') {
  if (error?.code && error.code in messages.es.errors) return error.code;
  return LEGACY_MESSAGE_CODES[error?.message] ?? fallback;
}

export function resolveInitialLanguage(storedValue) {
  return SUPPORTED_LANGUAGES.includes(storedValue) ? storedValue : DEFAULT_LANGUAGE;
}
