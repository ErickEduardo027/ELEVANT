import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev preview only — not the project's chosen framework (see README.md).
export default defineConfig({
  plugins: [react()],
});
