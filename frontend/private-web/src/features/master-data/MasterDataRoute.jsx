import { useCallback, useEffect, useId, useRef, useState } from 'react';
import AppLink from '../../components/AppLink';
import { useTranslation } from '../../i18n/LanguageScope';
import { useOptionalDepartmentAccess } from '../access/DepartmentAccessContext';
import { useOccShellChannel } from '../admin-occ/shell/occShellContext';
import { useOccStation } from '../admin-occ/useOccStation';
import { writeSelection } from '../maps/core/mapSelection';
import { OCC_CLASSES } from '../occ-ui/classes';
import OccButton, { occButtonClass } from '../occ-ui/OccButton';
import OccDataTable from '../occ-ui/OccDataTable';
import { OccSelectField, OccTextField, occControlClass } from '../occ-ui/OccField';
import OccGlyph from '../occ-ui/OccGlyph';
import OccPanel, { OccRemoteView } from '../occ-ui/OccPanel';
import OccPlate from '../occ-ui/OccPlate';
import OccSkeleton from '../occ-ui/OccSkeleton';
import OccStatusPill from '../occ-ui/OccStatusPill';
import OccToolbar from '../occ-ui/OccToolbar';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { isConflict, isForbidden } from '../../services/problemMessages';
import {
  AIRCRAFT_SIZES, createOccAircraftType, createOccStand, createOccTerminal, loadOccMasterData, masterDataMessage,
  updateOccAircraftType, updateOccStand, updateOccTerminal,
} from '../../services/occMasterDataService';
import { sortByStandCode } from '../../services/standCodes';
import { masterDataMessages } from './masterDataMessages';
import StandRequiredPermitsPanel from './StandRequiredPermitsPanel';

// Template D of the design («Registro»): the toolbar with the page title, then one panel per register, each with its
// dense table of edit rows and, under it, the form that adds one.
const SIZES = Object.freeze(Object.keys(AIRCRAFT_SIZES));
// A control of an edit row: the OCC well, sized by its column.
const CONTROL = occControlClass({ kind: 'input' });
const SELECT = occControlClass({ kind: 'select' });
// A check box on its word, the box in cyan once ticked; 32 px high with a mouse and 44 px on touch. Read-only, the word
// takes the faint text of what cannot change.
const FLAG = 'inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap text-sm text-occ-text '
  + 'has-[:disabled]:text-occ-faint [@media(pointer:coarse)]:min-h-11';
const FLAG_BOX = 'h-4 w-4 shrink-0 accent-occ-accent';
// A record out of use stays on its row, dimmed, with its «Inactiva» pill in full contrast beside the code.
const DIMMED = 'opacity-70';
const FORM = 'flex flex-wrap items-end gap-3 border-t border-occ-line p-3';
const NOTE = 'px-3 pb-3 pt-2 text-xs text-occ-muted';
const ROW_ERROR = 'flex items-start gap-1.5 text-xs text-occ-text';
const STATE_SLAB = 'rounded-md border border-occ-line bg-occ-panel text-occ-text';

const mapHref = code => `/admin-occ/positions-map?${writeSelection(new URLSearchParams(), { selection: { kind: 'stand', id: code } })}`;

/**
 * One command of the screen: the intent's Idempotency-Key (a 5xx or a network failure retries with the same key and
 * body) and the Spanish message of a refusal. A 409 or a 404 is explained by the page, which reads the data again so
 * the next attempt starts from fresh versions.
 */
function useCommand(onDone, onConflict, onRefused) {
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
      if (isConflict(failure) || failure?.status === 404) {
        // The refused change is dropped: the row shows what the server keeps.
        onRefused?.();
        onConflict(masterDataMessage(failure));
      }
      else setError(masterDataMessage(failure));
      return false;
    } finally { setBusy(false); }
  };
  return { busy, error, run };
}

/**
 * The edit rows of one table: a draft and a command per row, as useCommand gives each form. A row is its record at one
 * version (`id-version`), as the row components of the list were keyed before the table: a change saved here or by
 * another seat brings a new version, and with it a fresh draft from the server and a new intent.
 * - `draftOf(row)` and `edit(row, change)`: the row's draft, the record itself until it is edited; `dirty(row)` once
 *   the draft differs from the record.
 * - `run(row, action, body, send, success)`: sends the change with the row's Idempotency-Key, which it keeps while OCC
 *   retries the same change after an uncertain answer. A 409 or a 404 drops the change, so the row shows what the
 *   server keeps, and the page explains it and reads the data again; any other failure stays on the row.
 * - `busy(row)` and `error(row)`: the row's command on its way, and its failure.
 */
function useRowEdits(initialOf, onDone, onConflict) {
  const keys = useRef(new Map());
  const [drafts, setDrafts] = useState({});
  const [commands, setCommands] = useState({});
  const signatureOf = row => `${row.id}-${row.version}`;
  const draftOf = row => drafts[signatureOf(row)] ?? initialOf(row);
  const edit = (row, change) => {
    const signature = signatureOf(row);
    setDrafts(all => ({ ...all, [signature]: { ...(all[signature] ?? initialOf(row)), ...change } }));
  };
  const keysOf = signature => {
    if (!keys.current.has(signature)) keys.current.set(signature, createCommandKeyHolder());
    return keys.current.get(signature);
  };
  const settle = (signature, error) => setCommands(all => ({ ...all, [signature]: { busy: false, error } }));
  const run = async (row, action, body, send, success) => {
    const signature = signatureOf(row);
    setCommands(all => ({ ...all, [signature]: { busy: true, error: '' } }));
    try {
      const result = await keysOf(signature).run(action, body, send);
      settle(signature, '');
      onDone(success(result));
      return true;
    } catch (failure) {
      if (isConflict(failure) || failure?.status === 404) {
        // The refused change is dropped: the row shows what the server keeps.
        setDrafts(all => {
          const next = { ...all };
          delete next[signature];
          return next;
        });
        settle(signature, '');
        onConflict(masterDataMessage(failure));
      } else settle(signature, masterDataMessage(failure));
      return false;
    }
  };
  const dirty = row => {
    const draft = draftOf(row);
    const initial = initialOf(row);
    return Object.keys(initial).some(key => draft[key] !== initial[key]);
  };
  return {
    draftOf, edit, dirty, run,
    busy: row => commands[signatureOf(row)]?.busy ?? false,
    error: row => commands[signatureOf(row)]?.error ?? '',
  };
}

function Failure({ text }) {
  return text ? (
    <span role="alert" className={ROW_ERROR}>
      <OccGlyph name="attention" className="mt-px" />
      <span className="min-w-0">{text}</span>
    </span>
  ) : null;
}

function Flag({ label, checked, disabled, onChange }) {
  return <label className={FLAG}>
    <input type="checkbox" className={FLAG_BOX} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    {label}
  </label>;
}

/** The content of a cell of a record out of use, dimmed. */
function Dim({ active, children }) {
  return <span className={active ? undefined : DIMMED}>{children}</span>;
}

/** Beside the code: the «Inactiva» pill of a record out of use and the «Con historial» of a code that is fixed. */
function CodeCell({ active, history, inactiveLabel, historyLabel, children }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Dim active={active}>{children}</Dim>
      {active ? null : <OccStatusPill size="sm" tone="muted" label={inactiveLabel} />}
      {history ? <span className="text-xs text-occ-muted">{historyLabel}</span> : null}
    </span>
  );
}

/** «Guardar» once the row changes, and the row's failure. */
function RowChange({ show, busy, error, onSave, disabled = false }) {
  const { t } = useTranslation(masterDataMessages);
  if (!show && !error) return null;
  return (
    <span className="flex flex-col items-start gap-1">
      {show ? <OccButton size="sm" busy={busy} busyLabel={t('common.saving')} disabled={disabled} onClick={onSave}>
        {t('common.save')}</OccButton> : null}
      <Failure text={error} />
    </span>
  );
}

function TerminalsTable({ terminals, canUpdate, onDone, onConflict }) {
  const { t } = useTranslation(masterDataMessages);
  const historyId = useId();
  const rows = useRowEdits(terminal => ({ code: terminal.code, name: terminal.name, isActive: terminal.isActive }),
    onDone, onConflict);
  const save = terminal => {
    const draft = rows.draftOf(terminal);
    const body = { code: draft.code, name: draft.name, isActive: draft.isActive, expectedVersion: terminal.version };
    return rows.run(terminal, 'terminal.update', { id: terminal.id, ...body }, key => updateOccTerminal(terminal.id, body, key),
      saved => t(saved.isActive === terminal.isActive ? 'terminals.updated'
        : saved.isActive ? 'terminals.reactivated' : 'terminals.deactivated', { code: saved.code }));
  };
  const columns = [
    {
      key: 'code', header: t('terminals.columns.code'), width: '16rem',
      render: terminal => (
        <CodeCell active={terminal.isActive} history={terminal.hasHistory} inactiveLabel={t('terminals.inactive')}
          historyLabel={t('terminals.historyTag')}>
          <input className={`${CONTROL} w-28 font-mono`} aria-label={t('terminals.code', { code: terminal.code })}
            aria-describedby={terminal.hasHistory ? historyId : undefined} value={rows.draftOf(terminal).code}
            disabled={!canUpdate || terminal.hasHistory} maxLength={16}
            onChange={event => rows.edit(terminal, { code: event.target.value.toUpperCase() })} />
        </CodeCell>
      ),
    },
    {
      key: 'name', header: t('terminals.columns.name'),
      render: terminal => (
        <Dim active={terminal.isActive}>
          <input className={`${CONTROL} w-full min-w-48`} aria-label={t('terminals.name', { code: terminal.code })}
            value={rows.draftOf(terminal).name} disabled={!canUpdate} maxLength={120}
            onChange={event => rows.edit(terminal, { name: event.target.value })} />
        </Dim>
      ),
    },
    {
      key: 'state', header: t('terminals.columns.state'), width: '8rem',
      render: terminal => (
        <Dim active={terminal.isActive}>
          <Flag label={t('terminals.active')} checked={rows.draftOf(terminal).isActive} disabled={!canUpdate}
            onChange={isActive => rows.edit(terminal, { isActive })} />
        </Dim>
      ),
    },
    {
      key: 'change', header: '', width: '12rem',
      render: terminal => <RowChange show={canUpdate && rows.dirty(terminal)} busy={rows.busy(terminal)} error={rows.error(terminal)}
        onSave={() => void save(terminal)} />,
    },
  ];
  return <>
    <OccDataTable caption={t('terminals.title')} columns={columns} rows={terminals} labels={{ empty: t('terminals.empty') }} />
    {terminals.some(terminal => terminal.hasHistory) ? <p id={historyId} className={NOTE}>{t('terminals.history')}</p> : null}
  </>;
}

function TerminalForm({ stationId, onDone, onConflict }) {
  const { t } = useTranslation(masterDataMessages);
  const [draft, setDraft] = useState({ code: '', name: '' });
  const command = useCommand(onDone, onConflict);
  const submit = async event => {
    event.preventDefault();
    const body = { stationId, code: draft.code.trim(), name: draft.name.trim() };
    if (await command.run('terminal.create', body, key => createOccTerminal(body, key),
      saved => t('terminals.created', { code: saved.code }))) setDraft({ code: '', name: '' });
  };
  return <form onSubmit={submit} aria-label={t('terminals.form.label')} className={FORM}>
    <OccTextField label={t('terminals.form.code')} className="w-28" controlClassName="font-mono" required maxLength={16}
      value={draft.code} placeholder={t('terminals.form.codePlaceholder')}
      onChange={event => setDraft(value => ({ ...value, code: event.target.value.toUpperCase() }))} />
    <OccTextField label={t('terminals.form.name')} className="min-w-48 flex-1" required maxLength={120} value={draft.name}
      placeholder={t('terminals.form.namePlaceholder')} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} />
    <OccButton type="submit" variant="primary" busy={command.busy} busyLabel={t('common.creating')}
      disabled={!draft.code.trim() || !draft.name.trim()}>{t('terminals.form.submit')}</OccButton>
    <Failure text={command.error} />
  </form>;
}

function StandsTable({ stands, terminals, canUpdate, canSeeMap, onDone, onConflict }) {
  const { t } = useTranslation(masterDataMessages);
  const historyId = useId();
  const rows = useRowEdits(stand => ({ terminalId: stand.terminalId ?? '', code: stand.code,
    hasBoardingBridge: stand.hasBoardingBridge, isRemote: stand.isRemote, maxAircraftSize: stand.maxAircraftSize ?? null,
    isActive: stand.isActive }), onDone, onConflict);
  const set = (stand, key, value) => rows.edit(stand, { [key]: value });
  const save = stand => {
    const body = { ...rows.draftOf(stand), expectedVersion: stand.version };
    return rows.run(stand, 'stand.update', { id: stand.id, ...body }, key => updateOccStand(stand.id, body, key),
      saved => t(saved.isActive === stand.isActive ? 'stands.updated'
        : saved.isActive ? 'stands.reactivated' : 'stands.deactivated', { code: saved.code }));
  };
  const columns = [
    {
      key: 'code', header: t('stands.columns.code'), width: '15rem',
      render: stand => (
        <CodeCell active={stand.isActive} history={stand.hasHistory} inactiveLabel={t('stands.inactive')}
          historyLabel={t('stands.historyTag')}>
          <input className={`${CONTROL} w-24 font-mono`} aria-label={t('stands.code', { code: stand.code })}
            aria-describedby={stand.hasHistory ? historyId : undefined} value={rows.draftOf(stand).code}
            disabled={!canUpdate || stand.hasHistory} maxLength={24}
            onChange={event => set(stand, 'code', event.target.value.toUpperCase())} />
        </CodeCell>
      ),
    },
    {
      key: 'terminal', header: t('stands.columns.terminal'), width: '10rem',
      render: stand => {
        const draft = rows.draftOf(stand);
        return (
          <Dim active={stand.isActive}>
            <select className={`${SELECT} w-36`} aria-label={t('stands.terminal', { code: stand.code })} value={draft.terminalId}
              disabled={!canUpdate || stand.hasHistory} onChange={event => set(stand, 'terminalId', event.target.value)}>
              {!draft.terminalId && <option value="">{t('stands.noTerminal')}</option>}
              {terminals.map(terminal => <option key={terminal.id} value={terminal.id}>
                {terminal.isActive ? terminal.code : t('stands.inactiveTerminal', { code: terminal.code })}</option>)}
            </select>
          </Dim>
        );
      },
    },
    {
      key: 'attributes', header: t('stands.columns.attributes'), width: '12rem',
      render: stand => (
        <Dim active={stand.isActive}>
          <span className="flex flex-wrap items-center gap-x-4">
            <Flag label={t('stands.bridge')} checked={rows.draftOf(stand).hasBoardingBridge} disabled={!canUpdate}
              onChange={value => set(stand, 'hasBoardingBridge', value)} />
            <Flag label={t('stands.remote')} checked={rows.draftOf(stand).isRemote} disabled={!canUpdate}
              onChange={value => set(stand, 'isRemote', value)} />
          </span>
        </Dim>
      ),
    },
    {
      key: 'size', header: t('stands.columns.size'), width: '12rem',
      render: stand => (
        <Dim active={stand.isActive}>
          <select className={`${SELECT} w-44`} aria-label={t('stands.size', { code: stand.code })}
            value={rows.draftOf(stand).maxAircraftSize ?? ''} disabled={!canUpdate}
            onChange={event => set(stand, 'maxAircraftSize', event.target.value || null)}>
            <option value="">{t('stands.anySize')}</option>
            {SIZES.map(size => <option key={size} value={size}>{t(`sizes.${size}`)}</option>)}
          </select>
        </Dim>
      ),
    },
    {
      key: 'state', header: t('stands.columns.state'), width: '7rem',
      render: stand => (
        <Dim active={stand.isActive}>
          <Flag label={t('stands.active')} checked={rows.draftOf(stand).isActive} disabled={!canUpdate}
            onChange={value => set(stand, 'isActive', value)} />
        </Dim>
      ),
    },
    {
      key: 'change', header: '',
      render: stand => (
        <span className="flex flex-wrap items-start gap-2">
          {/* The stand on the positions map, selected through the URL (contratos 2.1). */}
          {canSeeMap ? (
            <AppLink href={mapHref(stand.code)} aria-label={t('stands.viewOnMapLabel', { code: stand.code })}
              className={occButtonClass({ variant: 'ghost', size: 'sm' })}>{t('stands.viewOnMap')}</AppLink>
          ) : null}
          <RowChange show={canUpdate && rows.dirty(stand)} busy={rows.busy(stand)} error={rows.error(stand)}
            disabled={!rows.draftOf(stand).terminalId} onSave={() => void save(stand)} />
        </span>
      ),
    },
  ];
  return <>
    <OccDataTable caption={t('stands.title')} columns={columns} rows={stands} labels={{ empty: t('stands.empty') }} />
    {stands.some(stand => stand.hasHistory) ? <p id={historyId} className={NOTE}>{t('stands.history')}</p> : null}
  </>;
}

function StandForm({ stationId, terminals, onDone, onConflict }) {
  const { t } = useTranslation(masterDataMessages);
  const active = terminals.filter(terminal => terminal.isActive);
  const empty = { terminalId: active[0]?.id ?? '', code: '', hasBoardingBridge: false, isRemote: false, maxAircraftSize: null };
  const [draft, setDraft] = useState(empty);
  const command = useCommand(onDone, onConflict);
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const submit = async event => {
    event.preventDefault();
    const body = { stationId, ...draft, code: draft.code.trim() };
    if (await command.run('stand.create', body, key => createOccStand(body, key), saved => t('stands.created', { code: saved.code })))
      setDraft(current => ({ ...empty, terminalId: current.terminalId }));
  };
  if (active.length === 0) return <p className={`border-t border-occ-line p-3 text-sm text-occ-muted`}>{t('stands.noActiveTerminal')}</p>;
  return <form onSubmit={submit} aria-label={t('stands.form.label')} className={FORM}>
    <OccSelectField label={t('stands.form.terminal')} className="w-36" required value={draft.terminalId}
      onChange={event => set('terminalId', event.target.value)}>
      {active.map(terminal => <option key={terminal.id} value={terminal.id}>{terminal.code}</option>)}
    </OccSelectField>
    <OccTextField label={t('stands.form.code')} className="w-24" controlClassName="font-mono" required maxLength={24}
      value={draft.code} placeholder={t('stands.form.codePlaceholder')} onChange={event => set('code', event.target.value.toUpperCase())} />
    <Flag label={t('stands.bridge')} checked={draft.hasBoardingBridge} onChange={value => set('hasBoardingBridge', value)} />
    <Flag label={t('stands.remote')} checked={draft.isRemote} onChange={value => set('isRemote', value)} />
    <OccSelectField label={t('stands.form.size')} className="w-44" value={draft.maxAircraftSize ?? ''}
      onChange={event => set('maxAircraftSize', event.target.value || null)}>
      <option value="">{t('stands.anySize')}</option>
      {SIZES.map(size => <option key={size} value={size}>{t(`sizes.${size}`)}</option>)}
    </OccSelectField>
    <OccButton type="submit" variant="primary" busy={command.busy} busyLabel={t('common.creating')}
      disabled={!draft.code.trim() || !draft.terminalId}>{t('stands.form.submit')}</OccButton>
    <Failure text={command.error} />
  </form>;
}

function AircraftTypesTable({ types, canUpdate, onDone, onConflict }) {
  const { t } = useTranslation(masterDataMessages);
  const rows = useRowEdits(type => ({ iataCode: type.iataCode ?? '', manufacturer: type.manufacturer, model: type.model,
    sizeCategory: type.sizeCategory ?? null, isActive: type.isActive }), onDone, onConflict);
  const set = (type, key, value) => rows.edit(type, { [key]: value });
  const save = type => {
    const draft = rows.draftOf(type);
    const body = { ...draft, iataCode: draft.iataCode.trim() || null, expectedVersion: type.version };
    return rows.run(type, 'aircraft_type.update', { id: type.id, ...body }, key => updateOccAircraftType(type.id, body, key),
      saved => t(saved.isActive === type.isActive ? 'aircraftTypes.updated'
        : saved.isActive ? 'aircraftTypes.reactivated' : 'aircraftTypes.deactivated', { code: saved.icaoCode }));
  };
  const columns = [
    {
      key: 'icao', header: t('aircraftTypes.columns.icao'), width: '11rem',
      render: type => (
        <CodeCell active={type.isActive} inactiveLabel={t('aircraftTypes.inactive')}>
          <OccPlate kind="code">{type.icaoCode}</OccPlate>
        </CodeCell>
      ),
    },
    {
      key: 'iata', header: t('aircraftTypes.columns.iata'), width: '6.5rem',
      render: type => (
        <Dim active={type.isActive}>
          <input className={`${CONTROL} w-20 font-mono`} aria-label={t('aircraftTypes.iata', { code: type.icaoCode })}
            value={rows.draftOf(type).iataCode} disabled={!canUpdate} maxLength={3}
            onChange={event => set(type, 'iataCode', event.target.value.toUpperCase())} />
        </Dim>
      ),
    },
    {
      key: 'manufacturer', header: t('aircraftTypes.columns.manufacturer'), width: '11rem',
      render: type => (
        <Dim active={type.isActive}>
          <input className={`${CONTROL} w-40`} aria-label={t('aircraftTypes.manufacturer', { code: type.icaoCode })}
            value={rows.draftOf(type).manufacturer} disabled={!canUpdate} maxLength={100}
            onChange={event => set(type, 'manufacturer', event.target.value)} />
        </Dim>
      ),
    },
    {
      key: 'model', header: t('aircraftTypes.columns.model'),
      render: type => (
        <Dim active={type.isActive}>
          <input className={`${CONTROL} w-full min-w-36`} aria-label={t('aircraftTypes.model', { code: type.icaoCode })}
            value={rows.draftOf(type).model} disabled={!canUpdate} maxLength={100}
            onChange={event => set(type, 'model', event.target.value)} />
        </Dim>
      ),
    },
    {
      key: 'size', header: t('aircraftTypes.columns.size'), width: '12rem',
      render: type => (
        <Dim active={type.isActive}>
          <select className={`${SELECT} w-44`} aria-label={t('aircraftTypes.size', { code: type.icaoCode })}
            value={rows.draftOf(type).sizeCategory ?? ''} disabled={!canUpdate}
            onChange={event => set(type, 'sizeCategory', event.target.value || null)}>
            <option value="">{t('aircraftTypes.unclassified')}</option>
            {SIZES.map(size => <option key={size} value={size}>{t(`sizes.${size}`)}</option>)}
          </select>
        </Dim>
      ),
    },
    {
      key: 'state', header: t('aircraftTypes.columns.state'), width: '7rem',
      render: type => (
        <Dim active={type.isActive}>
          <Flag label={t('aircraftTypes.active')} checked={rows.draftOf(type).isActive} disabled={!canUpdate}
            onChange={value => set(type, 'isActive', value)} />
        </Dim>
      ),
    },
    {
      key: 'change', header: '', width: '10rem',
      render: type => <RowChange show={canUpdate && rows.dirty(type)} busy={rows.busy(type)} error={rows.error(type)}
        onSave={() => void save(type)} />,
    },
  ];
  return <OccDataTable caption={t('aircraftTypes.title')} columns={columns} rows={types} labels={{ empty: t('aircraftTypes.empty') }} />;
}

function AircraftTypeForm({ onDone, onConflict }) {
  const { t } = useTranslation(masterDataMessages);
  const empty = { icaoCode: '', iataCode: '', manufacturer: '', model: '', sizeCategory: null };
  const [draft, setDraft] = useState(empty);
  const command = useCommand(onDone, onConflict);
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const submit = async event => {
    event.preventDefault();
    const body = { icaoCode: draft.icaoCode.trim(), iataCode: draft.iataCode.trim() || null, manufacturer: draft.manufacturer.trim(),
      model: draft.model.trim(), sizeCategory: draft.sizeCategory };
    if (await command.run('aircraft_type.create', body, key => createOccAircraftType(body, key),
      saved => t('aircraftTypes.created', { code: saved.icaoCode }))) setDraft(empty);
  };
  return <form onSubmit={submit} aria-label={t('aircraftTypes.form.label')} className={FORM}>
    <OccTextField label={t('aircraftTypes.form.icao')} className="w-24" controlClassName="font-mono" required maxLength={4}
      value={draft.icaoCode} placeholder={t('aircraftTypes.form.icaoPlaceholder')}
      onChange={event => set('icaoCode', event.target.value.toUpperCase())} />
    <OccTextField label={t('aircraftTypes.form.iata')} className="w-20" controlClassName="font-mono" maxLength={3}
      value={draft.iataCode} placeholder={t('aircraftTypes.form.iataPlaceholder')}
      onChange={event => set('iataCode', event.target.value.toUpperCase())} />
    <OccTextField label={t('aircraftTypes.form.manufacturer')} className="w-40" required maxLength={100}
      value={draft.manufacturer} placeholder={t('aircraftTypes.form.manufacturerPlaceholder')}
      onChange={event => set('manufacturer', event.target.value)} />
    <OccTextField label={t('aircraftTypes.form.model')} className="min-w-36 flex-1" required maxLength={100} value={draft.model}
      placeholder={t('aircraftTypes.form.modelPlaceholder')} onChange={event => set('model', event.target.value)} />
    <OccSelectField label={t('aircraftTypes.form.size')} className="w-44" value={draft.sizeCategory ?? ''}
      onChange={event => set('sizeCategory', event.target.value || null)}>
      <option value="">{t('aircraftTypes.unclassified')}</option>
      {SIZES.map(size => <option key={size} value={size}>{t(`sizes.${size}`)}</option>)}
    </OccSelectField>
    <OccButton type="submit" variant="primary" busy={command.busy} busyLabel={t('common.creating')}
      disabled={!draft.icaoCode.trim() || !draft.manufacturer.trim() || !draft.model.trim()}>
      {t('aircraftTypes.form.submit')}</OccButton>
    <Failure text={command.error} />
  </form>;
}

/** What the last command did: a plain slab when it was saved, the amber slab of attention when it was refused. */
function Feedback({ feedback }) {
  if (!feedback.text) return null;
  const refused = feedback.tone === 'danger';
  return (
    <p role={refused ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-md border border-occ-line px-3 py-2 text-sm text-occ-text ${refused ? 'bg-occ-warn-soft' : 'bg-occ-panel-raised'}`}>
      {refused ? <OccGlyph name="attention" className="mt-0.5" /> : null}
      <span className="min-w-0">{feedback.text}</span>
    </p>
  );
}

/**
 * «Datos maestros» of OCC (2-A): the terminals and stands of the station and the shared aircraft types. A code is
 * fixed once flights, coverages or shifts used it, something in use is never deactivated, and nothing is deleted.
 */
export default function MasterDataRoute() {
  const { t } = useTranslation(masterDataMessages);
  const station = useOccStation();
  const access = useOptionalDepartmentAccess();
  // The frame's stable channel: listening on it does not re-render the page when the live link or the notices move.
  const { subscribe } = useOccShellChannel();
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState({ tone: '', text: '' });
  const live = useRef(() => {});

  useEffect(() => {
    if (!station.stationId) return undefined;
    const controller = new AbortController();
    const read = () => loadOccMasterData(station.stationId, { signal: controller.signal })
      .then(data => setState({ status: 'success', data }))
      .catch(error => {
        if (error?.name === 'AbortError') return;
        setState(current => (current.data && !isForbidden(error) ? current : { status: 'error', error }));
      });
    live.current = read;
    void read();
    return () => controller.abort();
  }, [station.stationId, attempt]);

  // Another OCC seat changed the station's layout: re-read under current permissions. The announcement comes from the
  // tab's single account-change observer, the OCC frame's (contratos 2.7): the page opens none of its own.
  useEffect(() => subscribe(['occ_planning'], () => { void live.current(); }), [subscribe]);

  const reread = useCallback(text => { setFeedback({ tone: 'danger', text }); void live.current(); }, []);
  const done = useCallback(text => { setFeedback({ tone: 'success', text }); void live.current(); }, []);

  const data = state.data;
  let body;
  if (!station.stationId) body = <p role="alert" className={`${OCC_CLASSES.card} text-sm`}>{t('states.noStation')}</p>;
  else if (state.status === 'loading') {
    body = <OccRemoteView status="loading" className={STATE_SLAB}
      skeleton={<OccSkeleton rows={6} label={t('states.loading')} />} />;
  } else if (state.status === 'error' && isForbidden(state.error)) {
    body = <p role="alert" className={`${OCC_CLASSES.card} text-sm`}>{t('states.forbidden')}</p>;
  } else if (state.status === 'error') {
    // The service's own sentence for the failure (masterDataMessage), never the server's title.
    body = <OccRemoteView status="error" className={STATE_SLAB} onRetry={() => setAttempt(value => value + 1)}
      labels={{ error: masterDataMessage(state.error), retry: t('states.retry') }} />;
  } else {
    const props = { onDone: done, onConflict: reread };
    body = <div className="flex min-w-0 flex-col gap-3">
      {!data.canCreate && !data.canUpdate && <p role="status" className={`${OCC_CLASSES.card} text-sm`}>{t('states.readOnly')}</p>}
      <OccPanel title={t('terminals.title')} meta={t('terminals.about')}>
        <TerminalsTable terminals={data.terminals} canUpdate={data.canUpdate} {...props} />
        {data.canCreate && <TerminalForm stationId={data.stationId} {...props} />}
      </OccPanel>
      <OccPanel title={t('stands.title')} meta={t('stands.about')}>
        <StandsTable stands={sortByStandCode(data.stands)} terminals={data.terminals} canUpdate={data.canUpdate}
          canSeeMap={Boolean(access?.can('operations.positions_map.read'))} {...props} />
        {data.canCreate && <StandForm key={data.terminals.map(item => `${item.id}${item.isActive}`).join()} stationId={data.stationId}
          terminals={data.terminals} {...props} />}
      </OccPanel>
      <OccPanel title={t('permits.title')} meta={t('permits.about')}>
        <StandRequiredPermitsPanel stationId={data.stationId} stands={sortByStandCode(data.stands)}
          permitTypes={data.permitTypes} canUpdate={data.canUpdate} {...props} />
      </OccPanel>
      <OccPanel title={t('aircraftTypes.title')} meta={t('aircraftTypes.about')}>
        <AircraftTypesTable types={data.aircraftTypes} canUpdate={data.canUpdate} {...props} />
        {data.canCreate && <AircraftTypeForm {...props} />}
      </OccPanel>
    </div>;
  }

  // The station is in the status bar of the OCC frame: the page has no badge of its own, nor a line under its title.
  return (
    <section className="flex min-w-0 flex-col gap-3 text-occ-text">
      <OccToolbar title={t('title')} />
      <Feedback feedback={feedback} />
      {body}
    </section>
  );
}
