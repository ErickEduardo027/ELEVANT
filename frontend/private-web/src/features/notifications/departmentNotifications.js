import { CONTRACT_MODULE_IDS } from '../contracts/shell/modules';
import { FINANCE_MODULE_IDS } from '../finance/shell/modules';
import { HUMAN_RESOURCES_BASE_PATH } from '../human-resources/navigation';

// What each department alert says and which menu option opens its source. The server only
// sends the kind and a short subject; the source is re-read under current permissions.
const KINDS = {
  access_request: { title: 'Nueva solicitud de acceso', target: { path: `${HUMAN_RESOURCES_BASE_PATH}/access-requests` } },
  requisition: { title: 'Nueva requisición de personal', target: { path: `${HUMAN_RESOURCES_BASE_PATH}/requisitions` } },
  availability_request: { title: 'Solicitud de disponibilidad por decidir', target: { path: `${HUMAN_RESOURCES_BASE_PATH}/schedules` } },
  commercial_request: { title: 'Nueva solicitud comercial', target: { moduleId: CONTRACT_MODULE_IDS.REQUESTS } },
  draft_comment: { title: 'La aerolínea comentó un borrador', target: { moduleId: CONTRACT_MODULE_IDS.DRAFTS } },
  service_closure: { title: 'Solicitud de clausura de servicio', target: { moduleId: CONTRACT_MODULE_IDS.CATALOG } },
  contract_signed: { title: 'La aerolínea firmó un contrato', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  permit_submitted: { title: 'La aerolínea envió un permiso para verificar', target: { moduleId: CONTRACT_MODULE_IDS.PERMITS } },
  permit_expiring: { title: 'Un permiso de aerolínea vence en 30 días o menos', target: { moduleId: CONTRACT_MODULE_IDS.PERMITS } },
  contract_activated: { title: 'Contrato activo', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_suspended: { title: 'Contrato suspendido por permiso vencido', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_expired: { title: 'Contrato vencido', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_expiring: { title: 'Un contrato vence en 30 días o menos', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_lifecycle: { title: 'Cambio en el ciclo de un contrato', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_approval: { title: 'Contrato pendiente de aprobación', target: { moduleId: FINANCE_MODULE_IDS.CONTRACT_APPROVALS } },
  preinvoice_accepted: { title: 'La aerolínea aceptó una prefactura', target: { moduleId: FINANCE_MODULE_IDS.RECONCILIATION } },
  preinvoice_disputed: { title: 'La aerolínea disputó una prefactura', target: { moduleId: FINANCE_MODULE_IDS.RECONCILIATION } },
};

export function describeNotification(item) {
  const known = KINDS[item.kind];
  const title = known?.title ?? 'Nueva notificación';
  const subject = [item.subject, item.stationCode].filter(Boolean).join(' · ');
  return { title, subject, message: subject ? `${title}: ${subject}` : title, target: known?.target ?? null };
}
