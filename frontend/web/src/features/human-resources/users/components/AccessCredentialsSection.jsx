import { MailIcon } from '../../../shell/components/icons';

// skill.md §11 — NUNCA se pide ni se muestra una contraseña desde este
// frontend. La única vía de credenciales soportada es la invitación por
// correo; el mecanismo real de activación lo define el backend.
export default function AccessCredentialsSection({ portalLabel, mode }) {
  return (
    <div className="space-y-3 rounded-xl border border-black/10 p-3 dark:border-white/10">
      <div className="flex items-center gap-2">
        <MailIcon className="h-4 w-4 text-accent-600" />
        <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">
          {mode === 'create' ? 'Enviar invitación por correo' : 'Invitación por correo'}
        </p>
      </div>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        El usuario establecerá su contraseña mediante el proceso seguro de activación. ELEVANT no solicita ni
        almacena contraseñas desde este formulario.
      </p>
      <div className="flex items-center justify-between rounded-lg bg-black/5 px-3 py-2 text-xs dark:bg-white/5">
        <span className="text-text-secondary-light dark:text-text-secondary-dark">Portal de acceso</span>
        <span className="font-medium text-ink-900 dark:text-text-primary-dark">{portalLabel ?? '—'}</span>
      </div>
    </div>
  );
}
