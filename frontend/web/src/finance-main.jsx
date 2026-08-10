import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import FinanceShell from './features/finance/shell/FinanceShell.jsx';
import './styles/tokens.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FinanceShell />
  </StrictMode>,
);
