import { useRouter } from 'next/navigation';
import DashboardListRow from './DashboardListRow';
import StatusBadge from '../../../../components/StatusBadge';
import { TONE_HEX } from '../../../../components/toneColors';

export default function ExpirationListItem({ expiration, actionsEnabled = true }) {
  const router = useRouter();

  return (
    <DashboardListRow
      accentColor={TONE_HEX[expiration.statusTone]}
      title={expiration.agentName}
      subtitle={expiration.itemLabel}
      meta={expiration.dueLabel}
      badge={<StatusBadge tone={expiration.statusTone} label={expiration.statusLabel} />}
      action={actionsEnabled ? { label: 'Ver', onClick: () => router.push(expiration.modulePath) } : undefined}
    />
  );
}
