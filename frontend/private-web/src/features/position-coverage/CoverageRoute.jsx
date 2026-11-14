import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import AppLink from '../../components/AppLink';
import { useTranslation } from '../../i18n/LanguageScope';
import { useOptionalDepartmentAccess } from '../access/DepartmentAccessContext';
import { useOccStation } from '../admin-occ/useOccStation';
import { OCC_CLASSES } from '../occ-ui/classes';
import OccButton from '../occ-ui/OccButton';
import OccDataTable from '../occ-ui/OccDataTable';
import OccEmptyState from '../occ-ui/OccEmptyState';
import { OccSelectField, OccTextField, occControlClass } from '../occ-ui/OccField';
import OccGlyph from '../occ-ui/OccGlyph';
import OccPanel, { OccRemoteView } from '../occ-ui/OccPanel';
import OccPlate from '../occ-ui/OccPlate';
import OccSegmented from '../occ-ui/OccSegmented';
import OccStatusLegend from '../occ-ui/OccStatusLegend';
import OccStatusPill from '../occ-ui/OccStatusPill';
import OccToolbar from '../occ-ui/OccToolbar';
import { formatClock } from '../occ-ui/occTime';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { BUSINESS_TIME_ZONE } from '../../services/businessDay';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { isConflict } from '../../services/problemMessages';
import { stationDate } from '../../services/positionsMapService';
import {
  addOccStandConstraint, createOccCoverage, describeReasons, loadOccCoverage, releaseOccCoverage,
  removeOccStandConstraint, updateOccStandAttributes, updateOccTerminalRules,
} from '../../services/occCoverageService';
import { coverageMessages } from './coverageMessages';

// Template C of the design («Mesa de trabajo»): the toolbar with the page title and the date, the terminal and the view
// as segmented controls, then the board at the left and the form docked at the right from 1280 px.
const MASTER_DETAIL = 'grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]';
// The states of the page without a board (loading, refused, failed, without terminals) sit on one panel slab.
const STATE_SLAB = 'rounded-md border border-occ-line bg-occ-panel text-occ-text';
// A check box on its label: the box in cyan once ticked (it is chosen), 32 px high with a mouse and 44 px on touch.
const CHECK = 'inline-flex min-h-8 items-start gap-2 py-1.5 text-sm text-occ-text [@media(pointer:coarse)]:min-h-11';
const CHECKBOX = 'mt-0.5 h-4 w-4 shrink-0 accent-occ-accent';
// The same box inside a table row, beside its short word.
const FLAG = 'inline-flex items-center gap-1.5 text-sm text-occ-text [@media(pointer:coarse)]:min-h-11';
const FLAG_BOX = 'h-4 w-4 shrink-0 accent-occ-accent';
// A stand to hand to the agent: a toggle with its code in the identifiers' face, chosen = cyan on its soft slab.
const STAND_TOGGLE = 'inline-flex h-8 min-w-12 items-center justify-center gap-1 rounded border px-2 font-mono text-sm '
  + 'font-semibold [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11';
const STAND_ON = 'border-occ-accent bg-occ-accent-soft text-occ-accent';
const STAND_OFF = 'border-occ-line-strong text-occ-text hover:bg-occ-panel-raised';
const LINK = 'font-semibold text-occ-accent underline underline-offset-2';
const ROW_ERROR = 'flex items-start gap-1.5 text-xs text-occ-text';
const ATTRIBUTE_KEYS = Object.freeze(['hasBoardingBridge', 'isRemote', 'maxAircraftSize', 'isActive']);
// The tone of each mark the boards draw, read by their pills and by their legends, so a legend shows the board's own
// shapes: an attribute of a stand («Puente», «Estrecho») is a plain mark, the hollow circle; a deactivated stand is
// out of service, the slashed circle; and a coverage that reinforces stands already covered is a plain mark too.
const MARK_TONES = Object.freeze({ attribute: 'neutral', inactive: 'muted', reinforcement: 'neutral' });

// An agent's shift or a coverage's window, «06:00–14:00» in the station's time.
const shiftWindow = (start, end, locale) =>
  `${formatClock(start, locale, BUSINESS_TIME_ZONE)}–${formatClock(end, locale, BUSINESS_TIME_ZONE)}`;

/** What a refused command breaks: the amber slab with its triangle, the service's sentence and each broken rule. */
function Reasons({ error }) {
  if (!error) return null;
  const reasons = describeReasons(error.reasons);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-occ-line bg-occ-warn-soft px-3 py-2 text-sm text-occ-text">
      <OccGlyph name="attention" className="mt-0.5" />
      <div className="min-w-0">
        <p className="font-semibold">{error.message}</p>
        {reasons.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5">{reasons.map(text => <li key={text}>{text}</li>)}</ul>}
      </div>
    </div>
  );
}

/** The conditions of the chosen agent, each with its glyph and its word: what blocks a coverage asks for attention. */
function AgentConditions({ agent }) {
  const { t } = useTranslation(coverageMessages);
  const conditions = [
    agent.isJunior && { key: 'junior', tone: 'attention', label: t('form.badges.junior') },
    { key: 'license', tone: agent.hasDriverLicense ? 'active' : 'neutral',
      label: t(agent.hasDriverLicense ? 'form.badges.license' : 'form.badges.noLicense') },
    { key: 'bridge', tone: agent.hasBridgeQualification ? 'active' : 'neutral',
      label: t(agent.hasBridgeQualification ? 'form.badges.bridge' : 'form.badges.noBridge') },
    !agent.hasAirportPermit && { key: 'permit', tone: 'attention', label: t('form.badges.permitExpired') },
    agent.isAbsent && { key: 'absent', tone: 'attention', label: t('form.badges.absent') },
  ].filter(Boolean);
  return (
    <ul aria-label={t('form.badges.label')} className="flex flex-wrap gap-x-3 gap-y-1.5">
      {conditions.map(item => <li key={item.key}><OccStatusPill size="sm" tone={item.tone} label={item.label} /></li>)}
    </ul>
  );
}

/**
 * Form to hand an agent their stands for the shift; the server applies Pillier's rules. One intent keeps its
 * Idempotency-Key while OCC retries the same coverage after an uncertain answer (3-J), so a lost answer never turns
 * into «El agente ya cubre posiciones en ese horario».
 */
function CoverageForm({ board, terminal, date, onDone, onStale }) {
  const { t, locale } = useTranslation(coverageMessages);
  const bridgeMarkId = useId();
  const agents = board.agents.filter(agent => agent.terminalId === terminal.terminalId || terminal.code === 'B');
  const stands = board.stands.filter(stand => stand.terminalId === terminal.terminalId && stand.isActive);
  const [agentId, setAgentId] = useState('');
  const [selected, setSelected] = useState([]);
  const [mentorId, setMentorId] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [reinforcement, setReinforcement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const creation = useRef(createCommandKeyHolder());
  const agent = board.agents.find(item => item.agentId === agentId);
  const mentors = board.agents.filter(item => !item.isJunior && item.agentId !== agentId);
  const toggle = id => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]);

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const command = { stationId: board.stationId, date, agentId, terminalId: terminal.terminalId, standIds: selected,
      mentorAgentId: mentorId || null, vehicleCode: vehicle.trim() || null, isReinforcement: reinforcement };
    try {
      const result = await creation.current.run('create', command,
        key => createOccCoverage(command, { idempotencyKey: key }));
      setSelected([]); setMentorId(''); setVehicle(''); setReinforcement(false); setAgentId('');
      onDone(result);
    } catch (failure) {
      setError(failure);
      // The board changed meanwhile: it is read again before a new intent.
      if (failure?.status === 409) onStale?.();
    } finally { setBusy(false); }
  };

  const rules = terminal.requiresBridgeQualification ? 'form.rulesWithBridge' : 'form.rules';
  return (
    <OccPanel title={t('form.label')} meta={t('terminal', { code: terminal.code })}>
      <form onSubmit={submit} aria-label={t('form.label')} className="flex flex-col gap-3 p-3">
        <p className="text-xs text-occ-muted">{t(rules, { max: terminal.maxStandsPerAgent })}</p>
        <OccSelectField label={t('form.agent')} value={agentId} onChange={event => setAgentId(event.target.value)} required>
          <option value="">{t('form.chooseAgent')}</option>
          {agents.map(item => (
            <option key={item.agentId} value={item.agentId}>
              {t(item.isJunior ? 'form.juniorAgentOption' : 'form.agentOption', {
                name: item.name, start: formatClock(item.shiftStartsAt, locale, BUSINESS_TIME_ZONE),
                end: formatClock(item.shiftEndsAt, locale, BUSINESS_TIME_ZONE),
              })}
            </option>
          ))}
        </OccSelectField>
        {agent && <AgentConditions agent={agent} />}
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-occ-muted">
            {t('form.stands', { selected: selected.length, max: terminal.maxStandsPerAgent })}
          </legend>
          {stands.length === 0 ? <p className="text-sm text-occ-muted">{t('form.noStands')}</p> : (
            <div className="flex flex-wrap gap-1.5">
              {stands.map(stand => {
                const on = selected.includes(stand.standId);
                // The name is the stand's code alone (the cycle E2E presses it); the bridge mark describes it.
                return (
                  <button key={stand.standId} type="button" aria-pressed={on} onClick={() => toggle(stand.standId)}
                    aria-describedby={stand.hasBoardingBridge ? bridgeMarkId : undefined}
                    className={`${STAND_TOGGLE} ${on ? STAND_ON : STAND_OFF}`}>
                    {stand.code}{stand.hasBoardingBridge ? <span aria-hidden="true">⌁</span> : null}
                  </button>
                );
              })}
            </div>
          )}
          {stands.some(stand => stand.hasBoardingBridge) && (
            <p className="text-xs text-occ-muted"><span aria-hidden="true">⌁ </span><span id={bridgeMarkId}>{t('form.bridgeMark')}</span></p>
          )}
        </fieldset>
        {(agent?.isJunior || mentorId) && (
          <OccSelectField label={t('form.mentor')} value={mentorId} onChange={event => setMentorId(event.target.value)}>
            <option value="">{t('form.noMentor')}</option>
            {/* 2-N23: a mentor who is absent or without a current airport permit cannot accompany anyone. */}
            {mentors.map(item => (
              <option key={item.agentId} value={item.agentId} disabled={item.isAbsent || !item.hasAirportPermit}>
                {item.name}{item.isAbsent ? t('form.mentorAbsent') : ''}{!item.hasAirportPermit ? t('form.mentorWithoutPermit') : ''}
              </option>
            ))}
          </OccSelectField>
        )}
        {selected.length > 2 && (
          <OccTextField label={t('form.vehicle')} value={vehicle} maxLength={32} onChange={event => setVehicle(event.target.value)}
            placeholder={t('form.vehiclePlaceholder')} />
        )}
        <label className={CHECK}>
          <input type="checkbox" className={CHECKBOX} checked={reinforcement} onChange={event => setReinforcement(event.target.checked)} />
          {t('form.reinforcement')}
        </label>
        <Reasons error={error} />
        <OccButton type="submit" variant="primary" className="self-start" busy={busy} busyLabel={t('form.saving')}
          disabled={!agentId || selected.length === 0}>
          {t('form.submit')}
        </OccButton>
      </form>
    </OccPanel>
  );
}

/** The terminal's stands with who covers each, and the coverages of the day with their «Liberar». */
function CoverageBoard({ board, terminal, date, onChange, onStale }) {
  const { t, locale } = useTranslation(coverageMessages);
  const [error, setError] = useState(null);
  const releases = useRef(createCommandKeyHolder());
  const coverages = board.coverages.filter(item => item.terminalId === terminal.terminalId);
  const stands = board.stands.filter(stand => stand.terminalId === terminal.terminalId);
  // A release retried after an uncertain answer keeps its key and answers the board again (3-J).
  const release = async coverage => {
    setError(null);
    try {
      onChange(await releases.current.run('release', [coverage.id, date],
        key => releaseOccCoverage(coverage.id, date, { idempotencyKey: key })));
    } catch (failure) {
      setError(failure);
      if (failure?.status === 409) onStale?.();
    }
  };
  const meta = t('terminal', { code: terminal.code });
  // Each board's legend, in its header (contratos 2.4): the marks it draws, with the shape and the word of its pills.
  const standLegend = (
    <OccStatusLegend label={t('board.legend.label')} items={[
      { key: 'attribute', tone: MARK_TONES.attribute, label: t('board.legend.attribute') },
      { key: 'inactive', tone: MARK_TONES.inactive, label: t('board.inactive') },
    ]} />
  );
  const coverageLegend = (
    <OccStatusLegend label={t('coverages.legend.label')} items={[
      { key: 'reinforcement', tone: MARK_TONES.reinforcement, label: t('coverages.reinforcement') },
    ]} />
  );

  // No header is called «Puente», and neither is a word of the legend: the attribute's word is the only «Puente» of the
  // board.
  const standColumns = [
    { key: 'stand', header: t('board.columns.stand'), width: '6rem', render: stand => <OccPlate kind="stand">{stand.code}</OccPlate> },
    {
      key: 'attributes', header: t('board.columns.attributes'), width: '10rem',
      render: stand => (
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {stand.hasBoardingBridge && <OccStatusPill size="sm" tone={MARK_TONES.attribute} label={t('board.bridge')} />}
          {stand.maxAircraftSize === 'Narrowbody'
            && <OccStatusPill size="sm" tone={MARK_TONES.attribute} label={t('board.narrowbody')} />}
        </span>
      ),
    },
    {
      key: 'coveredBy', header: t('board.columns.coveredBy'),
      render: stand => {
        if (stand.coveredBy.length > 0) return stand.coveredBy.join(', ');
        return <span className="text-occ-muted">{stand.isActive ? t('board.noAgent') : '—'}</span>;
      },
    },
    {
      key: 'state', header: t('board.columns.state'), width: '8.5rem',
      // A normal stand carries nothing: only a deactivated one says so.
      render: stand => (stand.isActive ? null
        : <OccStatusPill size="sm" tone={MARK_TONES.inactive} label={t('board.inactive')} />),
    },
  ];

  const coverageColumns = [
    {
      key: 'agent', header: t('coverages.columns.agent'), width: 'minmax(0,1.2fr)',
      render: item => (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="font-semibold">{item.agentName}</strong>
          {item.isReinforcement
            && <OccStatusPill size="sm" tone={MARK_TONES.reinforcement} label={t('coverages.reinforcement')} />}
        </span>
      ),
    },
    {
      key: 'stands', header: t('coverages.columns.stands'), width: 'minmax(0,1fr)',
      render: item => (
        <span className="flex flex-wrap gap-1">
          {item.stands.map(stand => <OccPlate key={stand.standId} kind="stand">{stand.code}</OccPlate>)}
        </span>
      ),
    },
    {
      key: 'window', header: t('coverages.columns.window'), width: '7.5rem', mono: true,
      render: item => <span className="whitespace-nowrap">{shiftWindow(item.startsAt, item.endsAt, locale)}</span>,
    },
    {
      key: 'support', header: t('coverages.columns.support'), width: 'minmax(0,1fr)',
      render: item => (item.mentorName || item.vehicleCode ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {item.mentorName ? <span>{item.mentorName}</span> : null}
          {item.vehicleCode ? <OccPlate kind="code">{item.vehicleCode}</OccPlate> : null}
        </span>
      ) : <span className="text-occ-muted">—</span>),
    },
    ...(board.canAssign ? [{
      key: 'release', header: '', width: '6rem', align: 'end',
      render: item => <OccButton size="sm" onClick={() => void release(item)}>{t('coverages.release')}</OccButton>,
    }] : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <OccPanel title={t('board.title')} meta={meta} actions={standLegend}>
        <OccDataTable caption={t('board.title')} columns={standColumns} rows={stands} getRowId={stand => stand.standId} />
      </OccPanel>
      <OccPanel title={t('coverages.title')} meta={meta} actions={coverageLegend}>
        {error ? <div className="p-3 pb-0"><Reasons error={error} /></div> : null}
        <OccDataTable as="list" caption={t('coverages.title')} columns={coverageColumns} rows={coverages}
          emptyState={<OccEmptyState title={t('coverages.empty')} description={t('coverages.about')} />} />
      </OccPanel>
    </div>
  );
}

// A stand's row as the board has it now: a new version, a change here or in «Datos maestros», starts the row's draft
// and its intent again from the board.
const standSignature = stand => [stand.standId, stand.version, stand.hasBoardingBridge, stand.isRemote,
  stand.maxAircraftSize, stand.isActive].join('|');

/**
 * The attributes of the terminal's stands (2-A), one editable row each. The change carries the stand's version on the
 * board, the one «Datos maestros» shows, and the intent's key of that row: a retry after no answer replays the first
 * result. A stand changed meanwhile, here or in «Datos maestros», reads the board again; the row's error is kept by the
 * stand, so it survives that re-read.
 */
function StandAttributes({ stands, date, onChange, onStale }) {
  const { t } = useTranslation(coverageMessages);
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const intents = useRef(new Map());
  const draftOf = stand => drafts[standSignature(stand)] ?? stand;
  const edit = (stand, change) => {
    const signature = standSignature(stand);
    setDrafts(all => ({ ...all, [signature]: { ...(all[signature] ?? stand), ...change } }));
  };
  const intentOf = stand => {
    const signature = standSignature(stand);
    if (!intents.current.has(signature)) intents.current.set(signature, createCommandKeyHolder());
    return intents.current.get(signature);
  };
  const save = async stand => {
    const draft = draftOf(stand);
    setErrors(all => ({ ...all, [stand.standId]: null }));
    const attributes = { date, hasBoardingBridge: draft.hasBoardingBridge, isRemote: draft.isRemote,
      maxAircraftSize: draft.maxAircraftSize ?? null, isActive: draft.isActive, expectedVersion: stand.version };
    try {
      onChange(await intentOf(stand).run('stand-attributes', attributes,
        key => updateOccStandAttributes(stand.standId, attributes, key)));
    } catch (failure) {
      setErrors(all => ({ ...all, [stand.standId]: failure }));
      if (isConflict(failure)) onStale();
    }
  };
  const flag = (stand, key, label) => (
    <label className={FLAG}>
      <input type="checkbox" className={FLAG_BOX} checked={draftOf(stand)[key]}
        onChange={event => edit(stand, { [key]: event.target.checked })} />
      {label}
    </label>
  );

  const columns = [
    { key: 'stand', header: t('configuration.attributes.columns.stand'), width: '6rem', render: stand => <OccPlate kind="stand">{stand.code}</OccPlate> },
    {
      key: 'attributes', header: t('configuration.attributes.columns.attributes'), width: '18rem',
      render: stand => (
        <span className="flex flex-wrap items-center gap-x-4">
          {flag(stand, 'hasBoardingBridge', t('configuration.attributes.bridge'))}
          {flag(stand, 'isRemote', t('configuration.attributes.remote'))}
          {flag(stand, 'isActive', t('configuration.attributes.active'))}
        </span>
      ),
    },
    {
      key: 'size', header: t('configuration.attributes.columns.size'), width: '11rem',
      render: stand => (
        <select aria-label={t('configuration.attributes.size', { code: stand.code })}
          className={`${occControlClass({ kind: 'select' })} w-40`} value={draftOf(stand).maxAircraftSize ?? ''}
          onChange={event => edit(stand, { maxAircraftSize: event.target.value || null })}>
          <option value="">{t('configuration.attributes.anySize')}</option>
          {Object.entries(t('sizes')).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      ),
    },
    {
      key: 'change', header: '',
      render: stand => {
        const draft = draftOf(stand);
        const error = errors[stand.standId];
        return (
          <span className="flex flex-col items-start gap-1">
            {ATTRIBUTE_KEYS.some(key => draft[key] !== stand[key]) && (
              <OccButton size="sm" onClick={() => void save(stand)}>{t('configuration.attributes.save')}</OccButton>
            )}
            {error && (
              <span role="alert" className={ROW_ERROR}>
                <OccGlyph name="attention" className="mt-px" />
                <span className="min-w-0">{error.message}</span>
              </span>
            )}
          </span>
        );
      },
    },
  ];
  return <OccDataTable caption={t('configuration.attributes.title')} columns={columns} rows={stands} getRowId={stand => stand.standId} />;
}

/** OCC loads the real PUJ layout here: stand attributes, terminal limits and combined stands. */
function Configuration({ board, terminal, date, onChange, onStale }) {
  const { t } = useTranslation(coverageMessages);
  const access = useOptionalDepartmentAccess();
  const [max, setMax] = useState(String(terminal.maxStandsPerAgent));
  const [bridge, setBridge] = useState(terminal.requiresBridgeQualification);
  const [rule, setRule] = useState({ standId: '', kind: 'Cancels', affectedStandId: '' });
  const [error, setError] = useState(null);
  const stands = board.stands.filter(stand => stand.terminalId === terminal.terminalId);
  const kinds = t('kinds');
  const run = async action => { setError(null); try { onChange(await action()); } catch (failure) { setError(failure); } };
  const [linkBefore, linkAfter] = t('configuration.attributes.masterData').split('{link}');
  return (
    <div className={MASTER_DETAIL}>
      <OccPanel title={t('configuration.attributes.title')}>
        <div className="space-y-1 px-3 pt-3 text-xs text-occ-muted">
          <p>{t('configuration.attributes.hint')}</p>
          {access?.can('operations.master_data.read') && (
            <p>{linkBefore}<AppLink href="/admin-occ/master-data" className={LINK}>{t('configuration.attributes.masterDataLink')}</AppLink>{linkAfter}</p>
          )}
        </div>
        {/* A new version on the board (a change here or in «Datos maestros») starts the row again from it. */}
        <StandAttributes stands={stands} date={date} onChange={onChange} onStale={onStale} />
      </OccPanel>
      <div className="flex min-w-0 flex-col gap-3">
        <OccPanel title={t('configuration.rules.title')} meta={t('terminal', { code: terminal.code })}>
          <div className="flex flex-wrap items-end gap-3 p-3">
            <OccTextField type="number" label={t('configuration.rules.max')} className="w-56" min={1} max={6} value={max}
              onChange={event => setMax(event.target.value)} />
            <label className={CHECK}>
              <input type="checkbox" className={CHECKBOX} checked={bridge} onChange={event => setBridge(event.target.checked)} />
              {t('configuration.rules.bridge')}
            </label>
            <OccButton onClick={() => void run(() => updateOccTerminalRules(terminal.terminalId,
              { date, maxStandsPerAgent: Number(max), requiresBridgeQualification: bridge }))}>
              {t('configuration.rules.save')}
            </OccButton>
          </div>
        </OccPanel>
        <OccPanel title={t('configuration.combined.title')}>
          <div className="flex flex-col gap-3 p-3">
            <p className="text-xs text-occ-muted">{t('configuration.combined.hint')}</p>
            {board.constraints.length > 0 && (
              <ul className="divide-y divide-occ-line">
                {board.constraints.map(item => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <OccPlate kind="stand">{item.standCode}</OccPlate>
                      <span>{kinds[item.kind]}</span>
                      <OccPlate kind="stand">{item.affectedStandCode}</OccPlate>
                    </span>
                    <OccButton size="sm" onClick={() => void run(() => removeOccStandConstraint(item.id, date))}>
                      {t('configuration.combined.remove')}
                    </OccButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              {[['standId', t('configuration.combined.when')], ['affectedStandId', t('configuration.combined.then')]].map(([key, label]) => (
                <OccSelectField key={key} label={label} className="w-28" value={rule[key]}
                  onChange={event => setRule(value => ({ ...value, [key]: event.target.value }))}>
                  <option value="">{t('configuration.combined.none')}</option>
                  {board.stands.map(stand => <option key={stand.standId} value={stand.standId}>{stand.code}</option>)}
                </OccSelectField>
              ))}
              <OccSelectField label={t('configuration.combined.effect')} className="w-44" value={rule.kind}
                onChange={event => setRule(value => ({ ...value, kind: event.target.value }))}>
                <option value="Cancels">{t('configuration.combined.effects.Cancels')}</option>
                <option value="NarrowbodyOnly">{t('configuration.combined.effects.NarrowbodyOnly')}</option>
              </OccSelectField>
              <OccButton disabled={!rule.standId || !rule.affectedStandId || rule.standId === rule.affectedStandId}
                onClick={() => void run(() => addOccStandConstraint({ date, ...rule }))}>
                {t('configuration.combined.add')}
              </OccButton>
            </div>
          </div>
        </OccPanel>
        <Reasons error={error} />
      </div>
    </div>
  );
}

/**
 * «Cobertura de posiciones» (ADR-0030): which agent covers which stands during their shift, with
 * the rules OCC applies today (Pillier) checked by the API, and the stand configuration of PUJ.
 */
export default function CoverageRoute() {
  const { t } = useTranslation(coverageMessages);
  const station = useOccStation();
  const [date, setDate] = useState(() => stationDate());
  const [state, setState] = useState({ status: 'loading' });
  const [terminalCode, setTerminalCode] = useState('A');
  const [tab, setTab] = useState('coverage');
  const [attempt, setAttempt] = useState(0);
  const live = useRef(() => {});

  useEffect(() => {
    if (!station.stationId || !date) return undefined;
    const controller = new AbortController();
    const read = () => loadOccCoverage(station.stationId, date, { signal: controller.signal })
      .then(board => setState({ status: 'success', board }))
      .catch(error => {
        if (error?.name === 'AbortError') return;
        // Without access the view says so and offers no retry; another failure keeps the board on screen.
        setState(value => error?.status === 403 ? { status: 'forbidden' }
          : value.board ? value : { status: 'error', error });
      });
    live.current = read;
    void read();
    return () => controller.abort();
  }, [station.stationId, date, attempt]);

  // Another OCC seat, HR or the airport changes something: re-read under current permissions.
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('occ_planning')) void live.current();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, []);

  const board = state.board;
  const terminal = useMemo(() => board?.terminals.find(item => item.code === terminalCode) ?? board?.terminals[0],
    [board, terminalCode]);
  const onChange = useCallback(next => setState({ status: 'success', board: next }), []);
  // A refused change because the data moved meanwhile reads the board again before a new attempt.
  const onStale = useCallback(() => { void live.current(); }, []);

  // The read as one of the states of OccRemoteView: a station without terminals is an empty board.
  let view = 'success';
  if (state.status === 'loading') view = 'loading';
  else if (state.status === 'forbidden') view = 'forbidden';
  else if (state.status === 'error') view = 'error';
  else if (!terminal) view = 'empty';

  let body = null;
  if (view === 'success' && tab === 'configuration') {
    body = <Configuration key={`${terminal.terminalId}-${terminal.maxStandsPerAgent}-${terminal.requiresBridgeQualification}`}
      board={board} terminal={terminal} date={date} onChange={onChange} onStale={onStale} />;
  } else if (view === 'success') {
    body = (
      <div className={MASTER_DETAIL}>
        <CoverageBoard board={board} terminal={terminal} date={date} onChange={onChange} onStale={onStale} />
        {board.canAssign ? <CoverageForm key={terminal.terminalId} board={board} terminal={terminal} date={date} onDone={onChange}
          onStale={onStale} />
          : <p className={OCC_CLASSES.card}>{t('states.readOnly')}</p>}
      </div>
    );
  }

  const labels = {
    loading: t('states.loading'), forbidden: t('states.forbidden'), retry: t('states.retry'),
    // The service's own sentence (services/occCoverageService.js), never the server's title.
    error: state.error?.message || t('states.error'), empty: t('states.noTerminals'),
  };
  const views = [{ id: 'coverage', label: t('tabs.coverage') }];
  if (board?.canConfigure) views.push({ id: 'configuration', label: t('tabs.configuration') });

  // The station is in the status bar of the OCC frame: the page has no badge of its own, nor a line under its title.
  // The terminal and the view sit on the toolbar's line, after the date, so no line is left half empty.
  return (
    <section className="flex min-w-0 flex-col gap-3 text-occ-text">
      <OccToolbar title={t('title')}>
        <OccTextField type="date" label={t('date')} className="w-44" value={date} onChange={event => setDate(event.target.value)} />
        {station.stationId && board ? (
          <nav aria-label={t('nav.label')} className="flex flex-wrap items-end gap-x-4 gap-y-2">
            {board.terminals.length > 0 && (
              <OccSegmented label={t('nav.terminal')} value={terminal?.terminalId}
                onChange={id => setTerminalCode(board.terminals.find(item => item.terminalId === id)?.code ?? terminalCode)}
                options={board.terminals.map(item => ({ id: item.terminalId, label: t('terminal', { code: item.code }) }))} />
            )}
            <OccSegmented label={t('nav.view')} value={tab} onChange={setTab} options={views} />
          </nav>
        ) : null}
      </OccToolbar>
      {!station.stationId ? <p role="alert" className={OCC_CLASSES.card}>{t('states.noStation')}</p> : (
        <OccRemoteView status={view} labels={labels} onRetry={() => setAttempt(value => value + 1)}
          className={view === 'success' ? 'min-w-0' : STATE_SLAB}>
          {body}
        </OccRemoteView>
      )}
    </section>
  );
}
