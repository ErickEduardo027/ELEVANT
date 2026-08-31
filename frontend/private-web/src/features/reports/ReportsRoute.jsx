import ReportsPage from './ReportsPage';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

// A diferencia de los demás módulos de Admin/OCC, ReportsPage gestiona su
// propia obtención de datos internamente (vía useReportFilters/useReportsData),
// por lo que la Route sólo necesita reenviar el forceState de previsualización.
export default function ReportsRoute() {
  const { forceState } = useAdminOccPreview();
  return <ReportsPage forceState={forceState} />;
}
