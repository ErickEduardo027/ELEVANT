import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import { useOccShellChannel } from '../admin-occ/shell/occShellContext';
import { useOccStation } from '../admin-occ/useOccStation';
import { OCC_CLASSES } from '../occ-ui/classes';
import OccButton from '../occ-ui/OccButton';
import OccDataTable from '../occ-ui/OccDataTable';
import OccDialog from '../occ-ui/OccDialog';
import OccEmptyState from '../occ-ui/OccEmptyState';
import { OccTextareaField } from '../occ-ui/OccField';
import OccGlyph from '../occ-ui/OccGlyph';
import OccPanel, { OccRemoteView } from '../occ-ui/OccPanel';
import OccSkeleton from '../occ-ui/OccSkeleton';
import OccStatusPill from '../occ-ui/OccStatusPill';
import OccToolbar from '../occ-ui/OccToolbar';
import { formatClock } from '../occ-ui/occTime';
import { BUSINESS_TIME_ZONE } from '../../services/businessDay';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { deviceProblemMessage } from '../../services/deviceProblemMessages';
import { loadOccDevices, revokeOccDevice, unbindOccDevice } from '../../services/occDevicesService';
import { isConflict, isForbidden } from '../../services/problemMessages';
import { devicesMessages } from './devicesMessages';

// Template D of the design («Registro»): the toolbar with the page title, the register of the station's tablets as a
// dense table, and the dialogs of its two commands.
const PLATFORMS = Object.freeze({ Android: 'Android', Ios: 'iOS' });
/**
 * The tone of who holds a tablet, with its word in devicesMessages: in an agent's hands is the active state, free is the
 * neutral one and revoked the muted one. A tablet whose agent is in the middle of an operation asks for attention: no
 * other agent can take it until that one signs out or OCC frees it.
 */
export const DEVICE_STATUS_TONES = Object.freeze({ Bound: 'active', Unbound: 'neutral', Revoked: 'muted' });
const STATE_SLAB = 'rounded-md border border-occ-line bg-occ-panel text-occ-text';
const days = new Map();

/** What a command needs: whether its reason is required (5 to 500 characters), as the service checks it. */
const COMMANDS = Object.freeze({
  unbind: Object.freeze({ required: false }),
  revoke: Object.freeze({ required: true }),
});

/**
 * «13/11 08:20» in the station's time, with the year when it is not this one («13/11/2025 08:20»), or «—». Day and
 * month always take two digits (es-DO would write «1/9»), so the column of times keeps one width.
 */
function formatInstant(value, locale) {
  const ms = Date.parse(value ?? '');
  if (!Number.isFinite(ms)) return '—';
  if (!days.has(locale)) {
    days.set(locale, new Intl.DateTimeFormat(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: BUSINESS_TIME_ZONE,
    }));
  }
  const format = days.get(locale);
  const yearOf = instant => format.formatToParts(instant).find(part => part.type === 'year')?.value;
  const withYear = yearOf(ms) !== yearOf(Date.now());
  // Both languages write the year last: without it, the separator before it goes too.
  const parts = format.formatToParts(ms);
  const day = parts.filter((part, index) => withYear || (part.type !== 'year' && parts[index + 1]?.type !== 'year'))
    .map(part => (part.type === 'day' || part.type === 'month' ? part.value.padStart(2, '0') : part.value)).join('');
  return `${day} ${formatClock(ms, locale, BUSINESS_TIME_ZONE)}`;
}

/** Who holds the tablet: its word with the glyph of its tone, and why a busy one asks for attention. */
function DeviceStatus({ device }) {
  const { t } = useTranslation(devicesMessages);
  const busy = device.status === 'Bound' && device.agentHasOperationInProgress;
  if (busy) {
    return (
      <span className="flex flex-col items-start gap-1">
        <OccStatusPill size="sm" tone="attention" label={t('inProgress')} />
        <span className="text-xs text-occ-muted">{t('inProgressHint')}</span>
      </span>
    );
  }
  const known = Object.hasOwn(DEVICE_STATUS_TONES, device.status);
  return <OccStatusPill size="sm" tone={known ? DEVICE_STATUS_TONES[device.status] : 'neutral'}
    label={known ? t(`status.${device.status}`) : device.status} />;
}

/**
 * «Tablets» of OCC (phase 2, block E, 2-N02): who holds each shared tablet of the station. Signing out frees a tablet
 * and the next agent takes it, unless the one holding it is in the middle of an operation; OCC frees it then, or
 * revokes a lost one. Each command carries its Idempotency-Key and the binding token on screen.
 */
export default function DevicesRoute() {
  const { t, locale } = useTranslation(devicesMessages);
  const station = useOccStation();
  // The frame's stable channel: listening on it does not re-render the page when the live link or the notices move.
  const { subscribe } = useOccShellChannel();
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState({ tone: '', text: '' });
  const [command, setCommand] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useRef(createCommandKeyHolder());
  const live = useRef(() => {});
  const reasonRef = useRef(null);
  const descriptionId = useId();

  useEffect(() => {
    if (!station.stationId) return undefined;
    const controller = new AbortController();
    const read = () => loadOccDevices(station.stationId, { signal: controller.signal })
      .then(data => setState({ status: 'success', data }))
      .catch(failure => {
        if (failure?.name === 'AbortError') return;
        setState(current => (current.data && !isForbidden(failure) ? current : { status: 'error', error: failure }));
      });
    live.current = read;
    void read();
    return () => controller.abort();
  }, [station.stationId, attempt]);

  // A tablet changed hands somewhere (sign-in, sign-out, another OCC seat): re-read under current permissions. The
  // announcement comes from the tab's single account-change observer, the OCC frame's (contratos 2.7).
  useEffect(() => subscribe(['mobile_devices'], () => { void live.current(); }), [subscribe]);

  const nameOf = device => device.deviceName || t('unnamed', { platform: PLATFORMS[device.platform] ?? device.platform });
  const agentOf = device => device.agent?.name || t('commands.lastAgent');

  const open = useCallback((kind, device) => {
    setCommand({ kind, device });
    setReason('');
    setError('');
    keys.current.reset();
  }, []);

  async function submit(event) {
    event.preventDefault();
    const { kind, device } = command;
    const text = reason.trim();
    const body = kind === 'revoke' ? { expectedVersion: device.version, reason: text }
      : { expectedVersion: device.version, reason: text || null };
    setBusy(true);
    setError('');
    try {
      await keys.current.run(`device.${kind}`, { id: device.id, ...body }, key => (kind === 'revoke'
        ? revokeOccDevice(device.id, body, key) : unbindOccDevice(device.id, body, key)));
      setCommand(null);
      setFeedback({ tone: 'success', text: t(`commands.${kind}.done`, { tablet: nameOf(device) }) });
      void live.current();
    } catch (failure) {
      if (isConflict(failure) || failure?.status === 404) {
        // The tablet changed hands: the dialog closes and the list shows what the server keeps.
        setCommand(null);
        setFeedback({ tone: 'danger', text: deviceProblemMessage(failure) });
        void live.current();
      } else setError(deviceProblemMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const data = state.data;
  const columns = data ? [
    {
      key: 'tablet', header: t('list.columns.tablet'),
      render: device => (
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold text-occ-text">{nameOf(device)}</span>
          <span className="flex flex-wrap gap-x-3 text-xs text-occ-muted">
            <span>{PLATFORMS[device.platform] ?? device.platform}{device.operatingSystemVersion ? ` ${device.operatingSystemVersion}` : ''}</span>
            <span>{t('app', { version: device.appVersion })}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'agent', header: t('list.columns.agent'),
      render: device => {
        const since = device.status === 'Revoked' ? device.revokedAt : device.status === 'Unbound' ? device.unboundAt : device.boundAt;
        const holder = device.agent
          ? `${device.agent.name}${device.agent.employeeNumber ? ` · ${device.agent.employeeNumber}` : ''}`
          : t('noAgent');
        return (
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-occ-muted">{device.status === 'Bound' ? t('holding') : t('lastAgent')}</span>
            <strong className="font-semibold text-occ-text">{holder}</strong>
            {since && <span className="text-xs text-occ-muted">{t('since', { date: formatInstant(since, locale) })}</span>}
          </span>
        );
      },
    },
    {
      key: 'lastSeen', header: t('list.columns.lastSeen'), width: '9.5rem', mono: true,
      render: device => <time dateTime={device.lastSeenAt} className="whitespace-nowrap">{formatInstant(device.lastSeenAt, locale)}</time>,
    },
    { key: 'status', header: t('list.columns.status'), width: '15rem', render: device => <DeviceStatus device={device} /> },
    {
      key: 'actions', header: '', width: '11rem',
      render: device => (
        <span className="flex flex-wrap gap-2">
          {data.canUnbind && device.status === 'Bound' && (
            <OccButton size="sm" onClick={() => open('unbind', device)}>{t('unbind')}</OccButton>
          )}
          {data.canRevoke && device.status !== 'Revoked' && (
            <OccButton size="sm" variant="danger" onClick={() => open('revoke', device)}>{t('revoke')}</OccButton>
          )}
        </span>
      ),
    },
  ] : [];

  let body;
  if (!station.stationId) body = <p role="alert" className={`${OCC_CLASSES.card} text-sm`}>{t('states.noStation')}</p>;
  else if (state.status === 'loading') {
    body = <OccRemoteView status="loading" className={STATE_SLAB}
      skeleton={<OccSkeleton rows={4} label={t('states.loading')} />} />;
  } else if (state.status === 'error' && isForbidden(state.error)) {
    body = <p role="alert" className={`${OCC_CLASSES.card} text-sm`}>{t('states.forbidden')}</p>;
  } else if (state.status === 'error') {
    // The service's own sentence for the failure (deviceProblemMessage), never the server's title.
    body = <OccRemoteView status="error" className={STATE_SLAB} onRetry={() => setAttempt(value => value + 1)}
      labels={{ error: deviceProblemMessage(state.error), retry: t('states.retry') }} />;
  } else body = (
    <OccPanel title={t('list.title')} meta={t('list.about')}>
      {!data.canUnbind && !data.canRevoke && data.devices.length > 0 && (
        <p role="status" className="border-b border-occ-line px-3 py-2 text-sm text-occ-muted">{t('states.readOnly')}</p>
      )}
      <OccDataTable caption={t('list.title')} columns={columns} rows={data.devices} getRowId={device => device.id}
        emptyState={<OccEmptyState title={t('list.emptyTitle')} description={t('list.emptyDescription')} />} />
    </OccPanel>
  );

  const spec = command ? COMMANDS[command.kind] : null;
  const commandText = key => (command ? t(`commands.${command.kind}.${key}`, { tablet: nameOf(command.device), agent: agentOf(command.device) }) : '');
  let description = '';
  if (command?.kind === 'unbind') description = commandText('description');
  else if (command) description = commandText(command.device.status === 'Bound' ? 'descriptionBound' : 'descriptionFree');
  // The station is in the status bar of the OCC frame: the page has no badge of its own, nor a line under its title.
  return (
    <section className="flex min-w-0 flex-col gap-3 text-occ-text">
      <OccToolbar title={t('title')} />
      {feedback.text && (
        <p role={feedback.tone === 'danger' ? 'alert' : 'status'}
          className={`flex items-start gap-2 rounded-md border border-occ-line px-3 py-2 text-sm text-occ-text ${feedback.tone === 'danger' ? 'bg-occ-warn-soft' : 'bg-occ-panel-raised'}`}>
          {feedback.tone === 'danger' ? <OccGlyph name="attention" className="mt-0.5" /> : null}
          <span className="min-w-0">{feedback.text}</span>
        </p>
      )}
      {body}
      {/* Freeing a tablet starts on its reason, as before; revoking cannot be undone, so its alertdialog starts on
          «Cancelar». */}
      <OccDialog open={Boolean(command)} onClose={() => setCommand(null)} tone={command?.kind === 'revoke' ? 'danger' : 'default'}
        title={commandText('title')} busy={busy} descriptionId={descriptionId}
        initialFocusRef={command?.kind === 'unbind' ? reasonRef : undefined}
        footer={<>
          <OccButton data-occ-dialog-cancel="" disabled={busy} onClick={() => setCommand(null)}>{t('cancel')}</OccButton>
          <OccButton type="submit" form="occ-device-command" variant={command?.kind === 'revoke' ? 'danger' : 'primary'}
            busy={busy} busyLabel={t('saving')} disabled={spec?.required && reason.trim().length < 5}>
            {commandText('submit')}
          </OccButton>
        </>}>
        {spec && (
          <form id="occ-device-command" onSubmit={submit} className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-occ-line bg-occ-warn-soft px-3 py-2 text-sm text-occ-text">
                <OccGlyph name="attention" className="mt-0.5" />
                <span className="min-w-0">{error}</span>
              </p>
            )}
            <p id={descriptionId} className="text-sm text-occ-text">{description}</p>
            <OccTextareaField ref={reasonRef} label={commandText('reasonLabel')} rows={3} maxLength={500} required={spec.required} value={reason}
              onChange={event => setReason(event.target.value)} />
          </form>
        )}
      </OccDialog>
    </section>
  );
}
