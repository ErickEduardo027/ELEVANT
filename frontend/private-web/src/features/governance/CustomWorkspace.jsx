import { useEffect, useState } from 'react';
import ShellFrame from '../shell/ShellFrame';
import { LayoutGridIcon, ShieldCheckIcon } from '../shell/components/icons';
import { useResponsiveSidebar } from '../shell/useResponsiveSidebar';
import { usePreviewControls } from '../dashboard/usePreviewControls';
import CommercialCatalogPage from '../contracts/catalog/CommercialCatalogPage';
import ServiceClosurePanel from '../contracts/catalog/ServiceClosurePanel';
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
  { id: 'closures', label: 'Clausuras', permission: 'commercial.service_closures.read', icon: ShieldCheckIcon,
    description: 'Disponibilidad y decisiones sobre servicios.' },
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
  const allowed = (module, action) => permissions?.includes(`${module}.write`) ||
    permissions?.includes(`${module}.full`) || permissions?.includes(`${module}.${action}`);
  const selected = modules.find(item => item.id === moduleId) ?? modules[0];
  const station = { code: 'AVIAM', localAbbr: 'AST',
    localTime: new Date().toISOString(), utcTime: new Date().toISOString() };
  return <ShellFrame
    mainKey={selected?.id}
    sidebarProps={{ modules, activeModuleId: selected?.id, onSelectModule: id => { setModuleId(id); sidebar.closeOverlay(); },
      user, onLogout, breakpoint: sidebar.breakpoint, railVisible: sidebar.railVisible,
      railExpanded: sidebar.railExpanded, overlayOpen: sidebar.overlayOpen, onToggle: sidebar.toggle,
      onCloseOverlay: sidebar.closeOverlay }}
    topbarProps={{ station, notificationsEnabled: false, theme, onToggleTheme: toggleTheme, user, onOpenMenu: sidebar.toggle, onLogout }}>
        {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-4 text-sm">{error}</p>}
        {!permissions && !error && <p className="p-4 text-sm">Cargando permisos…</p>}
        {permissions && !selected && <p className="p-4 text-sm">Este rol no tiene módulos comerciales asignados.</p>}
        {selected?.id === 'catalog' && <CommercialCatalogPage
          canCreate={allowed('commercial.catalog', 'create')}
          canEdit={allowed('commercial.catalog', 'edit')}
          canRetire={allowed('commercial.catalog', 'full')}
          canSeeClosures={false} />}
        {selected?.id === 'requests' && <CommercialIntakePage
          canVerify={allowed('commercial.requests', 'full')}
          canApprove={allowed('commercial.requests', 'full')}
          canReject={allowed('commercial.requests', 'edit')} />}
        {selected?.id === 'drafts' && <ManagedDraftsPage
          canEdit={allowed('commercial.requests', 'edit')}
          canActivate={allowed('commercial.requests', 'full')} />}
        {selected?.id === 'closures' && <ServiceClosurePanel
          mode={permissions.includes('commercial.service_closures.decide') ||
            permissions.includes('commercial.service_closures.reopen') ? 'contracts' : 'occ'}
          canRequest={permissions.includes('commercial.service_closures.request')}
          canDecide={permissions.includes('commercial.service_closures.decide')}
          canReopen={permissions.includes('commercial.service_closures.reopen')} />}
  </ShellFrame>;
}
