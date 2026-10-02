import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import router from './app/router.jsx';
import { AuthProvider } from './features/auth/AuthContext.jsx';
import { ThemeProvider } from './features/shell/useTheme.jsx';
import { LanguageProvider } from './features/shell/useLanguage.jsx';
import './styles/tokens.css';

// MapLibre resolves its default worker relative to its own module URL. Vite bundles that module
// into a hashed asset, so the default URL points to a file that is not in dist. Let Vite bundle
// and fingerprint the worker (and its imports), then configure it before either map mounts.
setWorkerUrl(maplibreWorkerUrl);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>,
);
