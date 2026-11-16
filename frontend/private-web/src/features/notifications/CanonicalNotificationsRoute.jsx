import { useEffect, useState } from 'react';
import Link from '../../components/AppLink';
import { useOccShellChannel } from '../admin-occ/shell/occShellContext';
import { loadOperationalNotifications, setOperationalNotificationRead } from '../../services/operationalCommunicationService';
import { BUSINESS_TIME_ZONE } from '../../services/businessDay';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import ServiceClosurePanel from '../contracts/catalog/ServiceClosurePanel';
import { useTranslation } from '../../i18n/LanguageScope';
import { ALERT_PRIORITIES, alertPriority } from '../dashboard/noc/alertModel';
import OccButton, { occButtonClass } from '../occ-ui/OccButton';
import OccDataTable from '../occ-ui/OccDataTable';
import OccGlyph from '../occ-ui/OccGlyph';
import OccPanel from '../occ-ui/OccPanel';
import OccPlate from '../occ-ui/OccPlate';
import OccSegmented from '../occ-ui/OccSegmented';
import OccToolbar from '../occ-ui/OccToolbar';
import { formatClock } from '../occ-ui/occTime';
import { SIGNALS } from '../occ-ui/statusVocabulary';
import { notificationKindLabel, notificationTargetPath } from './notificationKinds';
import { notificationsMessages } from './notificationsMessages';
import { requestNotificationsRefresh } from './useNotificationBadge';

const FILTERS = Object.freeze(['all', 'unread', 'alerts']);
const EMPTY_TEXT = Object.freeze({ all: 'empty', unread: 'emptyUnread', alerts: 'emptyAlerts' });
const days = new Map();

/**
 * «01/09 14:32» (or «09/01» in English) in the station's time: a history spans days, so each notice says its day. Day
 * and month always take two digits (es-DO would write «1/9»), so the column of times keeps one width.
 */
function formatInstant(value, locale) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  if (!days.has(locale)) {
    days.set(locale, new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: BUSINESS_TIME_ZONE }));
  }
  const day = days.get(locale).formatToParts(ms)
    .map(part => (part.type === 'day' || part.type === 'month' ? part.value.padStart(2, '0') : part.value)).join('');
  return `${day} ${formatClock(ms, locale, BUSINESS_TIME_ZONE)}`;
}

// The priority of a notice (contratos 2.4): «Urgente» any incident, «Atención» a deviation, a provider's cancellation
// or diversion, an agent released, an operation without an eligible agent or a document or contract not in force;
// the rest is a plain «Aviso». An alert the account has not read is lit, with the slab and the bar of its signal; the
// read receipt turns the light off, as in «Alertas y avisos».
const priorityOf = item => alertPriority(item.kind);
const isAlert = item => priorityOf(item) !== 'notice';
const litTone = item => (isAlert(item) && !item.readAt ? priorityOf(item) : null);
const noticeId = item => item.id;

/** The priorities of the history, with the shape and the word of each, in the board's header (owner's request). */
function PriorityLegend({ label, language }) {
  return (
    <ul aria-label={label} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-occ-muted">
      {ALERT_PRIORITIES.map(name => (
        <li key={name} data-signal={name} className="flex items-center gap-1.5">
          <OccGlyph name={name} />
          <span>{SIGNALS[name][language]}</span>
        </li>
      ))}
    </ul>
  );
}

export default function CanonicalNotificationsRoute() {
  const { t, language, locale } = useTranslation(notificationsMessages);
  // The frame's stable channel: listening on it does not re-render the page when the live link or the notices move.
  const { subscribe } = useOccShellChannel();
  const [state, setState] = useState({ status: 'loading', items: [], hasMore: false });
  const [revision, setRevision] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [writeError, setWriteError] = useState('');
  const [section, setSection] = useState('notices');
  const [filter, setFilter] = useState('all');

  // A notice of the account: the history is read again at once, under current permissions, and its 20 s poll starts
  // over. The announcement comes from the tab's single account-change observer, the OCC frame's (contratos 2.7), which
  // observes only for a signed-in account.
  useEffect(() => subscribe(['notifications'], () => setRevision(value => value + 1)), [subscribe]);

  useEffect(() => {
    const controller = new AbortController();
    let latestRequest = 0;
    const load = async () => {
      const requestId = ++latestRequest;
      try {
        const data = await loadOperationalNotifications({ signal: controller.signal });
        if (!controller.signal.aborted && requestId === latestRequest) setState({ status: 'success', items: data.notifications, hasMore: data.hasMore });
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error) && requestId === latestRequest) {
          // Without access the history says so and offers no retry; any other failure can be retried.
          setState(previous => ({ ...previous, status: error?.status === 403 ? 'forbidden' : 'error' }));
        }
      }
    };
    void load();
    const timer = window.setInterval(load, 20_000);
    return () => { abortForEffectCleanup(controller); window.clearInterval(timer); };
  }, [revision]);

  const toggleRead = async item => {
    setBusyId(item.id);
    setWriteError('');
    try {
      const saved = await setOperationalNotificationRead(item.id, !item.readAt);
      setState(previous => ({ ...previous, items: previous.items.map(current =>
        current.id === saved.id ? saved : current) }));
      // No announcement reports a receipt: the OCC frame's alerts and rail counts read the notices again.
      requestNotificationsRefresh();
    } catch (error) {
      setWriteError(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const loaded = state.status === 'success';
  // The filters scope the history while it loads or shows; a history that failed or is refused has nothing to filter.
  const filtering = loaded || state.status === 'loading';
  const unread = state.items.filter(item => !item.readAt).length;
  const alerts = state.items.filter(isAlert).length;
  const counts = { all: state.items.length, unread, alerts };
  const rows = state.items.filter(item => (filter === 'unread' ? !item.readAt : filter === 'alerts' ? isAlert(item) : true));

  const columns = [
    {
      // A lit row gets its signal from the table; every other notice draws its own, with its word as its name.
      key: 'priority', header: t('columns.priority'), width: '5.5rem',
      render: item => (litTone(item) ? null : <OccGlyph name={priorityOf(item)} title={SIGNALS[priorityOf(item)][language]} />),
    },
    {
      key: 'notice', header: t('columns.notice'), width: 'minmax(0,1fr)',
      render: item => (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <strong className={item.readAt ? 'font-medium text-occ-muted' : 'font-semibold text-occ-text'}>
            {notificationKindLabel(item.kind, language)}
          </strong>
          {item.readAt ? null : (
            <span className="inline-flex items-center rounded-sm border border-occ-line-strong px-1.5 text-xs font-medium leading-5 text-occ-text">
              {t('unreadTag')}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'operation', header: t('columns.operation'), width: '12rem',
      render: item => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <OccPlate kind="code">{item.operationCode}</OccPlate>
          <span className="font-mono text-xs text-occ-muted">{item.stationCode}</span>
        </span>
      ),
    },
    {
      key: 'time', header: t('columns.time'), width: '7.5rem', mono: true,
      render: item => <time dateTime={item.occurredAt} className="whitespace-nowrap">{formatInstant(item.occurredAt, locale)}</time>,
    },
    {
      key: 'actions', header: t('columns.actions'), width: '11rem',
      render: item => (
        <span className="flex flex-wrap items-center gap-2">
          <Link className={occButtonClass({ size: 'sm' })} to={notificationTargetPath(item)}>{t('open')}</Link>
          <OccButton size="sm" busy={busyId === item.id} onClick={() => void toggleRead(item)}>
            {item.readAt ? t('markUnread') : t('markRead')}
          </OccButton>
        </span>
      ),
    },
  ];

  return <section className="flex min-w-0 flex-col gap-3 text-occ-text">
    {/* The sections sit on the toolbar's line, with «Actualizar» at its end. */}
    <OccToolbar title={t('title')} actions={<OccButton onClick={() => setRevision(value => value + 1)}>{t('refresh')}</OccButton>}>
      <nav aria-label={t('sections')}>
        <OccSegmented label={t('section')} value={section} onChange={setSection}
          options={[{ id: 'notices', label: t('notices') }, { id: 'services', label: t('services') }]} />
      </nav>
    </OccToolbar>
    {section === 'services' ? <ServiceClosurePanel mode="occ" /> : (
      <OccPanel title={t('history')} meta={loaded ? <p role="status"><strong>{unread}</strong>{t('unread', { count: state.items.length })}</p> : null}
        actions={<PriorityLegend label={t('legend')} language={language} />}>
        <div className="flex flex-col items-start gap-2 border-b border-occ-line px-3 py-2 empty:hidden">
          {filtering ? (
            <OccSegmented label={t('filters.label')} value={filter} onChange={setFilter} size="sm"
              options={FILTERS.map(id => ({ id, label: t(`filters.${id}`), count: loaded ? counts[id] : undefined }))} />
          ) : null}
          {writeError ? (
            <div role="alert" className="flex items-start gap-2 self-stretch rounded-md border border-occ-line bg-occ-warn-soft px-3 py-2 text-sm text-occ-text">
              <OccGlyph name="attention" className="mt-0.5" />
              <p className="min-w-0">{writeError}</p>
            </div>
          ) : null}
        </div>
        <OccDataTable as="list" caption={t('listLabel')} columns={columns} rows={rows} getRowId={noticeId}
          rowTone={litTone} status={state.status} onRetry={() => setRevision(value => value + 1)}
          labels={{ loading: t('loading'), error: t('error'), forbidden: t('forbidden'), retry: t('retry'), empty: t(EMPTY_TEXT[filter]) }}
          footer={state.hasMore ? (
            <p className="flex items-start gap-1.5 text-xs text-occ-muted">
              <OccGlyph name="notice" />
              <span className="min-w-0">{t('hasMore')}</span>
            </p>
          ) : null} />
      </OccPanel>
    )}
  </section>;
}
