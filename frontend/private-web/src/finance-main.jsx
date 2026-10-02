import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.jsx';
import { ThemeProvider } from './features/shell/useTheme.jsx';
import { LanguageProvider } from './features/shell/useLanguage.jsx';
import './styles/tokens.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>,
);
