import Badge from '../../../../components/Badge';

// Chip de rol, visualmente consistente en tabla y detalle.
export default function UserRoleBadge({ roleName }) {
  return <Badge tone="accent" label={roleName} />;
}
