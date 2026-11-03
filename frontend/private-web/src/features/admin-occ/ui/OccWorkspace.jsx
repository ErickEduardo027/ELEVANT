'use client';

import { usePathname } from 'next/navigation';
import styles from './OccWorkspace.module.css';
import refinement from './OccRefinement.module.css';

/** Opt-in presentation boundary. Panorama never receives this wrapper or its styles. */
export default function OccWorkspace({ children }) {
  const pathname = usePathname();
  if (pathname === '/admin-occ/dashboard' || pathname?.startsWith('/admin-occ/dashboard/')) return children;
  const moduleId = pathname?.split('/')[2] ?? '';
  return <div className={`${styles.workspace} ${refinement.refined}`} data-occ-workspace={moduleId}>{children}</div>;
}
