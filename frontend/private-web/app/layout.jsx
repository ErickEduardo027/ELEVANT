import '../src/styles/tokens.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';
import { Suspense } from 'react';
import { connection } from 'next/server';
import Providers from './providers';

export const metadata = {
  title: 'AVIAM Web | ELEVANT',
  description: 'Aplicación interna de operaciones AVIAM.',
  icons: { icon: '/brand/elevant-logo.png' },
};

export default async function RootLayout({ children }) {
  await connection();
  return (
    <html lang="es">
      <body>
        <Providers>
          <Suspense fallback={<main role="status" className="min-h-screen bg-surface-light p-8 text-ink-900 dark:bg-surface-dark dark:text-text-primary-dark">Cargando…</main>}>
            {children}
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
