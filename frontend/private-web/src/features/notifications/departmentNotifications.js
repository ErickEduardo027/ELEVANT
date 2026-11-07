import { CONTRACT_MODULE_IDS } from '../contracts/shell/modules';
import { FINANCE_MODULE_IDS } from '../finance/shell/modules';
import { HUMAN_RESOURCES_BASE_PATH } from '../human-resources/navigation';

// What each department alert says and which menu option opens its source. The server only
// sends the kind and a short subject; the source is re-read under current permissions.
const KINDS = {
  access_request: { title: 'Nueva solicitud de acceso', target: { path: `${HUMAN_RESOURCES_BASE_PATH}/access-requests` } },
  requisition: { title: 'Nueva requisición de personal', target: { path: `${HUMAN_RESOURCES_BASE_PATH}/requisitions` } },
  availability_request: { title: 'Solicitud de disponibilidad por decidir', target: { path: `${HUMAN_RESOURCES_BASE_PATH}/schedules` } },
  // 2-N25 (phase 2, block D): the daily sweep warns HumanResources:DocumentExpiryNoticeDays before a current document ends.
  agent_document_expiring: { title: 'Un carnet o una licencia de rampa está por vencer', target: { path: `${HUMAN_RESOURCES_BASE_PATH}/permits` } },
  agent_qualification_expiring: { title: 'Una habilitación de un agente está por vencer', target: { path: `${HUMAN_RESOURCES_BASE_PATH}/certifications` } },
  commercial_request: { title: 'Nueva solicitud comercial', target: { moduleId: CONTRACT_MODULE_IDS.REQUESTS } },
  draft_comment: { title: 'La aerolínea comentó un borrador', target: { moduleId: CONTRACT_MODULE_IDS.DRAFTS } },
  // 1-N14: Contratos learns when it can move a draft forward.
  portal_account_ready: { title: 'La cuenta del portal de la aerolínea está lista: ya puede enviar el borrador a Finanzas', target: { moduleId: CONTRACT_MODULE_IDS.DRAFTS } },
  contract_returned: { title: 'Finanzas devolvió un borrador', target: { moduleId: CONTRACT_MODULE_IDS.DRAFTS } },
  contract_approved: { title: 'Finanzas aprobó los precios de un contrato: fije la vigencia y gestione las firmas', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  service_closure: { title: 'Solicitud de clausura de servicio', target: { moduleId: CONTRACT_MODULE_IDS.CATALOG } },
  contract_signed: { title: 'La aerolínea firmó un contrato', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  permit_submitted: { title: 'La aerolínea envió un permiso para verificar', target: { moduleId: CONTRACT_MODULE_IDS.PERMITS } },
  permit_expiring: { title: 'Un permiso de aerolínea vence en 30 días o menos', target: { moduleId: CONTRACT_MODULE_IDS.PERMITS } },
  contract_activated: { title: 'Contrato activo', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  // 2-N09: the sweep (expired permit) and a revoked verification both suspend for the operating permit.
  contract_suspended: { title: 'Contrato suspendido por falta de un permiso de operación vigente', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_expired: { title: 'Contrato vencido', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  // 2-N12: announced the notice days its version signed before the end (30 when it signed none).
  contract_expiring: { title: 'Un contrato está por vencer', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_lifecycle: { title: 'Cambio en el ciclo de un contrato', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  // 2-N29 (phase 2, block B): kinds the server already sent without a title or a destination.
  contract_validity: { title: 'Se fijó la vigencia de un contrato: ya puede firmarse', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_renewal_started: { title: 'Empezó la renovación automática de un contrato: complete el borrador', target: { moduleId: CONTRACT_MODULE_IDS.DRAFTS } },
  // Phase 2, block A: a termination with notice (2-N14), the withdrawal of an unsigned version (2-N10) and an
  // automatic renewal that could not start (2-N27).
  contract_termination_scheduled: { title: 'Se programó la terminación de un contrato', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_termination_cancelled: { title: 'Se canceló la terminación programada de un contrato', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_terminated: { title: 'Un contrato terminó en su fecha efectiva', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_version_withdrawn: { title: 'Contratos retiró una versión sin las dos firmas', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_renewal_blocked: { title: 'La renovación automática de un contrato no pudo iniciarse', target: { moduleId: CONTRACT_MODULE_IDS.CONTRACTS } },
  contract_approval: { title: 'Contrato pendiente de aprobación', target: { moduleId: FINANCE_MODULE_IDS.CONTRACT_APPROVALS } },
  preinvoice_accepted: { title: 'La aerolínea aceptó una prefactura', target: { moduleId: FINANCE_MODULE_IDS.RECONCILIATION } },
  preinvoice_disputed: { title: 'La aerolínea disputó una prefactura', target: { moduleId: FINANCE_MODULE_IDS.RECONCILIATION } },
  invoice_paid: { title: 'La aerolínea pagó una factura con tarjeta', target: { moduleId: FINANCE_MODULE_IDS.RECONCILIATION } },
};

export function describeNotification(item) {
  const known = KINDS[item.kind];
  const title = known?.title ?? 'Nueva notificación';
  const subject = [item.subject, item.stationCode].filter(Boolean).join(' · ');
  return { title, subject, message: subject ? `${title}: ${subject}` : title, target: known?.target ?? null };
}
