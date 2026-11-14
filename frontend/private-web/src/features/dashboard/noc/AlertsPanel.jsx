'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import OccAlertQueue from '../../occ-ui/OccAlertQueue';
import OccEmptyState from '../../occ-ui/OccEmptyState';
import OccFloatingPanel from '../../occ-ui/OccFloatingPanel';
import OccGlyph from '../../occ-ui/OccGlyph';
import { OccRemoteView } from '../../occ-ui/OccPanel';
import { SIGNALS } from '../../occ-ui/statusVocabulary';
import { consoleMessages } from './consoleMessages';
import { CONSOLE_ACTION, CONSOLE_SCROLL } from './consoleStyles';

// «Alertas» (contratos 2.5): over the top right of the map, the urgent and attention notices of the station that the
// account has not received, each with «Recibido» (the account's read receipt, the shell's notices.markRead) and
// «Abrir»; then «Pendientes de la jornada», the conditions of the day still open (pendingModel.js), each with the
// action that closes it. The plain notices and the received alerts stay in the shell's «Alertas y avisos».

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

/**
 * The alerts panel. `alerts` is consoleAlerts' `entries` and `notices` the shell's notices of the station (useConsoleData's
 * `notices`: `status`, `markRead`, `retry`, `refreshFailed`, `fetchedAt`); `pending` is buildPending's list and
 * `pendingState` the remote state of the reads it comes from. `onOpen(entry)` follows «Abrir»; `onSelectPending(item)`
 * selects the flight of a pending item; `onAssign(turnaroundId)` and `onImport()` open the assignment drawer and the
 * import dialog over the console. `timeZone` is the station's.
 */
export default function AlertsPanel({
  alerts, notices, pending, pendingState, labels, onOpen, onSelectPending, onAssign, onImport, timeZone,
  measureRef, layout = 'float', defaultFolded = false, className = '',
}) {
  const { t, language, locale } = useTranslation(consoleMessages);
  const pendingTitleId = useId();
  const unreceived = alerts.length;
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
          <OccRemoteView {...pendingState} labels={labels} timeZone={timeZone} className="mt-1"
            emptyState={<OccEmptyState title={t('pending.empty')} />}>
            {pending.length === 0
              ? <OccEmptyState title={t('pending.empty')} className="px-1 py-2" />
              : (
                <ul className="flex flex-col divide-y divide-occ-line">
                  {pending.map(item => (
                    <PendingItem key={item.id} item={item} t={t} language={language} onSelect={onSelectPending}
                      onAssign={onAssign} onImport={onImport} />
                  ))}
                </ul>
              )}
          </OccRemoteView>
        </section>
      </div>
    </OccFloatingPanel>
  );
}
