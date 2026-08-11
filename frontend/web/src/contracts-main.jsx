import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ContractsShell from './features/contracts/shell/ContractsShell.jsx';
import './styles/tokens.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ContractsShell />
  </StrictMode>,
);
