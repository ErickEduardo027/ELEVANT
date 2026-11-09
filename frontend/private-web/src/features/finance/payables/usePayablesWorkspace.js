'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readSession } from '../../auth/authService';
import { payablesOptions } from '../../../services/financePayablesService';
import { newRequestId } from '../../../services/financeBookService';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { isUncertain, needsReload, payablesError } from './payablesProblemMessages';

export { payablesError };
export function usePayablesWorkspace(kind, list, get, enabled) {
  const [stations, setStations] = useState([]); const [scope, setScope] = useState(''); const [session, setSession] = useState(null);
  const [filter, setFilter] = useState({ search: '', status: '', from: '', to: '', skip: 0, take: 25 });
  const [rows, setRows] = useState([]); const [options, setOptions] = useState(null); const [detail, setDetail] = useState(null);
  const [changed, setChanged] = useState(false);
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState('');
  const selected = useRef(null); const generation = useRef(0); const detailGeneration = useRef(0);
  useEffect(() => { let active = true; Promise.resolve().then(readSession).then(snapshot => { if (!active) return; setSession(snapshot); const scopes = snapshot?.stationScopes ?? []; setStations(scopes); setScope(scopes[0]?.stationId ?? ''); }); return () => { active = false; }; }, []);
  const open = useCallback(async id => {
    selected.current = id; const current = ++detailGeneration.current; setDetail(null); setDetailLoading(true); setError('');
    try { const data = await get(id); if (current === detailGeneration.current) setDetail(data); }
    catch (e) { if (current === detailGeneration.current) setError(payablesError(e)); }
    finally { if (current === detailGeneration.current) setDetailLoading(false); }
  }, [get]);
  const refresh = useCallback(async () => {
    if (!enabled || !scope) { setLoading(false); return; }
    const current = ++generation.current; setLoading(true); setError('');
    try {
      const [data, choices] = await Promise.all([list({ ...filter, scopeStationId: scope }), payablesOptions(kind, scope)]);
      if (current !== generation.current) return;
      setRows(data); setOptions(choices); setChanged(false); if (selected.current) await open(selected.current);
    } catch (e) { if (current === generation.current) { setError(payablesError(e)); setRows([]); setDetail(null); } }
    finally { if (current === generation.current) setLoading(false); }
  }, [enabled, scope, filter, list, kind, open]);
  useEffect(() => { let active = true; const invalidate = () => { generation.current++; detailGeneration.current++; }; Promise.resolve().then(() => { if (active) { selected.current = null; setDetail(null); void refresh(); } }); return () => { active = false; invalidate(); }; }, [refresh]);
  useEffect(() => {
    if (!enabled || process.env.NODE_ENV === 'test') return undefined;
    const resources = kind === 'expenses' ? ['finance_expenses', 'finance_receipts'] : ['finance_payables', 'finance_receipts'];
    const observer = createPrivateWebAccountChangeObserver(changes => { if (changes.some(resource => resources.includes(resource))) setChanged(true); });
    void observer.start(); return () => { void observer.stop(); };
  }, [enabled, kind]);
  const changeScope = value => { selected.current = null; setDetail(null); setOptions(null); setRows([]); setScope(value); setFilter(f => ({ ...f, skip: 0 })); };
  return { stations, scope, session, changed, filter, setFilter, rows, options, detail, setDetail, loading, detailLoading, error, refresh, open, changeScope };
}
/**
 * One command of the module: the body carries its `requestId`. The same id is kept only while the user retries the same
 * operation and values after an uncertain result (no answer, or a 5xx); any other answer settles the intent (4-N27).
 * The screen re-reads the document only when it changed or moved to another status, so a correctable refusal (a
 * duplicate reference, a missing reason…) keeps the form open as it was.
 */
export function usePayablesMutation(refresh) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [retry, setRetry] = useState(null);
  const keys = useRef(null); const locked = useRef(false);
  const currentRefresh = useRef(refresh);
  useEffect(() => { currentRefresh.current = refresh; }, [refresh]);
  const run = async (operation, values, send) => {
    if (locked.current) return false; locked.current = true; setBusy(true); setError(''); setSuccess(''); setRetry(null);
    keys.current ??= createCommandKeyHolder(newRequestId);
    const body = structuredClone(values);
    try {
      // A retry sends the original command, then reconciles the station and filters now on screen.
      await keys.current.run(operation, body, requestId => send({ ...body, requestId }));
      setSuccess('Operación guardada.'); await currentRefresh.current(); return true;
    } catch (e) {
      setError(payablesError(e));
      if (needsReload(e)) await currentRefresh.current();
      else if (isUncertain(e)) setRetry(() => () => run(operation, values, send));
      return false;
    } finally { locked.current = false; setBusy(false); }
  };
  return { busy, error, success, retry, run };
}
