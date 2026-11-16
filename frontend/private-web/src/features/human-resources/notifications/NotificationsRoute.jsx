import { useRouter } from 'next/navigation';
import PageHeader from '../../../components/PageHeader';
import { NotificationList } from '../../notifications/DepartmentNotificationCenter';
import useDepartmentNotifications from '../../notifications/useDepartmentNotifications';

// Real department feed (ADR-0019); new alerts also pop up on screen from the shell.
export default function NotificationsRoute() {
  const notifications = useDepartmentNotifications();
  const router = useRouter();
  return (
    <section className="space-y-4">
      <PageHeader title="Notificaciones" description="Solicitudes de acceso, requisiciones y disponibilidad por atender." />
      <NotificationList state={notifications} onOpen={target => target.path && router.push(target.path)} />
    </section>
  );
}
