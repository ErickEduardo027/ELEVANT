import { useRef, useState } from 'react';

function focusTarget(source) {
  const element = source?.returnFocusTo ?? source?.currentTarget ?? document.activeElement;
  const menu = element?.closest?.('[role="menu"]');
  return menu?.parentElement?.querySelector('button[aria-haspopup="menu"]') ?? element;
}

export function useLogoutConfirmation(session, logout) {
  const scope = session ? `${session.accountId ?? session.email}|${session.token}` : null;
  const [state, setState] = useState({ scope, open: false, busy: false, error: false });
  const pending = useRef(null);
  const trigger = useRef(null);
  const open = Boolean(session && state.scope === scope && state.open);
  if (state.scope !== scope) setState({ scope, open: false, busy: false, error: false });

  function request(source) {
    if (!session || pending.current?.scope === scope) return;
    trigger.current = focusTarget(source);
    setState({ scope, open: true, busy: false, error: false });
  }

  function dismiss() {
    if (pending.current?.scope === scope) return;
    setState(previous => ({ ...previous, open: false, error: false }));
    const target = trigger.current;
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus?.({ preventScroll: true });
    });
  }

  async function confirm() {
    if (!open || pending.current?.scope === scope) return;
    const attemptScope = scope;
    const attempt = { scope: attemptScope };
    pending.current = attempt;
    setState(previous => ({ ...previous, busy: true, error: false }));
    try {
      await logout();
      setState(previous => previous.scope === attemptScope
        ? { ...previous, open: false, busy: false } : previous);
    } catch {
      setState(previous => previous.scope === attemptScope
        ? { ...previous, busy: false, error: true } : previous);
    } finally {
      if (pending.current === attempt) pending.current = null;
    }
  }

  return { open, busy: open && state.busy, error: open && state.error, request, dismiss, confirm };
}
