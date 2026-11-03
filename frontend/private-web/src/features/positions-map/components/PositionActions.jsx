import { useState } from 'react';
import { assignOccStand, recordOccArrival, releaseOccStand } from '../../../services/occPositionsService';
import { useTranslation } from '../../../i18n/LanguageScope';
import { occUiMessages } from '../../admin-occ/ui/occUiMessages';

const inputClass = 'w-full rounded-md border border-occ-line bg-occ-panel px-3 py-2 text-sm';
const buttonClass = 'rounded-md border border-accent-600/40 px-3 py-2 text-xs font-semibold text-accent-600 disabled:opacity-50';

export default function PositionActions({ position, candidates = [], onChanged }) {
  const { t, locale } = useTranslation(occUiMessages);
  const [registration, setRegistration] = useState({});
  const [turnaroundId, setTurnaroundId] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ tone: '', text: '' });
  const time = value => value ? new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'America/Santo_Domingo' }).format(new Date(value)) : '—';
  async function run(key, command, success) {
    setBusy(key); setMessage({ tone: '', text: '' });
    try {
      await command();
      setMessage({ tone: 'success', text: success }); onChanged?.(); return true;
    } catch (error) {
      const errorKey = { 400: 'positionInvalid', 403: 'positionForbidden', 404: 'positionMissing', 409: 'positionConflict' }[error?.status];
      setMessage({ tone: 'danger', text: t(errorKey ?? 'positionError') }); return false;
    } finally { setBusy(''); }
  }
  const parked = position.turnarounds ?? [];
  const movable = candidates.filter(item => !parked.some(here => here.turnaroundId === item.turnaroundId));
  return <section aria-label={t('arrivals')} className="space-y-4 border-t border-occ-line pt-4 text-sm">
    <h3 className="font-semibold">{t('actions')}</h3>
    {parked.map(item => <div key={item.turnaroundId} className="space-y-3 border-b border-occ-line pb-4 last:border-0">
      <p><strong>{item.arrivalFlightNumber ?? item.operationCode}</strong> · {item.airlineName}
        <span className="mt-1 block text-xs text-occ-muted">{t('expectedArrival', { time: time(item.arrivalScheduledAt) })}
          {' · '}{item.arrivedAt ? t('arrived', { time: time(item.arrivedAt) }) : t('notArrived')}</span></p>
      {!item.arrivedAt && <form className="flex flex-wrap items-end gap-2" noValidate onSubmit={event => {
        event.preventDefault();
        const value = (registration[item.turnaroundId] ?? item.aircraftRegistration ?? '').trim();
        void run(`arrival-${item.turnaroundId}`, () => recordOccArrival(item.turnaroundId, value),
          t('arrivalSaved', { registration: value.toUpperCase(), position: position.id }));
      }}>
        <label className="min-w-0 flex-1">{t('registration')}<input className={inputClass} disabled={Boolean(busy)}
          value={registration[item.turnaroundId] ?? item.aircraftRegistration ?? ''}
          onChange={event => setRegistration(current => ({ ...current, [item.turnaroundId]: event.target.value }))}
          placeholder="HI1055" maxLength={10} /></label>
        <button type="submit" className={buttonClass} disabled={Boolean(busy)}>{t(busy === `arrival-${item.turnaroundId}` ? 'recording' : 'recordArrival')}</button>
      </form>}
      <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => void run(`release-${item.turnaroundId}`,
        () => releaseOccStand(item.turnaroundId), t('released', { position: position.id }))}>{t(busy === `release-${item.turnaroundId}` ? 'releasing' : 'release')}</button>
    </div>)}
    {movable.length > 0 && <form className="space-y-3" noValidate onSubmit={async event => {
      event.preventDefault();
      if (!turnaroundId) { setMessage({ tone: 'danger', text: t('chooseFlightError') }); return; }
      if (await run('assign', () => assignOccStand(turnaroundId, position.standId), t('assigned', { position: position.id }))) setTurnaroundId('');
    }}>
      <label className="block">{t('assignFlight', { position: position.id })}<select className={inputClass} value={turnaroundId} disabled={Boolean(busy)} onChange={event => setTurnaroundId(event.target.value)}>
        <option value="">{t('chooseFlight')}</option>{movable.map(item => <option key={item.turnaroundId} value={item.turnaroundId}>
          {item.arrivalFlightNumber ?? item.operationCode} · {item.airlineName} · {time(item.arrivalScheduledAt)}
          {item.standCode ? ` (${t('currentStand', { position: item.standCode })})` : ''}
        </option>)}
      </select></label>
      <button type="submit" className={buttonClass} disabled={Boolean(busy)}>{t(busy === 'assign' ? 'assigning' : 'assign')}</button>
    </form>}
    {message.text && <p role={message.tone === 'danger' ? 'alert' : 'status'} className={message.tone === 'danger' ? 'text-status-danger' : 'text-status-success'}>{message.text}</p>}
  </section>;
}
