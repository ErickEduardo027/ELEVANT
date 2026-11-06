import { problemMessage } from '../../../services/problemMessages';

// Solo se ve en inglés dentro del espacio OCC (LanguageScope); en Contratos
// el idioma efectivo sigue siendo español.
export const serviceClosureMessages = {
  es: {
    status: { Pending: 'Pendiente', Approved: 'Clausura aprobada', Denied: 'Denegada' },
    videoOf: 'Video de {name}',
    reasonLength: 'Escriba un motivo de 10 a 1000 caracteres.',
    notices: {
      request: 'Solicitud de clausura enviada a Contratos.',
      approve: 'Clausura aprobada. El servicio no se ofrece en el catálogo público.',
      reopen: 'Servicio republicado con motivo registrado.',
      deny: 'Solicitud denegada. El servicio continúa publicado.',
    },
    conflict: 'El estado cambió. Actualice el listado y reintente.',
    eyebrow: 'AVIAM / SERVICIOS',
    region: 'Clausuras de servicios',
    titleOcc: 'Disponibilidad de servicios',
    titleContracts: 'Solicitudes de clausura',
    subtitleOcc: 'Revise la oferta actual y notifique a Contratos cuando no pueda ejecutarse un servicio.',
    subtitleContracts: 'Decida las solicitudes de OCC. La aprobación suspende la comercialización global sin alterar contratos ni operaciones existentes.',
    refresh: 'Actualizar',
    retry: 'Reintentar',
    loading: 'Cargando servicios…',
    forbiddenView: 'No tiene permiso para ver las solicitudes de clausura.',
    published: 'Servicios publicados',
    closurePending: 'Clausura pendiente',
    notifyClosure: 'Notificar clausura',
    noPublished: 'No hay servicios publicados.',
    history: 'Historial compartido · {count} pendientes',
    filter: 'Estado',
    filters: { all: 'Todos', Pending: 'Pendientes', Approved: 'Aprobadas', Denied: 'Denegadas' },
    noRequests: 'Todavía no hay solicitudes de clausura.',
    approveClosure: 'Aprobar clausura',
    deny: 'Denegar',
    republish: 'Republicar',
    retiredHint: 'Servicio dado de baja: reactívelo en el catálogo para poder republicarlo.',
    unpublishedHint: 'El servicio ya no está en el catálogo público; aprobar la clausura la deja registrada.',
    occReason: 'Motivo OCC:',
    decision: 'Decisión:',
    reopening: 'Reapertura:',
    previous: 'Anterior',
    next: 'Siguiente',
    dialog: 'Confirmar acción de servicio',
    dialogTitles: {
      request: 'Notificar clausura',
      approve: 'Aprobar clausura',
      deny: 'Denegar clausura',
      reopen: 'Republicar servicio',
    },
    approveHint: 'El servicio dejará de aparecer para nuevas solicitudes de aerolíneas.',
    recordedHint: 'La decisión quedará registrada y será visible para OCC y Contratos.',
    reasonOptional: 'Motivo (opcional)',
    reasonRequired: 'Motivo (obligatorio)',
    cancel: 'Cancelar',
    saving: 'Guardando…',
    confirm: 'Confirmar',
    problems: {
      session: 'La sesión expiró. Vuelva a iniciar sesión.',
      forbidden: 'No tiene permiso para esta acción.',
      notFound: 'El servicio o la solicitud ya no existe. Actualice el listado.',
      invalid: 'Revise los datos e intente de nuevo.',
      fallback: 'No se pudo completar la acción. Revise la conexión e intente de nuevo.',
      codes: {
        service_retired: 'El servicio está dado de baja. Reactívelo en el catálogo antes de republicarlo.',
        service_already_public: 'El servicio ya está publicado. Actualice el listado.',
        closure_pending: 'El servicio ya tiene una solicitud de clausura pendiente. Decídala primero.',
        closure_not_pending: 'La solicitud ya fue decidida. Actualice el listado.',
        closure_self_decision: 'No puede decidir una clausura que usted mismo notificó.',
        service_not_published: 'El servicio ya no está publicado. Actualice el listado.',
        no_approved_closure: 'Ninguna clausura aprobada mantiene oculto este servicio. Actualice el listado.',
        service_not_found: 'El servicio ya no existe. Actualice el listado.',
        reason_required: 'Escriba un motivo de 10 a 1000 caracteres.',
        invalid_closure: 'Revise los datos de la solicitud e intente de nuevo.',
        invalid_closure_query: 'El filtro no es válido.',
        version_conflict: 'El estado cambió. Actualice el listado y reintente.',
        idempotency_conflict: 'Ese envío ya se usó con otros datos. Actualice el listado y reintente.',
        not_found: 'El servicio o la solicitud ya no existe. Actualice el listado.',
      },
    },
  },
  en: {
    status: { Pending: 'Pending', Approved: 'Closure approved', Denied: 'Denied' },
    videoOf: 'Video of {name}',
    reasonLength: 'Enter a reason of 10 to 1000 characters.',
    notices: {
      request: 'Closure request sent to Contracts.',
      approve: 'Closure approved. The service is not offered in the public catalog.',
      reopen: 'Service republished with the reason recorded.',
      deny: 'Request denied. The service remains published.',
    },
    conflict: 'The status changed. Refresh the list and try again.',
    eyebrow: 'AVIAM / SERVICES',
    region: 'Service closures',
    titleOcc: 'Service availability',
    titleContracts: 'Closure requests',
    subtitleOcc: 'Review the current offering and notify Contracts when a service cannot be performed.',
    subtitleContracts: 'Decide on OCC requests. Approval suspends global sales without altering existing contracts or operations.',
    refresh: 'Refresh',
    retry: 'Try again',
    loading: 'Loading services…',
    forbiddenView: 'You are not allowed to see the closure requests.',
    published: 'Published services',
    closurePending: 'Closure pending',
    notifyClosure: 'Report closure',
    noPublished: 'There are no published services.',
    history: 'Shared history · {count} pending',
    filter: 'Status',
    filters: { all: 'All', Pending: 'Pending', Approved: 'Approved', Denied: 'Denied' },
    noRequests: 'There are no closure requests yet.',
    approveClosure: 'Approve closure',
    deny: 'Deny',
    republish: 'Republish',
    retiredHint: 'Service retired: reactivate it in the catalog before republishing it.',
    unpublishedHint: 'The service is no longer in the public catalog; approving the closure records it.',
    occReason: 'OCC reason:',
    decision: 'Decision:',
    reopening: 'Reopening:',
    previous: 'Previous',
    next: 'Next',
    dialog: 'Confirm service action',
    dialogTitles: {
      request: 'Report closure',
      approve: 'Approve closure',
      deny: 'Deny closure',
      reopen: 'Republish service',
    },
    approveHint: 'The service will no longer appear for new airline requests.',
    recordedHint: 'The decision will be recorded and visible to OCC and Contracts.',
    reasonOptional: 'Reason (optional)',
    reasonRequired: 'Reason (required)',
    cancel: 'Cancel',
    saving: 'Saving…',
    confirm: 'Confirm',
    problems: {
      session: 'Your session expired. Sign in again.',
      forbidden: 'You are not allowed to do this.',
      notFound: 'The service or the request no longer exists. Refresh the list.',
      invalid: 'Check the data and try again.',
      fallback: 'The action could not be completed. Check the connection and try again.',
      codes: {
        service_retired: 'The service is retired. Reactivate it in the catalog before republishing it.',
        service_already_public: 'The service is already published. Refresh the list.',
        closure_pending: 'The service already has a pending closure request. Decide it first.',
        closure_not_pending: 'The request was already decided. Refresh the list.',
        closure_self_decision: 'You cannot decide a closure you reported yourself.',
        service_not_published: 'The service is no longer published. Refresh the list.',
        no_approved_closure: 'No approved closure keeps this service hidden. Refresh the list.',
        service_not_found: 'The service no longer exists. Refresh the list.',
        reason_required: 'Enter a reason of 10 to 1000 characters.',
        invalid_closure: 'Check the request data and try again.',
        invalid_closure_query: 'The filter is not valid.',
        version_conflict: 'The status changed. Refresh the list and try again.',
        idempotency_conflict: 'That submission was already used with other data. Refresh the list and try again.',
        not_found: 'The service or the request no longer exists. Refresh the list.',
      },
    },
  },
};

/**
 * Message of a failed closure call by its Problem Details code, in the language of the space: Spanish goes
 * through the shared core; English (only inside the OCC space) follows the same order. The server title is
 * never shown.
 *
 * @param {unknown} error
 * @param {'es' | 'en'} [language]
 */
export function closureProblemMessage(error, language = 'es') {
  const messages = serviceClosureMessages[language] ?? serviceClosureMessages.es;
  const { problems } = messages;
  if (messages === serviceClosureMessages.es)
    return problemMessage(error, problems.codes, { fallback: problems.fallback, forbidden: problems.forbidden });
  const status = typeof error?.status === 'number' ? error.status : undefined;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  if (status === 401) return problems.session;
  if (code && Object.prototype.hasOwnProperty.call(problems.codes, code)) return problems.codes[code];
  if (status === 403) return problems.forbidden;
  if (status === 404) return problems.notFound;
  if (status === 409) return messages.conflict;
  if (status === 400) return problems.invalid;
  return problems.fallback;
}
