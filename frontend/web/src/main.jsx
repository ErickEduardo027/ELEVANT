import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LoginPage from './features/auth/LoginPage.jsx';
import './styles/tokens.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LoginPage />
  </StrictMode>,
);
