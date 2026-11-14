'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import OccAlertQueue from '../../occ-ui/OccAlertQueue';
import OccEmptyState from '../../occ-ui/OccEmptyState';
import OccFloatingPanel from '../../occ-ui/OccFloatingPanel';
import OccGlyph from '../../occ-ui/OccGlyph';
import OccSkeleton from '../../occ-ui/OccSkeleton';
import { formatClock } from '../../occ-ui/occTime';
import { SIGNALS } from '../../occ-ui/statusVocabulary';
import { consoleMessages } from './consoleMessages';
import { CONSOLE_ACTION, CONSOLE_SCROLL } from './consoleStyles';
import { pendingCoverage } from './pendingModel';

// «Alertas» (contratos 2.5): over the top right of the map, the urgent and attention notices of the station that the
// account has not received, each with «Recibido» (the account's read receipt, the shell's notices.markRead) and
// «Abrir»; then «Pendientes de la jornada», the conditions of the day still open (pendingModel.js), each with the
// action that closes it. The plain notices and the received alerts stay in the shell's «Alertas y avisos».
//
// The pending items come from four reads (pendingModel.js: PENDING_SOURCES), and each read blanks only its own items: a
// read that has not answered, failed, was refused or shows old data gets one line that says so, above the items of the
// others, and «No hay pendientes.» is said only once every read answered.

const POSITIONS_PATH = '/admin-occ/positions-map';
const reviewPath = operationId => `/admin-occ/review?operationId=${encodeURIComponent(operationId)}`;

function PendingAction({ action, t, onAssign, onImport }) {
  if (!action) return null;
  const label = t(`pending.actions.${action.kind}`);
  if (action.kind === 'review') return <Link href={reviewPath(action.target)} className={CONSOLE_ACTION}>{label}</Link>;
  if (action.kind === 'chooseStand') return <Link href={POSITIONS_PATH} className={CONSOLE_ACTION}>{label}</Link>;
  const run = action.kind === 'assign' ? onAssign : onImport;
  if (typeof run !== 'function') return null;
  return <button type="button" onClick={() => run(action.target)} className={CONSOLE_ACTION}>{label}</button>;
}

function PendingItem({ item, t, language, onSelect, onAssign, onImport }) {
  const signal = item.priority === 'notice' ? null : item.priority;
  const words = (
    <>
      {signal ? <OccGlyph name={signal} /> : null}
      {signal ? <span className="sr-only">{`${SIGNALS[signal][language]}: `}</span> : null}
      <span className="min-w-0">{item.label}</span>
    </>
  );
  const selectable = typeof onSelect === 'function' && (item.flightKey || item.turnaroundId);
  return (
    <li data-pending={item.kind} className="flex items-center gap-2 px-1 py-1">
      {selectable ? (
        <button type="button" onClick={() => onSelect(item)}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left text-sm text-occ-text hover:bg-occ-panel-raised">
          {words}
        </button>
      ) : <span className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-sm text-occ-text">{words}</span>}
      <PendingAction action={item.action} t={t} onAssign={onAssign} onImport={onImport} />
    </li>
  );
}

// One line per read the list lacks or shows late: «Cargando la cola de revisión…», «La consulta de la planificación del
// día falló.» with «Reintentar», «No tienes permiso para ver los vuelos del mapa.», or the time of the data it keeps.
function PendingNotes({ notes, t, locale, timeZone }) {
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 px-1 py-1">
      {notes.map(note => (
        <li key={note.id} data-pending-note={note.id} data-note-kind={note.kind}
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${
            note.kind === 'failed' || note.kind === 'refused' ? 'text-occ-text' : 'text-occ-muted'}`}>
          <span className="min-w-0 flex-1">
            {t(`pending.notes.${note.kind}`, { source: t(`pending.sources.${note.id}`),
              time: formatClock(note.staleSince, locale, timeZone) })}
          </span>
          {note.onRetry && (note.kind === 'failed' || note.kind === 'stale') ? (
            <button type="button" onClick={() => note.onRetry()} className={CONSOLE_ACTION}>{t('states.retry')}</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The alerts panel. `alerts` is consoleAlerts' `entries` and `notices` the shell's notices of the station (useConsoleData's
 * `notices`: `status`, `markRead`, `retry`, `refreshFailed`, `fetchedAt`); `pending` is buildPending's list and
 * `pendingSources` the state of each read it comes from (`[{ id, status, staleSince, onRetry }]`, pendingModel.js:
 * pendingCoverage); `labels.loading` names the list's first load. `onOpen(entry)` follows «Abrir»;
 * `onSelectPending(item)` selects the flight of a pending item; `onAssign(turnaroundId)` and `onImport()` open the
 * assignment drawer and the import dialog over the console. `timeZone` is the station's.
 */
export default function AlertsPanel({
  alerts, notices, pending, pendingSources, labels, onOpen, onSelectPending, onAssign, onImport, timeZone,
  measureRef, layout = 'float', defaultFolded = false, className = '',
}) {
  const { t, language, locale } = useTranslation(consoleMessages);
  const pendingTitleId = useId();
  const unreceived = alerts.length;
  const coverage = pendingCoverage(pendingSources);
  return (
    <OccFloatingPanel ref={measureRef} panelId="alerts" title={t('panels.alerts')} layout={layout}
      defaultFolded={defaultFolded} className={className} bodyClassName="h-full min-h-0"
      foldedSummary={unreceived > 0 ? t('alerts.summary', { count: unreceived }) : null}>
      <div className={`h-full min-h-0 space-y-3 p-2 ${CONSOLE_SCROLL}`}>
        <OccAlertQueue variant="panel" alerts={alerts} status={notices.status}
          onAcknowledge={entry => notices.markRead(entry.id)} onOpen={onOpen} onRetry={notices.retry}
          staleSince={notices.refreshFailed ? notices.fetchedAt : null} locale={locale} timeZone={timeZone} />
        <section aria-labelledby={pendingTitleId} className="border-t border-occ-line pt-2">
          <h3 id={pendingTitleId} className="px-1 text-sm font-semibold text-occ-text">{t('pending.title')}</h3>
          {coverage.loading ? <OccSkeleton label={labels?.loading} className="mt-1 px-1 py-2" /> : (
            <div className="mt-1">
              <PendingNotes notes={coverage.notes} t={t} locale={locale} timeZone={timeZone} />
              {pending.length > 0 ? (
                <ul className="flex flex-col divide-y divide-occ-line">
                  {pending.map(item => (
                    <PendingItem key={item.id} item={item} t={t} language={language} onSelect={onSelectPending}
                      onAssign={onAssign} onImport={onImport} />
                  ))}
                </ul>
              ) : null}
              {pending.length === 0 && coverage.complete
                ? <OccEmptyState title={t('pending.empty')} className="px-1 py-2" /> : null}
            </div>
          )}
        </section>
      </div>
    </OccFloatingPanel>
  );
}
