import { useNavigate } from 'react-router-dom';
import DashboardListRow from './DashboardListRow';
import StatusBadge from '../../../../components/StatusBadge';
import { TONE_HEX } from '../../../../components/toneColors';

export default function ExpirationListItem({ expiration }) {
  const navigate = useNavigate();

  return (
    <DashboardListRow
      accentColor={TONE_HEX[expiration.statusTone]}
      title={expiration.agentName}
      subtitle={expiration.itemLabel}
      meta={expiration.dueLabel}
      badge={<StatusBadge tone={expiration.statusTone} label={expiration.statusLabel} />}
      action={{ label: 'Ver', onClick: () => navigate(expiration.modulePath) }}
    />
  );
}
