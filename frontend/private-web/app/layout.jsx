import '../src/styles/tokens.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';
import '../src/styles/occ.css';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { Manrope, IBM_Plex_Mono } from 'next/font/google';
import Providers from './providers';
import FormValidationMessages from '../src/components/FormValidationMessages';
import { occThemeBootScript } from '../src/features/shell/occTheme';

const manrope = Manrope({ subsets: ['latin'], display: 'swap', variable: '--font-manrope' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'],
  display: 'swap', variable: '--font-plex-mono' });

export const metadata = {
  title: 'AVIAM Web | ELEVANT',
  description: 'Aplicación interna de operaciones AVIAM.',
  icons: { icon: '/brand/elevant-logo.png' },
};

export default async function RootLayout({ children }) {
  await connection();
  // proxy.js puts the request nonce in this header and in the Content-Security-Policy.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // The boot script adds the `dark` class on OCC paths before React hydrates,
    // so the class list of <html> may differ from the one rendered here. The
    // browser also blanks the nonce attribute once it has parsed the script.
    <html lang="es" className={`${manrope.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: occThemeBootScript() }} />
      </head>
      <body>
        <FormValidationMessages />
        <Providers>
          <Suspense fallback={<main role="status" className="min-h-screen bg-surface-light p-8 text-ink-900 dark:bg-surface-dark dark:text-text-primary-dark">Cargando…</main>}>
            {children}
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
