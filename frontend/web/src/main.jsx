import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import router from './app/router.jsx';
import { AuthProvider } from './features/auth/AuthContext.jsx';
import { ThemeProvider } from './features/shell/useTheme.jsx';
import './styles/tokens.css';
import PrototypeShortcut from './features/prototype/PrototypeShortcut.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <PrototypeShortcut />
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
