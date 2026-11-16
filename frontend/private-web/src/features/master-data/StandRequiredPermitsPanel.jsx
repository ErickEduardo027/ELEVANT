import { useRef, useState } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import OccButton from '../occ-ui/OccButton';
import OccDataTable from '../occ-ui/OccDataTable';
import OccGlyph from '../occ-ui/OccGlyph';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { isConflict } from '../../services/problemMessages';
import {
  applyOccStandRequiredPermits, masterDataMessage, setOccStandRequiredPermits,
} from '../../services/occMasterDataService';
import { masterDataMessages } from './masterDataMessages';

const FLAG = 'inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap text-sm text-occ-text '
  + 'has-[:disabled]:text-occ-faint [@media(pointer:coarse)]:min-h-11';
const FLAG_BOX = 'h-4 w-4 shrink-0 accent-occ-accent';
const FORM = 'flex flex-col gap-3 border-t border-occ-line p-3';

const toggle = (list, value, on) => (on ? [...new Set([...list, value])] : list.filter(item => item !== value));

function Checks({ legend, options, selected, onChange, disabled }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs font-semibold text-occ-muted">{legend}</legend>
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map(option => (
          <label key={option.value} className={FLAG}>
            <input type="checkbox" className={FLAG_BOX} checked={selected.includes(option.value)} disabled={disabled}
              onChange={event => onChange(toggle(selected, option.value, event.target.checked))} />
            {option.label}
          </label>
        ))}
      </span>
    </fieldset>
  );
}

function Failure({ text }) {
  if (!text) return null;
  return <p role="alert" className="flex items-start gap-1.5 text-xs text-occ-text">
    <OccGlyph name="attention" className="mt-0.5" /><span>{text}</span></p>;
}

/** A command with the intent's Idempotency-Key; a 409 or a 404 is explained by the page, which reads again. */
function useIntent(onDone, onConflict) {
  const keys = useRef(createCommandKeyHolder());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action, body, send, success) => {
    setBusy(true);
    setError('');
    try {
      const result = await keys.current.run(action, body, send);
      onDone(success(result));
      return true;
    } catch (failure) {
      if (isConflict(failure) || failure?.status === 404) onConflict(masterDataMessage(failure));
      else setError(masterDataMessage(failure));
      return false;
    } finally { setBusy(false); }
  };
  return { busy, error, run };
}

/**
 * «Carnets exigidos por posición» (ADR-0045): the permits each stand requires, one stand at a time with its version,
 * or «Aplicar a varias posiciones». The options are the system permits and the active custom ones of Gestión Humana.
 */
export default function StandRequiredPermitsPanel({ stationId, stands, permitTypes, canUpdate, onDone, onConflict }) {
  const { t, locale } = useTranslation(masterDataMessages);
  const [editing, setEditing] = useState(null);
  const [batch, setBatch] = useState({ stands: [], permits: [] });
  const single = useIntent(onDone, onConflict);
  const many = useIntent(onDone, onConflict);
  const options = (permitTypes ?? []).map(type => ({ value: type.code, label: type.name }));
  const list = names => new Intl.ListFormat(locale ?? 'es', { type: 'conjunction' }).format(names);

  const saveOne = async stand => {
    const body = { documentTypeCodes: [...editing.codes].sort(), expectedVersion: stand.version };
    const saved = await single.run('stand.required_permits', { id: stand.id, ...body },
      key => setOccStandRequiredPermits(stand.id, body, key), result => t('permits.saved', { code: result.code }));
    if (saved) setEditing(null);
  };
  const applyMany = async event => {
    event.preventDefault();
    const body = { stationId, standIds: [...batch.stands], documentTypeCodes: [...batch.permits].sort() };
    const saved = await many.run('stand.required_permits_batch', body, key => applyOccStandRequiredPermits(body, key),
      result => t('permits.batch.done', { count: result.stands.length }));
    if (saved) setBatch({ stands: [], permits: [] });
  };

  const columns = [
    { key: 'stand', header: t('permits.columns.stand'), width: '8rem',
      render: stand => <span className="font-mono">{stand.code}</span> },
    {
      key: 'permits', header: t('permits.columns.permits'),
      render: stand => (editing?.id === stand.id ? (
        <span className="flex flex-col gap-2">
          <Checks legend={t('permits.permitsOf', { code: stand.code })} options={options} selected={editing.codes}
            disabled={single.busy} onChange={codes => setEditing(current => ({ ...current, codes }))} />
          <span className="flex flex-wrap gap-2">
            <OccButton size="sm" onClick={() => void saveOne(stand)} disabled={single.busy}>
              {single.busy ? t('common.saving') : t('common.save')}</OccButton>
            <OccButton size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={single.busy}>
              {t('permits.cancel')}</OccButton>
          </span>
          <Failure text={single.error} />
        </span>
      ) : (
        <span data-required-permits={stand.code}>
          {stand.requiredPermits?.length ? t('permits.requires', { names: list(stand.requiredPermits.map(item => item.name)) })
            : t('permits.none')}
        </span>
      )),
    },
    {
      key: 'change', header: '', width: '8rem',
      render: stand => (canUpdate && editing?.id !== stand.id && options.length > 0 ? (
        <OccButton size="sm" variant="ghost" aria-label={t('permits.edit', { code: stand.code })}
          onClick={() => setEditing({ id: stand.id, codes: (stand.requiredPermits ?? []).map(item => item.code) })}>
          {t('permits.editShort')}</OccButton>
      ) : null),
    },
  ];

  return <>
    {options.length === 0 && <p className="px-3 pt-2 text-xs text-occ-muted">{t('permits.noTypes')}</p>}
    <OccDataTable caption={t('permits.title')} columns={columns} rows={stands} labels={{ empty: t('permits.empty') }} />
    {canUpdate && options.length > 0 && stands.length > 0 && (
      <form onSubmit={applyMany} aria-label={t('permits.batch.title')} className={FORM}>
        <p className="text-sm font-semibold">{t('permits.batch.title')}</p>
        <p className="text-xs text-occ-muted">{t('permits.batch.hint')}</p>
        <Checks legend={t('permits.batch.stands')} options={stands.map(stand => ({ value: stand.id, label: stand.code }))}
          selected={batch.stands} disabled={many.busy} onChange={value => setBatch(current => ({ ...current, stands: value }))} />
        <Checks legend={t('permits.batch.permits')} options={options} selected={batch.permits} disabled={many.busy}
          onChange={value => setBatch(current => ({ ...current, permits: value }))} />
        <span><OccButton type="submit" disabled={many.busy || batch.stands.length === 0}>
          {many.busy ? t('common.saving') : t('permits.batch.submit', { count: batch.stands.length })}</OccButton></span>
        <Failure text={many.error} />
      </form>
    )}
  </>;
}
