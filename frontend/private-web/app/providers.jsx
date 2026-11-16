'use client';

import { useEffect } from 'react';
import { AuthProvider } from '../src/features/auth/AuthContext';
import { ThemeProvider } from '../src/features/shell/useTheme';
import { suppressExpectedEffectAbort } from '../src/lib/abort';

export default function Providers({ children }) {
  useEffect(() => {
    const onUnhandledRejection = event => {
      suppressExpectedEffectAbort(event);
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection, true);
    return () => window.removeEventListener('unhandledrejection', onUnhandledRejection, true);
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}
