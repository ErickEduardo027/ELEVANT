import { useCallback, useEffect, useRef, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import { OccStationBadge } from '../admin-occ/OccQueueState';
import { useOccStation } from '../admin-occ/useOccStation';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { deviceProblemMessage } from '../../services/deviceProblemMessages';
import { DEVICE_STATUSES, loadOccDevices, revokeOccDevice, unbindOccDevice } from '../../services/occDevicesService';
import { isConflict, isForbidden } from '../../services/problemMessages';
import { IdCardIcon } from '../shell/components/icons';

const card = 'rounded-2xl border border-black/5 bg-white/80 p-5 dark:border-white/5 dark:bg-surface-dark-card';
const muted = 'text-text-secondary-light dark:text-text-secondary-dark';
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold disabled:opacity-50';
const secondary = `${button} border border-accent-600/40 text-accent-600`;
const danger = `${button} border border-status-danger/40 text-status-danger`;
const field = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';

const PLATFORMS = Object.freeze({ Android: 'Android', Ios: 'iOS' });
const formatLocalDateTime = value => (value
  ? new Date(value).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const nameOf = device => device.deviceName || `Tablet ${PLATFORMS[device.platform] ?? device.platform}`;
const agentOf = device => device.agent?.name || 'su último agente';

/**
 * What the dialog of a command explains, and whether its reason is required. Revoking ends the sessions of the
 * tablet's last agent, also when OCC had freed it, unless that agent signed out of it (2-N02): the copy only claims
 * what the server does.
 */
const COMMANDS = Object.freeze({
  unbind: {
    title: tablet => `Liberar ${tablet}`,
    description: () => 'La tablet queda libre: el próximo agente que inicie sesión en ella la tomará, aunque el anterior tenga una operación en curso. El agente anterior ya no podrá enviar desde ella.',
    reasonLabel: 'Motivo (opcional)',
    submit: 'Liberar tablet',
    required: false,
    done: tablet => `${tablet} quedó libre para el próximo agente.`,
  },
  revoke: {
    title: tablet => `Revocar ${tablet}`,
    description: device => (device.status === 'Bound'
      ? `Úsalo solo con una tablet perdida o robada: nunca más podrá vincularse con ELEVANT y se cierran todas las sesiones de ${agentOf(device)}. No se puede deshacer.`
      : `Úsalo solo con una tablet perdida o robada: nunca más podrá vincularse con ELEVANT. Si ${agentOf(device)} no cerró sesión en ella, se cierran todas sus sesiones. No se puede deshacer.`),
    reasonLabel: 'Motivo',
    submit: 'Revocar tablet',
    required: true,
    done: tablet => `${tablet} quedó revocada; ya no queda ninguna sesión abierta en ella.`,
  },
});

function DeviceRow({ device, canUnbind, canRevoke, onCommand }) {
  const status = DEVICE_STATUSES[device.status] ?? { label: device.status, tone: 'neutral' };
  const since = device.status === 'Revoked' ? device.revokedAt : device.status === 'Unbound' ? device.unboundAt : device.boundAt;
  const holder = device.agent
    ? `${device.agent.name}${device.agent.employeeNumber ? ` · ${device.agent.employeeNumber}` : ''}`
    : 'Sin agente';
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold">{nameOf(device)}</p>
        <p className={`text-xs ${muted}`}>{PLATFORMS[device.platform] ?? device.platform}
          {device.operatingSystemVersion ? ` ${device.operatingSystemVersion}` : ''} · App {device.appVersion} · Última conexión {formatLocalDateTime(device.lastSeenAt)}</p>
        <p className="text-sm">{device.status === 'Bound' ? 'En manos de ' : 'Último agente: '}<strong>{holder}</strong>
          {since && <span className={`text-xs ${muted}`}> · desde {formatLocalDateTime(since)}</span>}</p>
        {device.agentHasOperationInProgress && <p className="text-xs font-semibold text-status-warning">
          Operación en curso: otro agente no puede tomarla hasta que este cierre sesión o la liberes.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={status.tone} label={status.label} />
        {canUnbind && device.status === 'Bound' && (
          <button type="button" className={secondary} onClick={() => onCommand('unbind', device)}>Liberar</button>
        )}
        {canRevoke && device.status !== 'Revoked' && (
          <button type="button" className={danger} onClick={() => onCommand('revoke', device)}>Revocar</button>
        )}
      </div>
    </li>
  );
}

/**
 * «Tablets» of OCC (phase 2, block E, 2-N02): who holds each shared tablet of the station. Signing out frees a tablet
 * and the next agent takes it, unless the one holding it is in the middle of an operation; OCC frees it then, or
 * revokes a lost one. Each command carries its Idempotency-Key and the binding token on screen.
 */
export default function DevicesRoute() {
  const station = useOccStation();
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState({ tone: '', text: '' });
  const [command, setCommand] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useRef(createCommandKeyHolder());
  const live = useRef(() => {});

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

  // A tablet changed hands somewhere (sign-in, sign-out, another OCC seat): re-read under current permissions.
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('mobile_devices')) void live.current();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, []);

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
      setFeedback({ tone: 'success', text: COMMANDS[kind].done(nameOf(device)) });
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
  let body;
  if (!station.stationId) body = <p role="alert" className={card}>Tu cuenta no tiene una estación OCC autorizada.</p>;
  else if (state.status === 'loading') body = <p role="status" className={card}>Cargando las tablets…</p>;
  else if (state.status === 'error' && isForbidden(state.error)) body = <p role="alert" className={card}>
    Tu acceso no permite ver las tablets de esta estación.</p>;
  else if (state.status === 'error') body = <div role="alert" className={`${card} flex flex-wrap items-center gap-3`}>
    <p>{deviceProblemMessage(state.error)}</p>
    <button type="button" className={secondary} onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div>;
  else if (data.devices.length === 0) body = <div className={card}>
    <EmptyState icon={IdCardIcon} title="Sin tablets registradas"
      description="Una tablet aparece aquí cuando un agente de la estación inicia sesión en ella." /></div>;
  else body = (
    <section className={`${card} space-y-2`} aria-label="Tablets de la estación">
      {!data.canUnbind && !data.canRevoke && <p role="status" className={`text-sm ${muted}`}>
        Tu acceso permite consultar las tablets, no liberarlas ni revocarlas.</p>}
      <ul className="divide-y divide-black/5 dark:divide-white/5">
        {data.devices.map(device => (
          <DeviceRow key={`${device.id}-${device.version}`} device={device} canUnbind={data.canUnbind}
            canRevoke={data.canRevoke} onCommand={open} />
        ))}
      </ul>
    </section>
  );

  const spec = command ? COMMANDS[command.kind] : null;
  return (
    <section className="space-y-4">
      <header data-occ-header className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div><h1 className="text-xl font-semibold">Tablets</h1>
          <p className={`text-sm ${muted}`}>Las tablets son compartidas: cerrar sesión las libera y el siguiente agente las toma. Nada se borra; cada cambio queda auditado.</p></div>
        <OccStationBadge />
      </header>
      {feedback.text && (feedback.tone === 'danger'
        ? <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{feedback.text}</p>
        : <p role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{feedback.text}</p>)}
      {body}
      <Modal open={Boolean(command)} onClose={() => setCommand(null)} tone={command?.kind === 'revoke' ? 'danger' : 'default'}
        title={spec ? spec.title(nameOf(command.device)) : ''} busy={busy}
        footer={<>
          <button type="button" onClick={() => setCommand(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="occ-device-command" disabled={busy || (spec?.required && reason.trim().length < 5)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${command?.kind === 'revoke' ? 'bg-status-danger' : 'bg-accent-600'}`}>
            {busy ? 'Guardando…' : spec?.submit}</button>
        </>}>
        {spec && (
          <form id="occ-device-command" onSubmit={submit} className="space-y-3">
            {error && <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
            <p>{spec.description(command.device)}</p>
            <label className="block text-sm font-semibold">{spec.reasonLabel}
              <textarea rows={3} maxLength={500} required={spec.required} value={reason}
                onChange={event => setReason(event.target.value)} className={field} /></label>
          </form>
        )}
      </Modal>
    </section>
  );
}
