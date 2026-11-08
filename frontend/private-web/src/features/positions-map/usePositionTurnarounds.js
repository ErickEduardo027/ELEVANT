import { useCallback, useEffect, useMemo, useState } from 'react';
import { getTurnaround } from '../../services/planningService';
import { loadOccMasterData } from '../../services/occMasterDataService';

/**
 * The version of each flight the positions map changes (3-N10): its turnaround detail with the strong ETag the next
 * command sends in If-Match, the station's IANA zone and the changes its state allows (`correctArrival`). Only a
 * flight read now (`success`) takes commands: one being read is `loading` (first read) or `refreshing` (it keeps the
 * version it had), and one that could not be read is `forbidden` (403) or `error` (with the `error` to explain). No
 * command is sent without its version. `reload` re-reads every flight, for example after a command, a 409/412 or
 * «Reintentar».
 *
 * @param {string[]} turnaroundIds
 */
export function usePositionTurnarounds(turnaroundIds) {
  const key = [...new Set(turnaroundIds.filter(Boolean))].sort().join('|');
  // Each answer is tagged with the read it answers.
  const [answers, setAnswers] = useState({});
  const [token, setToken] = useState(0);
  const request = `${key}#${token}`;

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    const answering = `${key}#${token}`;
    for (const id of key.split('|')) {
      getTurnaround(id, { signal: controller.signal })
        .then(value => {
          if (controller.signal.aborted) return;
          setAnswers(current => ({ ...current,
            [id]: { request: answering, status: 'success', detail: value.turnaround, etag: value.etag } }));
        })
        .catch(error => {
          if (controller.signal.aborted || error?.name === 'AbortError') return;
          setAnswers(current => ({ ...current, [id]: { request: answering,
            status: error?.status === 403 ? 'forbidden' : 'error', detail: null, etag: null, error } }));
        });
    }
    return () => controller.abort();
  }, [key, token]);

  const reload = useCallback(() => setToken(value => value + 1), []);
  const versions = useMemo(() => Object.fromEntries((key ? key.split('|') : []).map(id => {
    const answer = answers[id];
    if (!answer) return [id, { status: 'loading', detail: null, etag: null }];
    const { request: answered, ...version } = answer;
    return [id, answered === request ? version : { ...version, status: version.detail ? 'refreshing' : 'loading' }];
  })), [answers, key, request]);
  return { versions, reload };
}

const NO_TYPES = Object.freeze({ status: 'idle', types: [] });
const LOADING_TYPES = Object.freeze({ status: 'loading', types: [] });

/**
 * The active aircraft types OCC may give a flight on arrival (3-B), from the station's master data (2-A). Without that
 * catalog (no permission, a failure) the type is simply not offered and the arrival is recorded without it.
 *
 * @param {string | null} stationId
 * @param {boolean} enabled read only when a form needs it
 */
export function useArrivalAircraftTypes(stationId, enabled) {
  const [catalog, setCatalog] = useState({ stationId: null, status: 'idle', types: [] });
  useEffect(() => {
    if (!enabled || !stationId) return undefined;
    const controller = new AbortController();
    loadOccMasterData(stationId, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        const types = (data?.aircraftTypes ?? []).filter(type => type.isActive)
          .sort((left, right) => `${left.manufacturer} ${left.model}`.localeCompare(`${right.manufacturer} ${right.model}`, 'es'));
        setCatalog({ stationId, status: 'success', types });
      })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setCatalog({ stationId, status: 'unavailable', types: [] });
      });
    return () => controller.abort();
  }, [stationId, enabled]);
  // The station's catalog is kept while it is read again; another station's is never offered.
  if (stationId && catalog.stationId === stationId) return catalog;
  return enabled && stationId ? LOADING_TYPES : NO_TYPES;
}
