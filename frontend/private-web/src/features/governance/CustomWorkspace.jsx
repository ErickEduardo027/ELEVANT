import { useEffect, useState } from 'react';
import Sidebar from '../shell/components/Sidebar';
import Topbar from '../dashboard/components/Topbar';
import { LayoutGridIcon, ShieldCheckIcon } from '../shell/components/icons';
import { useResponsiveSidebar } from '../shell/useResponsiveSidebar';
import { usePreviewControls } from '../dashboard/usePreviewControls';
import CommercialCatalogPage from '../contracts/catalog/CommercialCatalogPage';
import CommercialIntakePage from '../contracts/requests/CommercialIntakePage';
import ManagedDraftsPage from '../contracts/drafts/ManagedDraftsPage';
import { getMyPermissions } from '../../services/commercialGovernanceApi';

const workspaceModules = [
  { id: 'catalog', label: 'Servicios', permission: 'commercial.catalog.read', icon: LayoutGridIcon,
    description: 'Oferta de servicios AVIAM.' },
  { id: 'requests', label: 'Solicitudes', permission: 'commercial.requests.read', icon: ShieldCheckIcon,
    description: 'Solicitudes de aerolíneas.' },
  { id: 'drafts', label: 'Borradores', permission: 'commercial.requests.read', icon: ShieldCheckIcon,
    description: 'Contratos pendientes de activación.' },
];

export default function CustomWorkspace({ user, onLogout }) {
  const [permissions, setPermissions] = useState(null);
  const [error, setError] = useState('');
  const [moduleId, setModuleId] = useState(null);
  const sidebar = useResponsiveSidebar();
  const { theme, toggleTheme } = usePreviewControls();
  useEffect(() => {
    let active = true;
    getMyPermissions().then(result => { if (active) setPermissions(result); })
      .catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);
  const modules = workspaceModules.filter(item => permissions?.includes(item.permission));
  const selected = modules.find(item => item.id === moduleId) ?? modules[0];
  const station = { code: 'AVIAM', localAbbr: 'AST',
    localTime: new Date().toISOString(), utcTime: new Date().toISOString() };
  return <div className="flex min-h-screen bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark">
    <Sidebar modules={modules} activeModuleId={selected?.id} onSelectModule={id => { setModuleId(id); sidebar.closeOverlay(); }}
      user={user} onLogout={onLogout} breakpoint={sidebar.breakpoint} railVisible={sidebar.railVisible}
      railExpanded={sidebar.railExpanded} overlayOpen={sidebar.overlayOpen} onToggle={sidebar.toggle}
      onCloseOverlay={sidebar.closeOverlay} />
    <div className="flex min-w-0 flex-1 flex-col">
      <Topbar station={station} notificationsEnabled={false} theme={theme} onToggleTheme={toggleTheme}
        user={user} onOpenMenu={sidebar.toggle} onLogout={onLogout} />
      <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-4 text-sm">{error}</p>}
        {!permissions && !error && <p className="p-4 text-sm">Cargando permisos…</p>}
        {permissions && !selected && <p className="p-4 text-sm">Este rol no tiene módulos comerciales asignados.</p>}
        {selected?.id === 'catalog' && <CommercialCatalogPage canWrite={permissions.includes('commercial.catalog.write')} />}
        {selected?.id === 'requests' && <CommercialIntakePage canWrite={permissions.includes('commercial.requests.write')} />}
        {selected?.id === 'drafts' && <ManagedDraftsPage canWrite={permissions.includes('commercial.requests.write')} />}
      </main>
    </div>
  </div>;
}
