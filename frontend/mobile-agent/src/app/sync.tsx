import { FeaturePendingScreen } from '../components/feature-pending-screen';

export default function SyncScreen() {
  return (
    <FeaturePendingScreen
      title="Sincronización operativa"
      description="La cola transaccional se incorporará junto con los comandos idempotentes de ejecución de operaciones."
    />
  );
}
