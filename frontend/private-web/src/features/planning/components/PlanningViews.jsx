import { useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningViewsMessages } from '../planningViewsMessages';
import styles from './PlanningViews.module.css';
import { getPlanningStatusMeta } from '../planningStatus';

const zoneCache = new Map();
const instantFormatters = new Map();

function validZone(zone) {
  const candidate = zone ?? 'UTC';
  if (zoneCache.has(candidate)) return zoneCache.get(candidate);
  let result = candidate;
  try { new Intl.DateTimeFormat('en', { timeZone: candidate }).format(); }
  catch { result = 'UTC'; }
  zoneCache.set(candidate, result);
  return result;
}

export function planningInstant(value, timeZone = 'UTC') {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const zone = validZone(timeZone);
  if (!instantFormatters.has(zone)) instantFormatters.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' }));
  const parts = instantFormatters.get(zone).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${fields.year}-${fields.month}-${fields.day}`, hour: Number(fields.hour), clock: `${fields.hour}:${fields.minute}`, offset: fields.timeZoneName };
}

export function shiftPlanningDay(day, amount) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const instant = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(instant.getTime())) return day;
  instant.setUTCDate(instant.getUTCDate() + amount);
  return instant.toISOString().slice(0, 10);
}

function Clock({ value, zone }) {
  const parts = planningInstant(value, zone);
  return parts ? <time dateTime={value} title={`${parts.date} ${parts.clock} ${parts.offset}`} className={styles.clock}>{parts.clock}</time> : <span>—</span>;
}
function code(flight) { return flight.operationCode ?? flight.flightNumber ?? flight.id; }
function airport(value) { return value?.iataCode ?? value?.icaoCode ?? value?.code ?? '—'; }

function Window({ flight, zone, t }) {
  const start = planningInstant(flight.operation?.plannedStartAt, zone);
  const end = planningInstant(flight.operation?.plannedEndAt, zone);
  if (!start || !end || Date.parse(flight.operation.plannedEndAt) <= Date.parse(flight.operation.plannedStartAt)) return null;
  return <span className={styles.meta}>{t('operationWindow', { start: start.clock, end: end.date === start.date ? end.clock : `${end.date} ${end.clock}` })}</span>;
}

function Leg({ leg, zone }) {
  return leg ? <div className={styles.leg}>
    <strong>{leg.flightNumber || '—'}</strong>
    <span className={styles.meta}>{airport(leg.origin)} → {airport(leg.destination)}</span>
    <Clock value={leg.scheduledAt} zone={zone} />
  </div> : <span>—</span>;
}

export function PlanningTable({ flights, timeZone, onSelectFlight, selectedFlightId, scopeKey = '' }) {
  const { t, locale, language } = useTranslation(planningViewsMessages);
  const zone = validZone(timeZone ?? flights[0]?.station?.ianaTimeZone);
  const [sort, setSort] = useState({ field: 'time', direction: 1 });
  const [pagination, setPagination] = useState({ scope: scopeKey, page: 1 });
  const collator = useMemo(() => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }), [locale]);
  const rows = useMemo(() => [...flights].sort((left, right) => {
    if (sort.field === 'time') {
      const a = Date.parse(left.timelineTime ?? left.scheduledTime);
      const b = Date.parse(right.timelineTime ?? right.scheduledTime);
      if (!Number.isFinite(a)) return Number.isFinite(b) ? 1 : 0;
      if (!Number.isFinite(b)) return -1;
      return sort.direction * (a - b);
    }
    const value = flight => sort.field === 'scale' ? code(flight) : sort.field === 'stand' ? flight.stand?.code ?? flight.position ?? '' : flight.status ?? '';
    return sort.direction * collator.compare(value(left), value(right));
  }), [flights, sort, collator]);
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const page = pagination.scope === scopeKey ? Math.min(pagination.page, pages) : 1;
  if (pagination.scope !== scopeKey || pagination.page > pages) setPagination({ scope: scopeKey, page });
  const visible = rows.slice((page - 1) * 25, page * 25);
  const chooseSort = field => {
    setSort(previous => ({ field, direction: previous.field === field ? -previous.direction : 1 }));
    setPagination({ scope: scopeKey, page: 1 });
  };
  const headings = ['scale', 'arrival', 'departure', 'time', 'stand', 'agents', 'status'];

  return <section className={styles.tableShell} data-occ-surface>
    <div className={styles.viewport} role="region" aria-label={t('table')} tabIndex={0}>
      <table className={styles.table}>
        <caption className="sr-only">{t('table')}</caption>
        <thead><tr>{headings.map(field => {
          const sortable = ['scale', 'time', 'stand', 'status'].includes(field);
          return <th key={field} scope="col" aria-sort={sortable && sort.field === field ? sort.direction === 1 ? 'ascending' : 'descending' : undefined}>
            {sortable ? <button type="button" aria-label={t('sort', { column: t(field) })} onClick={() => chooseSort(field)}>{t(field)}<span aria-hidden="true">{sort.field === field ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</span></button> : t(field)}
          </th>;
        })}</tr></thead>
        <tbody>{visible.map(flight => <tr key={flight.id} data-planning-row={flight.id} data-selected={selectedFlightId === flight.id || undefined}>
          <td><button type="button" className={styles.open} aria-label={t('open', { code: code(flight) })} onClick={() => onSelectFlight(flight.id)}>{code(flight)}</button><span className={styles.meta}>{flight.airlineName ?? flight.airline?.name}</span></td>
          <td><Leg leg={flight.arrival} zone={zone} /></td><td><Leg leg={flight.departure} zone={zone} /></td>
          <td><Clock value={flight.timelineTime ?? flight.scheduledTime} zone={zone} /><Window flight={flight} zone={zone} t={t} /></td>
          <td><strong>{flight.stand?.code ?? flight.position ?? t('unassigned')}</strong><span className={styles.meta}>{flight.terminalCode ?? flight.stand?.terminal?.code}</span></td>
          <td>{(flight.assignedAgents?.map(agent => agent.displayName) ?? flight.agents ?? []).join(', ') || t('unassigned')}</td>
          <td><span className={styles.state}>{getPlanningStatusMeta(flight.status, language).label}</span></td>
        </tr>)}{!rows.length && <tr><td colSpan={headings.length}>{t('empty')}</td></tr>}</tbody>
      </table>
    </div>
    <div className={styles.pagination}>
      <span>{t('range', { from: rows.length ? (page - 1) * 25 + 1 : 0, to: Math.min(page * 25, rows.length), total: rows.length })}</span>
      <div><button type="button" disabled={page === 1} onClick={() => setPagination({ scope: scopeKey, page: page - 1 })}>{t('previous')}</button><span>{t('page', { page, total: pages })}</span><button type="button" disabled={page === pages} onClick={() => setPagination({ scope: scopeKey, page: page + 1 })}>{t('next')}</button></div>
    </div>
  </section>;
}

export function PlanningCalendar({ flights, timeZone, selectedDate, onDateChange, onSelectFlight, selectedFlightId }) {
  const { t, locale } = useTranslation(planningViewsMessages);
  const zone = validZone(timeZone ?? flights[0]?.station?.ianaTimeZone);
  const today = planningInstant(new Date().toISOString(), zone).date;
  const day = selectedDate || flights[0]?.operationDate || today;
  const events = flights.flatMap(flight => {
    const legs = ['arrival', 'departure'].filter(kind => flight[kind]).map(kind => ({ flight, kind, leg: flight[kind], instant: planningInstant(flight[kind].scheduledAt, zone), key: `${flight.id}:${kind}` }));
    return legs.length ? legs : [{ flight, kind: 'operation', leg: null, instant: null, key: `${flight.id}:operation` }];
  }).sort((a, b) => (Date.parse(a.leg?.scheduledAt) || 0) - (Date.parse(b.leg?.scheduledAt) || 0));
  const outside = events.filter(event => event.instant && event.instant.date !== day);
  const unscheduled = events.filter(event => !event.instant);
  const renderEvent = event => <button type="button" key={event.key} className={styles.event} data-planning-event={event.flight.id} data-selected={selectedFlightId === event.flight.id || undefined} aria-label={t('open', { code: code(event.flight) })} onClick={() => onSelectFlight(event.flight.id)}>
    <span className={styles.eventHeading}><Clock value={event.leg?.scheduledAt} zone={zone} /><strong>{event.leg?.flightNumber || code(event.flight)}</strong></span>
    <span>{event.leg ? `${airport(event.leg.origin)} → ${airport(event.leg.destination)}` : code(event.flight)}</span>
    <span className={styles.meta}>{event.flight.airlineName ?? event.flight.airline?.name} · {event.flight.stand?.code ?? event.flight.position ?? t('unassigned')}</span>
    {event.instant?.date !== day && event.instant && <span className={styles.meta}>{event.instant.date} · {t(event.kind)}</span>}
    <Window flight={event.flight} zone={zone} t={t} />
  </button>;
  const date = new Date(`${day}T12:00:00Z`);
  const dayLabel = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(date) : day;

  return <section className={styles.calendarShell} data-occ-surface aria-label={t('calendar')}>
    <header className={styles.calendarHeader}><div><h2>{dayLabel}</h2><p>{t('zone', { zone })} · {t('scheduled')}</p></div>
      <div className={styles.period}><button type="button" disabled={!onDateChange} aria-label={t('previousDay')} onClick={() => onDateChange?.(shiftPlanningDay(day, -1))}>‹</button><button type="button" disabled={!onDateChange || day === today} onClick={() => onDateChange?.(today)}>{t('today')}</button><button type="button" disabled={!onDateChange} aria-label={t('nextDay')} onClick={() => onDateChange?.(shiftPlanningDay(day, 1))}>›</button></div>
    </header>
    <div className={styles.calendarViewport}>
      <div className={styles.laneHeading}><span /><h3>{t('arrival')}</h3><h3>{t('departure')}</h3></div>
      {Array.from({ length: 24 }, (_, hour) => <div className={styles.hourRow} key={hour}>
        <span className={styles.hour}>{String(hour).padStart(2, '0')}:00</span>
        {['arrival', 'departure'].map(kind => <div className={styles.lane} key={kind}>{events.filter(event => event.kind === kind && event.instant?.date === day && event.instant.hour === hour).map(renderEvent)}</div>)}
      </div>)}
    </div>
    {outside.length > 0 && <section className={styles.extra}><h3>{t('outside')}</h3><div>{outside.map(renderEvent)}</div></section>}
    {unscheduled.length > 0 && <section className={styles.extra}><h3>{t('unscheduled')}</h3><div>{unscheduled.map(renderEvent)}</div></section>}
    {!events.length && <p className={styles.empty}>{t('empty')}</p>}
  </section>;
}
