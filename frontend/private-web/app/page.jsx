'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  useEffect(() => router.replace('/login'), [router]);
  return <main className="min-h-screen bg-surface-light dark:bg-surface-dark" role="status">Abriendo el inicio de sesión…</main>;
}
