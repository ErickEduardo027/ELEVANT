import { useRouter } from 'next/navigation';
import { ROLES, resolveHomeRouteForRole } from './roleRouting';

const ENVIRONMENTS = [
  { role: ROLES.ADMIN_OCC, label: 'Administrador / OCC' },
  { role: ROLES.GESTION_HUMANA, label: 'Gestión Humana' },
  { role: ROLES.CONTRATOS, label: 'Contratos' },
  { role: ROLES.FINANZAS, label: 'Finanzas' },
  { role: ROLES.AGENTE, label: 'Agente' },
  { role: ROLES.CLIENTE_AEROLINEA, label: 'Cliente / Aerolínea' },
];

// Reemplaza temporalmente la redirección automática por rol: hoy no hay
// backend que devuelva el rol autenticado (ver roleRouting.js). Cuando lo
// haya, esta pantalla se retira y LoginPage navega directo con
// resolveHomeRouteForRole(role) del usuario real.
export default function EnvironmentSelectorPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-light p-6 dark:bg-surface-dark">
      <div className="w-full max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">
          Elige tu entorno
        </h1>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ENVIRONMENTS.map(env => {
            const path = resolveHomeRouteForRole(env.role);
            return (
              <button
                key={env.role}
                type="button"
                disabled={!path}
                onClick={() => path && router.push(path)}
                className="rounded-2xl border border-black/10 bg-white/70 p-4 text-left text-sm font-medium text-text-primary-light backdrop-blur-md hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark dark:hover:bg-white/5"
              >
                {env.label}
                {!path && <span className="ml-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">(Próximamente)</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
