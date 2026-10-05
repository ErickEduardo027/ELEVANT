import { useState } from 'react';

export default function RampMobileAccessInbox({ requests, profiles, roleId,
  onApprove, onReject }) {
  const pending = requests.filter(item => item.status === 'Pending');
  return <section className="rounded-2xl border border-black/5 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card">
    <h2 className="text-xl font-bold">Acceso móvil solicitado por Gestión Humana</h2>
    <p className="mt-1 text-sm text-text-secondary-light">Revise el perfil y sus estaciones antes de crear la cuenta. Entregue las credenciales temporalmente por un canal manual autorizado.</p>
    {pending.length === 0 ? <p className="mt-4 rounded-xl bg-black/[.035] p-4 text-sm dark:bg-white/[.04]">No hay solicitudes móviles pendientes.</p> :
      <div className="mt-4 grid gap-4 lg:grid-cols-2">{pending.map(request => {
        const profile = profiles.find(item => item.id === request.rampProfileId);
        return <RampMobileAccessCard key={request.id} request={request} profile={profile}
          roleId={roleId} onApprove={onApprove} onReject={onReject} />;
      })}</div>}
  </section>;
}

function RampMobileAccessCard({ request, profile, roleId, onApprove, onReject }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const words = (profile?.name ?? '').trim().split(/\s+/);
  const firstName = profile?.firstName ?? words[0] ?? '';
  const lastName = profile?.lastName ?? words.slice(1).join(' ');
  const eligible = Boolean(roleId && profile && !profile.accountId && profile.stations?.length &&
    profile.version && request.version);
  async function approve(event) {
    event.preventDefault();
    if (!eligible) return;
    setBusy(true);
    try {
      const saved = await onApprove({ firstName, lastName, email, roleId,
        temporaryPassword: password, rampAgentId: request.rampProfileId,
        accessRequestId: request.id, accessRequestVersion: request.version,
        expectedRampProfileVersion: profile.version,
        expectedStationCodes: profile.stations });
      if (saved) setPassword('');
    } finally { setBusy(false); }
  }
  async function reject() {
    if (!reason.trim()) return;
    setBusy(true);
    try { await onReject(request.id, reason.trim(), request.version); }
    finally { setBusy(false); }
  }
  return <div className="rounded-xl border border-accent-600/20 bg-accent-600/[.035] p-5">
    <strong>{profile?.name ?? 'Perfil no disponible'}</strong>
    <p className="mt-1 text-xs text-text-secondary-light">{profile?.employeeNumber ?? ''} · {profile?.stations?.join(', ') || 'Sin estación vigente'}</p>
    {!eligible && <p className="mt-2 text-sm text-status-danger">El perfil ya no es elegible. Actualice la bandeja antes de decidir.</p>}
    <form onSubmit={approve} className="mt-4 space-y-3">
      <label className="block text-xs font-semibold">Correo de acceso móvil<input type="email" required maxLength={256} value={email} onChange={event => setEmail(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
      <label className="block text-xs font-semibold">Contraseña temporal móvil<input type="password" required minLength={14} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
      <button disabled={!eligible || busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Aprobar y crear cuenta</button>
    </form>
    <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/10">
      <label className="block text-xs font-semibold">Motivo de rechazo<textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
      <button type="button" disabled={busy || !reason.trim() || !request.version} onClick={reject} className="mt-2 rounded-lg border border-status-danger/40 px-4 py-2 text-sm font-semibold text-status-danger disabled:opacity-50">Rechazar solicitud</button>
    </div>
  </div>;
}
