'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const BADGE_TONE_CLASSES = {
  default: 'bg-signal-500',
  warning: 'bg-status-warning',
  critical: 'bg-status-danger',
};

function ItemContent({ Icon, label, expanded, hasBadge, badgeCount, badgeToneClass, active }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-signal-500 transition-opacity ${
          active ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <Icon className="h-4 w-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />

      {expanded && <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>}

      {expanded && hasBadge && (
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white ${badgeToneClass}`}>
          {badgeCount}
        </span>
      )}

      {!expanded && hasBadge && (
        <span aria-hidden="true" className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${badgeToneClass}`} />
      )}

      {!expanded && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-black/10 bg-white px-2 py-1 text-xs font-medium text-ink-900 opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
        >
          {label}
          {hasBadge && <span className="ml-1 text-signal-500">({badgeCount})</span>}
        </span>
      )}
    </>
  );
}

export default function SidebarItem({ icon: Icon, label, to, active = false, expanded = true, badge, onClick, onNavigate }) {
  const pathname = usePathname();
  const badgeCount = typeof badge === 'number' ? badge : badge?.count;
  const badgeToneClass = BADGE_TONE_CLASSES[(typeof badge === 'object' && badge?.tone) || 'default'];
  const hasBadge = Number.isFinite(badgeCount) && badgeCount > 0;

  const sharedClassName = isActive =>
    `group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
      expanded ? '' : 'justify-center'
    } ${
      isActive
        ? 'bg-accent-600/10 text-accent-600 dark:bg-accent-600/15'
        : 'text-text-secondary-light hover:bg-black/5 hover:text-ink-900 dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark'
    }`;

  if (to) {
    const isActive = pathname === to || (to !== '/' && pathname?.startsWith(`${to}/`));
    return (
      <Link href={to} onClick={onNavigate} aria-current={isActive ? 'page' : undefined} className={sharedClassName(isActive)}>
          <ItemContent
            Icon={Icon}
            label={label}
            expanded={expanded}
            hasBadge={hasBadge}
            badgeCount={badgeCount}
            badgeToneClass={badgeToneClass}
            active={isActive}
          />
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={sharedClassName(active)}>
      <ItemContent
        Icon={Icon}
        label={label}
        expanded={expanded}
        hasBadge={hasBadge}
        badgeCount={badgeCount}
        badgeToneClass={badgeToneClass}
        active={active}
      />
    </button>
  );
}
