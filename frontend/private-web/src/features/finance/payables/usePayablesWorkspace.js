'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readSession } from '../../auth/authService';
import { payablesOptions } from '../../../services/financePayablesService';
import { newRequestId } from '../../../services/financeBookService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';

export function payablesError(error) {
  if (error?.status === 403) return 'No tiene permiso para realizar esta acción.';
  if (error?.status === 401) return 'La sesión expiró. Vuelva a iniciar sesión.';
  if (error?.status === 409) return 'El documento, su versión o el saldo cambió. Revise los datos actualizados antes de continuar.';
  if (error?.status === 404) return 'El documento ya no está disponible en su ámbito.';
  if (error?.status === 400) return 'Revise los campos, la tasa de cambio y los comprobantes requeridos.';
  return 'No se pudo conectar o completar la operación. Intente de nuevo.';
}
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
export function usePayablesMutation(refresh) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [retry, setRetry] = useState(null);
  const pending = useRef(null); const locked = useRef(false);
  const currentRefresh = useRef(refresh);
  useEffect(() => { currentRefresh.current = refresh; }, [refresh]);
  const execute = async command => {
    if (locked.current) return false; locked.current = true; setBusy(true); setError(''); setSuccess(''); setRetry(null);
    try {
      // Retry the original command, then reconcile the station and filters now on screen.
      await command.send(command.body); pending.current = null; setSuccess('Operación guardada.'); await currentRefresh.current(); return true;
    } catch (e) {
      setError(payablesError(e));
      if (e?.status === 409) { pending.current = null; await currentRefresh.current(); }
      else if (![400, 401, 403, 404].includes(e?.status)) setRetry(() => () => execute(command));
      return false;
    } finally { locked.current = false; setBusy(false); }
  };
  const run = (operation, values, send) => {
    const fingerprint = JSON.stringify({ operation, values });
    const requestId = pending.current?.fingerprint === fingerprint ? pending.current.body.requestId : newRequestId();
    const command = { fingerprint, body: { ...structuredClone(values), requestId }, send };
    pending.current = command; return execute(command);
  };
  return { busy, error, success, retry, run };
}
