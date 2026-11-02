import Link from 'next/link';
import { useOptionalDepartmentAccess } from '../../access/DepartmentAccessContext';
import { useTranslation } from '../../../i18n/LanguageScope';
import { occUiMessages } from './occUiMessages';
import styles from './OccWorkspace.module.css';

/** Contextual access preserves each route's independent server-resolved grant. */
export default function OccContextLinks() {
  const access = useOptionalDepartmentAccess();
  const { t } = useTranslation(occUiMessages);
  const links = [
    ['operations.flight_monitoring.read', '/admin-occ/flight-monitoring', 'flights'],
    ['operations.positions_map.read', '/admin-occ/positions-map', 'positions'],
  ].filter(([permission]) => access?.can(permission));
  if (!links.length) return null;
  return <div className={styles.contextLinks}>{links.map(([, path, label]) => <Link key={path} href={path}>{t(label)}</Link>)}</div>;
}
