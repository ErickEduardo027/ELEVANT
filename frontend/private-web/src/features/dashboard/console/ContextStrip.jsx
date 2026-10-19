import { useEffect, useState } from 'react';
import { RefreshCwIcon } from '../../shell/components/icons';
import { formatOperationalDate, formatTime } from './format';

function useStationClock(locale, timeZone) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now && timeZone ? formatTime(now.toISOString(), locale, timeZone) : '--:--';
}

function Fact({ label, hint, children }) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-occ-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm font-medium text-occ-text">{children}</dd>
    </div>
  );
}

export default function ContextStrip({ t, locale, data, refreshing, refreshFailed, fetchedAt, onRefresh }) {
  const timeZone = data?.station?.ianaTimeZone;
  const localTime = useStationClock(locale, timeZone);
  const consulted = fetchedAt ? formatTime(fetchedAt, locale, timeZone) : '--:--';

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-occ-accent">{t('eyebrow')}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-occ-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-occ-muted">{t('subtitle')}</p>
      </div>
      {data && (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <dl className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <Fact label={t('context.operationalDate')}>
              <time dateTime={data.date}>{formatOperationalDate(data.date, locale)}</time>
            </Fact>
            <Fact label={t('context.localTime')} hint={t('context.localTimeHint')}>{localTime}</Fact>
            <Fact label={t('context.consulted')} hint={t('context.consultedHint')}>
              <span aria-live="polite">{refreshing ? t('context.refreshing') : consulted}</span>
            </Fact>
          </dl>
          <button type="button" onClick={onRefresh} disabled={refreshing}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-occ-line bg-occ-panel px-3 text-xs font-semibold text-occ-text hover:border-occ-line-strong disabled:opacity-60">
            <RefreshCwIcon className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {t('context.refresh')}
          </button>
        </div>
      )}
      {refreshFailed && (
        <p role="status" className="w-full rounded-md border border-occ-line-strong bg-occ-panel px-3 py-2 text-xs text-occ-warn">
          {t('states.refreshFailed', { time: consulted })}
        </p>
      )}
    </header>
  );
}
