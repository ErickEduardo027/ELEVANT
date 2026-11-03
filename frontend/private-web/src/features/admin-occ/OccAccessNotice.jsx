import Link from '../../components/AppLink';
import { useTranslation } from '../../i18n/LanguageScope';

const messages = {
  es: {
    title: 'Acceso a Panorama no disponible',
    description: 'Tu cuenta no tiene permiso para abrir este módulo. Puedes continuar en los módulos autorizados o solicitar acceso a tu administrador.',
    available: 'Módulos disponibles', empty: 'No hay otros módulos disponibles para tu cuenta.',
    modules: { planning: 'Planificación', approvals: 'Revisión', reports: 'Reportes', notifications: 'Notificaciones', chat: 'Chat interno', users: 'Usuarios del departamento', expenses: 'Mis gastos', 'flight-monitoring': 'Monitoreo de vuelos', 'positions-map': 'Posiciones' },
  },
  en: {
    title: 'Panorama access is unavailable',
    description: 'Your account does not have permission to open this module. You can continue in an authorized module or request access from your administrator.',
    available: 'Available modules', empty: 'No other modules are available for your account.',
    modules: { planning: 'Planning', approvals: 'Review', reports: 'Reports', notifications: 'Notifications', chat: 'Internal chat', users: 'Department users', expenses: 'My expenses', 'flight-monitoring': 'Flight monitoring', 'positions-map': 'Positions' },
  },
};

export default function OccAccessNotice({ navigation }) {
  const { t } = useTranslation(messages);
  const available = navigation.filter(item => item.id !== 'dashboard');
  return <section data-occ-access-notice className="m-4 max-w-3xl space-y-5 rounded-3xl border border-occ-line bg-occ-panel p-6" role="status">
    <h1 className="text-2xl font-semibold text-occ-text">{t('title')}</h1>
    <p className="max-w-2xl text-sm text-occ-muted">{t('description')}</p>
    {available.length ? <nav aria-label={t('available')} className="flex flex-wrap gap-3">
      {available.map(item => <Link key={item.id} to={item.path} className="inline-flex min-h-11 items-center rounded-xl border border-occ-line px-4 py-2 text-sm font-semibold text-occ-accent hover:bg-occ-accent-soft">{t(`modules.${item.id}`)}</Link>)}
    </nav> : <p className="text-sm text-occ-muted">{t('empty')}</p>}
  </section>;
}
