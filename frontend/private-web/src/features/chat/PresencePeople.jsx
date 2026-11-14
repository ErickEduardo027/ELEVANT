import { useAuth } from '../auth/AuthContext';
import { useTranslation } from '../../i18n/LanguageScope';
import { PRESENCE_LEGEND, presenceMessages, presenceShape, resolvePresence } from './presenceStatus';
import styles from './PresencePeople.module.css';

// The five presence shapes on a 16 px grid (design D28), drawn in the colour of their dot: filled, filled with a bar,
// half, hollow and dashed. The ring under the shape is the surface the dot sits on (`--presence-surface`), so a dot on
// the corner of an avatar keeps a clear edge without a shadow.
function PresenceGlyph({ shape }) {
  const filled = shape === 'filled' || shape === 'filled-bar';
  let fill = 'outline';
  if (filled) fill = 'solid';
  else if (shape === 'dashed') fill = 'dashed';
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true" className={styles.glyph}>
      <circle className={styles.ring} cx="8" cy="8" r="8" />
      <circle data-part="body" data-fill={fill} className={styles[fill]} cx="8" cy="8" r={filled ? 5.5 : 4.75} />
      {shape === 'filled-bar' ? <rect data-part="bar" className={styles.bar} x="4.5" y="7.1" width="7" height="1.8" rx="0.9" /> : null}
      {shape === 'half' ? <path data-part="half" className={styles.solid} d="M8 3.25a4.75 4.75 0 0 0 0 9.5Z" /> : null}
    </svg>
  );
}

/**
 * A person's presence as a neutral glyph (D28): `data-presence` is the resolved presence and `data-shape` its shape
 * (PRESENCE_SHAPES). It is hidden from assistive technology: the word next to it says the state.
 */
export function PresenceDot({ presence, className = '' }) {
  const shape = presenceShape(presence);
  return (
    <span className={`${styles.dot} ${className}`} data-presence={presence} data-shape={shape} aria-hidden="true">
      <PresenceGlyph shape={shape} />
    </span>
  );
}

/** What each presence shape means, each glyph with its word (contratos 2.4: a board with states shows its legend). */
export function PresenceLegend({ className = '' }) {
  const { t } = useTranslation(presenceMessages);
  return (
    <ul aria-label={t('legend.label')} data-presence-legend="" className={`${styles.legend} ${className}`}>
      {PRESENCE_LEGEND.map(({ shape, presence }) => (
        <li key={shape} data-shape={shape} className={styles.legendItem}>
          <PresenceDot presence={presence} className={styles.inlineDot} />
          <span>{t(`legend.shapes.${shape}`)}</span>
        </li>
      ))}
    </ul>
  );
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
