import { useAuth } from '../auth/AuthContext';
import { useTranslation } from '../../i18n/LanguageScope';
import { presenceMessages, resolvePresence } from './presenceStatus';
import styles from './PresencePeople.module.css';

export function PresenceDot({ presence, className = '' }) {
  return <span className={`${styles.dot} ${className}`} data-presence={presence} aria-hidden="true" />;
}

export default function PresencePeople({ participants = [], compact = false }) {
  const { session } = useAuth();
  const { t, locale } = useTranslation(presenceMessages);
  const people = participants.filter(person => person.accountId !== session?.accountId);
  const personRow = person => {
    const presence = resolvePresence(person);
    const date = person.lastActivityAt ? new Date(person.lastActivityAt) : null;
    const last = date && !Number.isNaN(date.getTime()) ? date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '';
    const initials = person.name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    const label = t('status.' + presence);
    return <span key={person.accountId} className={styles.person} data-presence={presence}
      title={[person.name + ': ' + label, person.message, last && t('last') + ': ' + last].filter(Boolean).join(' · ')}>
      <span className={styles.avatar} aria-hidden="true">{initials}<PresenceDot presence={presence} /></span>
      <span className={styles.description}><span className={styles.name}>{person.name}</span>
        <span className={styles.state}>{label}</span>
        {person.message && !compact && <span className={styles.message}>{person.message}</span>}</span>
    </span>;
  };
  if (!people.length) return <span className={styles.missing}><PresenceDot presence="unknown" className={styles.inlineDot} />{t('none')}</span>;
  if (compact) return <span className={styles.compact}>{personRow(people[0])}{people.length > 1 && <span className={styles.extra}
    title={people.slice(1).map(person => person.name + ': ' + t('status.' + resolvePresence(person))).join(', ')}>+{people.length - 1}</span>}</span>;
  return <div className={styles.header}>
    {people.slice(0, 2).map(personRow)}
    {people.length > 2 && <details className={styles.details}><summary>{t('people')} ({people.length})</summary><div className={styles.participants}>{people.map(personRow)}</div></details>}
  </div>;
}
