'use client';

import { useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import PlanningDrawer from '../../planning/components/PlanningDrawer';
import { isInitialAssignmentCandidate } from '../../planning/planningMappers';
import { planningMessages } from '../../planning/planningMessages';
import { usePlanningAssignment } from '../../planning/usePlanningAssignment';
import { usePlanningOptions } from '../../planning/usePlanningOptions';
import { consoleMessages } from './consoleMessages';

const EMPTY_OPTIONS_STATE = Object.freeze({
  status: 'idle', data: null, etag: null, error: null, reason: null, recoverable: false,
});

/**
 * «Asignar agente» over the console (contratos 2.5): the planning drawer of one flight of the station's day
 * (planning/components/PlanningDrawer.jsx), with its options and its assignment as Planificación wires them
 * (usePlanningOptions, usePlanningAssignment and its assignPlanningOperation), so OCC assigns without leaving the map.
 * - `flight` is the planning flight (planning/planningMappers.js, with the readiness marks) or null: closed.
 * - After an assignment the drawer closes, `onChanged()` re-reads what the assignment changed and `showToast` says
 *   «Operación asignada a {agente}.»; an answer that needs a fresh read (a 409, an uncertain result) closes the drawer and
 *   re-reads before a new intent; any other refusal says its message in a toast and keeps the drawer open.
 * - The other commands of the drawer (release, hand-over, shift, a stale version) re-read the same way.
 * - `dataRevision` is what the drawer reads again with (its options, the operation's incidents and relieved agents): the
 *   console's own changes, never the safety poll of its planning, so the list of agents never empties while OCC picks.
 */
export default function ConsoleAssignDrawer({ flight, onClose, onChanged, showToast, dataRevision = 0 }) {
  const { t } = useTranslation(planningMessages);
  const { t: tConsole } = useTranslation(consoleMessages);
  const assignment = usePlanningAssignment();
  const [optionsRetry, setOptionsRetry] = useState(0);
  const planningOptions = usePlanningOptions({
    turnaroundId: flight?.turnaroundId,
    refreshToken: optionsRetry + dataRevision,
    enabled: isInitialAssignmentCandidate(flight),
  });

  function close() {
    assignment.reset();
    onClose?.();
  }

  function changed() {
    assignment.reset();
    setOptionsRetry(value => value + 1);
    onChanged?.();
  }

  async function assign(agentId) {
    if (!flight || !planningOptions.etag) return;
    const agent = planningOptions.data?.agents.find(item => item.id === agentId);
    const outcome = await assignment.assign({ turnaroundId: flight.turnaroundId, agentId, etag: planningOptions.etag });
    if (outcome.detached) return;
    if (outcome.ok) {
      assignment.reset();
      onClose?.();
      onChanged?.();
      showToast?.(t('page.assigned', { agent: agent?.displayName ?? t('page.selectedAgent') }), 'success');
      return;
    }
    if (outcome.refreshRequired) {
      assignment.reset();
      onClose?.();
      onChanged?.();
    }
    if (outcome.error?.message) showToast?.(outcome.error.message, 'danger', 6500);
  }

  return (
    <PlanningDrawer
      flight={flight}
      dataRevision={dataRevision}
      onClose={close}
      optionsState={flight ? planningOptions : EMPTY_OPTIONS_STATE}
      assignmentState={assignment}
      onAssign={assign}
      onRetryOptions={() => setOptionsRetry(value => value + 1)}
      onShiftProgrammed={kind => {
        assignment.reset();
        setOptionsRetry(value => value + 1);
        showToast?.(t(kind === 'adjusted' ? 'page.shiftAdjusted' : 'page.shiftProgrammed'), 'success');
      }}
      onAgentReleased={() => {
        changed();
        showToast?.(tConsole('assign.agentReleased'), 'success');
      }}
      onAgentHandedOver={name => {
        changed();
        showToast?.(t('drawer.handoverDone', { name }), 'success');
      }}
      onStale={changed}
    />
  );
}
