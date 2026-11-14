'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { occMapService } from '../../../services/occMapService';
import { useOccBoot } from '../../admin-occ/boot/occBootContext';
import { useOccStation } from '../../admin-occ/useOccStation';
import { useAuth } from '../../auth/AuthContext';
import { useMapSelection } from '../../maps/core/useMapSelection';
import { useStandDisplay } from '../../maps/stands/useStandDisplay';
import { useMapSituation } from '../../maps/useMapSituation';
import { useMdpcWeather } from '../../weather/useMdpcWeather';
import { consoleMessages } from './consoleMessages';
import { flightsByTurnaroundOf } from './standTimeline';
import { CONSOLE_SERVICES, useConsoleData } from './useConsoleData';

const NO_STANDS = Object.freeze([]);
const HEX = /^[0-9a-f]{6}$/i;

function ConsoleLoading() {
  const { t } = useTranslation(consoleMessages);
  return <div role="status" className="p-6 text-sm text-occ-muted">{t('states.loading')}</div>;
}

// The console's view (ConsolePage.jsx: the full-bleed map and its panels) carries the map engine: client only, in its
// own chunk, as the positions map is. This route stays in the page's chunk and starts the console's reads at once, so
// the view's code and its first data load side by side instead of one after the other.
const ConsoleView = dynamic(() => import('./ConsolePage'), { ssr: false, loading: ConsoleLoading });

/**
 * The route of Panorama (/admin-occ/dashboard): the OCC console of contratos 2.5. It composes, and draws nothing of its
 * own but the notice of a missing station and the status while the view's code loads:
 * - the session's PUJ scope (useOccStation: the OCC operates Punta Cana only, with no station selector) and the URL
 *   selection (useMapSelection);
 * - the map situation, read once for the map, the board and the inspector (useMapSituation over `mapService`);
 * - the console's own reads (useConsoleData over `services`), today's weather (useMdpcWeather) and the stands as the
 *   map draws them (useStandDisplay over the positions board and the map flights).
 * Without the PUJ scope nothing is read and the console says so (`role="alert"`). The OCC boot screen leaves once the
 * view is on screen and the map flights stopped loading (the console's first data), or at once when the station is
 * missing (contratos 2.6).
 */
export default function ConsoleRoute({ mapService = occMapService, services = CONSOLE_SERVICES }) {
  const { session } = useAuth();
  const station = useOccStation();
  const { t } = useTranslation(consoleMessages);
  const selection = useMapSelection();
  const ready = station.status === 'ready';
  const stationId = ready ? station.stationId : null;
  const chosen = selection.selection;
  const selectedHex = chosen?.kind === 'aircraft' && HEX.test(chosen.id) ? chosen.id : null;

  const live = useMapSituation({ stationId, enabled: ready, service: mapService, selection: chosen, selectedHex });
  const data = useConsoleData({ accountId: session?.accountId, stationId: stationId ?? '',
    stationCode: ready ? station.stationCode : '', services });
  // The weather is read only with the PUJ scope.
  const weather = useMdpcWeather({ enabled: ready });
  const flightsByTurnaround = flightsByTurnaroundOf(live.flights?.flights);
  const stands = useStandDisplay(data.positions.data?.stands ?? NO_STANDS, { flightsByTurnaround });
  const stationScope = useMemo(() => ({ stationId: stationId ?? '', stationCode: station.stationCode }),
    [station.stationCode, stationId]);

  // Contratos 2.6: the boot screen waits for the console's first data, or for a state that needs the person.
  const { markReady } = useOccBoot();
  const [viewShown, setViewShown] = useState(false);
  const showView = useCallback(() => setViewShown(true), []);
  const firstData = live.flights !== null || live.status === 'error' || live.status === 'unauthorized';
  useEffect(() => {
    if (!ready || (viewShown && firstData)) markReady('console');
  }, [firstData, markReady, ready, viewShown]);

  if (!ready) {
    return (
      <div className="p-4">
        <h1 className="sr-only">{t('title')}</h1>
        <div role="alert" className="rounded-md border border-occ-line-strong bg-occ-panel p-4 text-sm text-occ-text">
          {t('states.unavailable')}
        </div>
      </div>
    );
  }

  return (
    <ConsoleView station={stationScope} live={live} data={data} stands={stands} weather={weather}
      selection={selection} onShown={showView} />
  );
}
