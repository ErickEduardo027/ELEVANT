import { useEffect, useMemo, useState } from 'react';
import Sidebar from '../shell/components/Sidebar';
import ModulePlaceholder from '../shell/components/ModulePlaceholder';
import Topbar from '../dashboard/components/Topbar';
import { usePreviewControls } from '../dashboard/usePreviewControls';
import { useResponsiveSidebar } from '../shell/useResponsiveSidebar';
import { CURRENT_USER_MOCK, HUMAN_RESOURCES_DASHBOARD_MOCK } from './mockData';
import { HUMAN_RESOURCES_MODULE_IDS, HUMAN_RESOURCES_NAVIGATION } from './navigation';
import useNotificationBadge from '../notifications/useNotificationBadge';
import RampProfilesPanel from './users/RampProfilesPanel';

function stationSnapshot() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}

function badgeCountsFromNavigation(navigation) {
  return Object.fromEntries(
    navigation
      .filter(item => typeof item.badge?.count === 'number')
      .map(item => [item.id, item.badge.count])
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-ink-900 dark:text-text-primary-dark">{value}</div>
      {hint && <div className="mt-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">{hint}</div>}
    </div>
  );
}

export default function HumanResourcesShell({ user = CURRENT_USER_MOCK, onLogout }) {
  const [activeModuleId, setActiveModuleId] = useState(HUMAN_RESOURCES_MODULE_IDS.DASHBOARD);
  const { theme, toggleTheme } = usePreviewControls();
  const sidebar = useResponsiveSidebar();
  const notifications = useNotificationBadge();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const activeModule = useMemo(
    () => HUMAN_RESOURCES_NAVIGATION.find(module => module.id === activeModuleId) ?? HUMAN_RESOURCES_NAVIGATION[0],
    [activeModuleId]
  );

  function handleSelectModule(id) {
    setActiveModuleId(id);
    sidebar.closeOverlay();
  }

  const badgeCounts = badgeCountsFromNavigation(HUMAN_RESOURCES_NAVIGATION);

  return (
    <div className="flex min-h-screen bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark">
      <Sidebar
        modules={HUMAN_RESOURCES_NAVIGATION}
        activeModuleId={activeModuleId}
        onSelectModule={handleSelectModule}
        badgeCounts={badgeCounts}
        user={user}
        onLogout={onLogout}
        breakpoint={sidebar.breakpoint}
        railVisible={sidebar.railVisible}
        railExpanded={sidebar.railExpanded}
        overlayOpen={sidebar.overlayOpen}
        onToggle={sidebar.toggle}
        onCloseOverlay={sidebar.closeOverlay}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          station={stationSnapshot()}
          notificationsCount={notifications.count}
          theme={theme}
          onToggleTheme={toggleTheme}
          user={user}
          onOpenMenu={sidebar.toggle}
          onOpenNotifications={() => handleSelectModule(HUMAN_RESOURCES_MODULE_IDS.NOTIFICATIONS)}
          onLogout={onLogout}
        />

        <main className="min-w-0 flex-1 overflow-y-auto p-4 [animation:elevant-fade-in_180ms_ease-out] sm:p-6">
          {activeModule.id === HUMAN_RESOURCES_MODULE_IDS.DASHBOARD ? (
            <div className="mx-auto max-w-[1440px] space-y-4">
              <header className="rounded-2xl border border-black/5 bg-white/70 p-5 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión Humana</p>
                <h1 className="mt-1 text-2xl font-bold">Dashboard</h1>
                <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
                  Resumen del personal, accesos y seguimiento operativo.
                </p>
              </header>

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Personal activo" value={HUMAN_RESOURCES_DASHBOARD_MOCK.activeStaffTotal} hint="Por terminal y turno" />
                <StatCard label="Cuentas pendientes" value={HUMAN_RESOURCES_DASHBOARD_MOCK.pendingAccounts} hint="Invitaciones y activaciones" />
                <StatCard label="Vencimientos próximos" value={HUMAN_RESOURCES_DASHBOARD_MOCK.expiringSoon} hint="Certificaciones y permisos" />
                <StatCard label="Alertas abiertas" value={HUMAN_RESOURCES_DASHBOARD_MOCK.unreadNotifications} hint="Notificaciones sin leer" />
              </section>

              <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                <div className="rounded-2xl border border-black/5 bg-white/70 p-5 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
                  <h2 className="font-semibold">Distribución por terminal</h2>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <StatCard label="Terminal A" value={HUMAN_RESOURCES_DASHBOARD_MOCK.byTerminal.terminalA} />
                    <StatCard label="Terminal B" value={HUMAN_RESOURCES_DASHBOARD_MOCK.byTerminal.terminalB} />
                    <StatCard label="FBO" value={HUMAN_RESOURCES_DASHBOARD_MOCK.byTerminal.fbo} />
                  </div>
                </div>

                <div className="rounded-2xl border border-black/5 bg-white/70 p-5 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
                  <h2 className="font-semibold">Cobertura por turno</h2>
                  <ul className="mt-4 space-y-3 text-sm">
                    <li className="flex items-center justify-between">
                      <span>Mañana</span>
                      <strong>{HUMAN_RESOURCES_DASHBOARD_MOCK.byShift.morning}</strong>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Tarde</span>
                      <strong>{HUMAN_RESOURCES_DASHBOARD_MOCK.byShift.afternoon}</strong>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Noche</span>
                      <strong>{HUMAN_RESOURCES_DASHBOARD_MOCK.byShift.night}</strong>
                    </li>
                  </ul>
                </div>
              </section>
            </div>
          ) : activeModule.id === HUMAN_RESOURCES_MODULE_IDS.USERS ? <RampProfilesPanel /> : (
            <ModulePlaceholder
              icon={activeModule.icon}
              label={activeModule.label}
              description={activeModule.description}
            />
          )}
        </main>
      </div>
    </div>
  );
}
