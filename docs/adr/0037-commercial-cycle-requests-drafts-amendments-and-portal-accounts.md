# ADR-0037: Fase 1 «Comercial»: solicitudes, borradores, enmiendas, catálogo y cuentas del portal

## Estado

Accepted — 2026-11-06.

## Contexto

Fase 1 «Comercial» del ciclo operativo: desde la solicitud pública hasta el contrato aprobado por Finanzas y la cuenta del portal. El 5 de noviembre de 2026 se recorrió el ciclo completo con el arnés E2E nuevo contra el stack local, y la evaluación verificó 33 huecos de esta fase. Los más graves:
- La solicitud no se podía cancelar ni pasar a revisión, y una segunda solicitud de una aerolínea ya afiliada creaba otro contrato.
- Nadie confirmaba que el representante hablaba por la aerolínea antes de abrirle el portal, y el solicitante nunca se enteraba de la decisión.
- Una aerolínea sin IATA no se podía aprobar, y una que no figuraba en el listado no tenía cómo pedir acceso.
- Decidir la solicitud y guardar o enviar el borrador no tenían idempotencia ni versión esperada. Un borrador que no prosperaba no se podía descartar, y sus servicios y estaciones quedaban fijos desde la solicitud.
- El portal recibía la tarifa base y el motivo interno de una devolución de Finanzas.
- Las enmiendas no tenían pantalla, la unidad de cobro mezclaba códigos y nombres, y los paquetes no se podían descartar ni retirar.
- «Retirar» un servicio lo sacaba en silencio de los contratos vigentes.
- Las clausuras y el aprovisionamiento se atascaban con 409 sin código.
- La cola de correos enviaba enlaces y códigos vencidos, y varias pantallas decían «enviamos» cuando el correo solo quedó en cola.

Este ADR recoge cómo se cerraron. Refina [ADR-0016](0016-finance-tariffs-charges-and-receivables.md), [ADR-0018](0018-finance-commercial-platform-and-fiscal-simulation.md), [ADR-0019](0019-menu-option-permissions-and-department-notifications.md), [ADR-0022](0022-portal-email-verification.md), [ADR-0024](0024-airline-permits-and-contract-lifecycle.md) y [ADR-0025](0025-contract-validity-and-drawn-signatures.md); la verificación de fichas sigue [ADR-0023](0023-airline-public-registry-check.md).

## Decisión

**1. Una sola convención para los comandos.**
- **Idempotencia.** `CommercialCommandReceipts` (Persistence) guarda el recibo de cada `Idempotency-Key` en la tabla existente `commercial.finance_pricing_commands`: actor, acción, SHA-256 del cuerpo normalizado y recurso resultante. No hay tabla nueva.
  - Cada comando corre en una transacción serializable. Primero resuelve el recibo: el mismo actor, acción y cuerpo devuelven el resultado guardado; cualquier otra combinación responde `409 idempotency_conflict`. El replay se resuelve antes que la versión, porque un reintento legítimo ya la ve cambiada.
  - Después comprueba la versión esperada y las reglas de estado, y guarda en la misma transacción el cambio, la auditoría, los avisos, los correos y el recibo. Si dos peticiones con la misma clave compiten, se relee el recibo.
  - Las acciones se nombran `<módulo>.<entidad>.<verbo>`: `commercial.request.decide`, `contract.draft.submit`, `commercial.catalog.retire`, `governance.provisioning.link`…
  - El hash nunca incluye secretos. El replay del restablecimiento de contraseña de un cliente compara la contraseña con la cuenta resultante.
- **Versión esperada y fase expand.**
  - Los endpoints nuevos exigen la cabecera `Idempotency-Key` (UUID) y `expectedVersion` en el cuerpo. Si la cabecera falta o no es un UUID, responde el `400` de validación del framework, sin `code` (ver Problem Details).
  - En los que ya existían, la clave es opcional mientras queden clientes antiguos. La versión depende del endpoint:
    - **clave y versión opcionales:** la decisión de solicitudes, el `PUT` y el envío del borrador, el comentario de la aerolínea, el aprovisionamiento, el reenvío de la invitación y la contraseña temporal de clientes. Si llega la clave sin la versión, responden `400 expected_version_required`;
    - **solo la clave opcional:** el ciclo de vida (su token es el estado, `expectedStatus`), la decisión de Finanzas (`expectedVersion`), el `PUT` del catálogo y el de aerolíneas (`version`), y la decisión (`version`) y la reapertura (`serviceVersion`) de clausuras ya exigían la versión y la siguen exigiendo, con clave o sin ella.
  - En los endpoints nuevos y en los que ya existían, una clave con el GUID vacío (`00000000-…`) responde `400 idempotency_key_required`. Los clientes nuevos siempre envían la clave y la versión.
  - La versión esperada es el token `version` que expone la lectura del recurso.
  - La enmienda es la excepción (sección 4).
  - En las solicitudes, ese token une la `rowversion` de la solicitud y la de su ficha de aerolínea: si la identidad cambia desde otra solicitud de la misma aerolínea o en Superadministración, la pantalla vieja recibe `version_conflict` y aprobar no congela una identidad que el revisor no vio.
  - **PUT heredado retirado.** `PUT contracts/commercial-requests/airlines/{profileId}/verification`, anterior a la fase, reescribía la identidad de una ficha sin `Idempotency-Key` ni versión. Ningún cliente lo usaba, porque private-web verifica desde la solicitud (`POST {id}/airline-verification`), así que salió de la API, del snapshot OpenAPI y del cliente generado.
- **Problem Details.** Las fallas de validación, regla, estado, versión e idempotencia que devuelven los comandos y las lecturas de la fase llevan `extensions.code` en snake_case y un título en español. Cada controlador tiene un código por defecto según el tipo de fallo:
  - `400` es validación; `404`, el recurso de la ruta no existe o está fuera de alcance; `409`, conflicto de estado, de versión o de idempotencia;
  - los códigos comunes son `version_conflict`, `idempotency_conflict`, `idempotency_key_required`, `expected_version_required`, `reason_required` y `not_found`;
  - la lista que reconocen los clientes está en `packages/api-client/src/errors.ts`, sin códigos duplicados.
- **Respuestas sin código.** Siguen siendo Problem Details genéricos, con título en inglés y sin `code`:
  - el `401`;
  - el `403` por falta de permiso: los controladores responden `Forbid()` y `UseStatusCodePages` (`backend/Elevant.Api/Extensions/ApplicationBuilderExtensions.cs`) escribe el cuerpo. El único `403` con código es `closure_self_decision` (sección 5);
  - el `400` de enlace de modelo de `[ApiController]`: falta la cabecera `Idempotency-Key` donde es obligatoria, la cabecera no es un UUID, o el cuerpo está mal formado o falta donde es obligatorio. La API no define un `InvalidModelStateResponseFactory` propio;
  - los rechazos del pipeline por tamaño del cuerpo (`413`) o por límite de uso (`429`).

  Las lecturas de correos del superadministrador (`GET governance/email/deliveries` y `GET governance/email/outbox`) también responden su `403` sin código.
- **Clientes.**
  - Las pantallas traducen el `code` y nunca muestran el `title` (`frontend/private-web/src/services/problemMessages.js`). Sin `code`, explican el estado: sesión vencida (`401`), falta de permiso (`403`), registro inexistente (`404`), conflicto (`409`) o datos inválidos (`400`).
  - Una intención conserva su clave mientras se reintenta el mismo cuerpo tras un resultado incierto (sin respuesta o `5xx`) y la descarta tras cualquier `2xx` o `4xx` (`commandKeys.js`).
  - Ante un `409` la pantalla relee antes de formar otra intención.
  - Los adaptadores nuevos validan las respuestas de forma estricta en el cliente compartido.

**2. Solicitudes comerciales.**
- **Estados.**
  - `Pending` pasa a `InReview` la primera vez que Contratos verifica la aerolínea desde la solicitud o confirma al representante; abrirla no cambia nada.
  - `Cancelled` lleva motivo.
  - Cada cambio deja un evento de estado y auditoría, y nada se borra.
- **Endpoints** (`contracts/commercial-requests`):

  | Endpoint | Permiso | Regla |
  |---|---|---|
  | `GET inbox?status&search&page&limit` | `contracts.requests.read` | Por defecto, las abiertas (pendientes y en revisión), de la más antigua a la más reciente. Filtra por estado, busca en el servidor (referencia, aerolínea, nombre y correo del representante), pagina hasta 50 y cuenta por estado toda la bandeja. El `GET` anterior no cambia. |
  | `POST {id}/airline-verification` | `contracts.requests.verify` | Verifica la identidad con una fuente oficial, o vincula la solicitud a una ficha existente (`linkProfileId`). |
  | `POST {id}/representative-confirmation` | `contracts.requests.verify` | Nota de 5 a 1000 caracteres: quién confirmó, cuándo y por qué canal. Se registra una sola vez (`representative_already_confirmed`). |
  | `POST {id}/cancellation` | `contracts.requests.cancel` (nuevo) | Solicitud pendiente o en revisión, con motivo de 5 a 1000 caracteres. |
  | `POST {id}/decision` | `contracts.requests.approve` o `.reject` | Ya existía: clave y versión en fase expand. Aprobar responde el contrato creado. |

- **Aprobar exige** la confirmación del representante (`representative_unconfirmed`), la aerolínea verificada con razón social, país e ICAO (`airline_unverified`) y de 1 a 30 estaciones activas (`stations_invalid`). Se rechaza con:
  - `airline_already_contracted`: la aerolínea tiene un contrato `Draft`, `Active` o `Suspended`, u otra solicitud aprobada cuyo contrato sigue vivo o aún no existe;
  - `airline_has_portal_account`: tiene cuentas activas del portal;
  - `airline_code_in_use`: su IATA o su ICAO ya pertenece a otra fila de `ref.airlines`.

  Una aerolínea con contratos solo terminados o vencidos, y sin cuentas activas, puede volver a afiliarse. La bandeja marca al cliente existente y la pantalla orienta a la enmienda o la renovación.
- **Rechazar** exige motivo (`reason_required`). Una solicitud ya decidida o cancelada responde `request_closed`.
- **Correo al solicitante.** Aprobar, rechazar o cancelar encola, en la misma transacción, un correo con el propósito nuevo `CommercialDecision`, con el motivo cuando lo hay. El asunto no lleva la referencia ni el correo lleva adjunto. Un replay no lo duplica. No hay consulta pública del estado.
- **Aerolínea que no figura en el listado.** `POST public/commercial-requests` acepta `airlineProfileId` nulo junto con `proposedAirline`: nombre, país, ICAO obligatorio, IATA solo si existe y sitio HTTPS opcional. Llega uno u otro, nunca ambos.
  - La propuesta se guarda en la solicitud, no en el catálogo.
  - Al verificar, Contratos la vincula a una ficha existente o crea una ficha verificada y publicada en «Otras aerolíneas», con su fuente (la verificación manual de ADR-0023).
- **Aerolíneas sin IATA.** El ICAO es obligatorio y el IATA, opcional: `ref.airlines.iata_code` admite nulos, con índice único filtrado. Las respuestas existentes no cambian de tipo:
  - devuelven `""` donde el campo no admite nulos y `null` donde ya los admitía;
  - los campos genéricos de código (el de la aerolínea en contratos y en las opciones de Finanzas) muestran el ICAO;
  - el validador del bootstrap del portal acepta un IATA vacío.
- La entrada pública, Aprovisionamiento y Aerolíneas de Superadministración también responden con código (`invalid_application`, `airline_unavailable`, `service_unavailable`, `receipt_not_found`, `airline_profile_conflict`…).

**3. Borradores de contrato.**
- **«Listo para Finanzas».** Es una regla pura (`ContractDraftRules.Readiness`) con un código por causa, en este orden: `portal_account_missing`, `terms_missing`, `services_missing`, `rates_unconfirmed`, `stations_missing`, `service_retired`, `package_not_eligible`, `package_retired`, `valid_from_not_after_current` y `finance_reviewer_missing`. La usan:
  - `GET contracts/drafts/{id}/readiness`, que devuelve todas las causas y el estado de la cuenta del portal (`Missing`, `Invited` o `Active`);
  - el envío, `POST contracts/drafts/{id}/activate`, que responde `409` con la primera causa;
  - el botón de la pantalla, que solo se habilita cuando el servidor confirma.
- **Endpoints nuevos**, con clave y versión obligatorias:

  | Endpoint | Permiso | Regla |
  |---|---|---|
  | `GET` y `PUT contracts/drafts/{id}/scope` | `contracts.drafts.read` y `.update` | Servicios (1 a 100) y estaciones activas (1 a 30) de una versión `Draft`. Solo se agregan servicios activos del catálogo, que parten de la tarifa base sin confirmar. No se quita un servicio cubierto por un paquete vinculado (`service_in_package`). |
  | `POST contracts/drafts/{id}/discard` | `contracts.drafts.delete` (nuevo) | Versión `Draft` o `PendingFinanceApproval`, con motivo de 5 a 500 caracteres. |
  | `POST contracts/drafts/{id}/comments` | `contracts.drafts.update` | Respuesta de Contratos a la aerolínea. |

- **En fase expand**, con la clave opcional:
  - `PUT contracts/drafts/{id}`, el envío (su cuerpo es opcional) y `POST airline/contract-drafts/{id}/comments`, con la versión también opcional;
  - `POST contract-versions/{id}/lifecycle`, que conserva como token el estado que vio el usuario (ADR-0024);
  - `POST finance/contract-approvals/{id}/decision`, que ya exigía la versión (sección 4).
- **Descartar no borra.**
  - La versión pasa a `Rejected`, el estado que estaba reservado, con auditoría.
  - Si era la única versión viva de un contrato que nunca se activó, el contrato pasa a `Terminated` con su evento de estado.
  - En el detalle del contrato, «Descartar contrato» es `Terminate` sobre un contrato `Draft` (amplía ADR-0024). Toda terminación cierra como `Rejected` las versiones abiertas, y un contrato terminado ya no se firma ni recibe vigencia (`contract_terminated`).
  - Las listas de borradores solo excluyen los contratos terminados, así que la renovación de un contrato suspendido o vencido también aparece y se puede descartar.
- **Al guardar:**
  - un cambio de moneda o de vigencia que deje fuera de regla un paquete vinculado se rechaza (`package_not_eligible`);
  - cambiar la moneda deja todas las tarifas sin confirmar;
  - una renovación o una enmienda empieza después de la última versión aprobada (`valid_from_not_after_current`); la misma regla se aplica al enviar y al aprobar;
  - la unidad se guarda como código (`billing_unit_unknown` si no existe);
  - si los servicios cambiaron desde que se abrió el editor, responde `version_conflict`.
- **Estación base.** Una sola regla (`ContractDraftRules.BaseStation`): la tarifa base de la única estación de la versión, o la general si tiene varias. La usan el alta del borrador, el alcance, el editor y la comparación de Finanzas.
- **Servicios dados de baja.** Si uno llega por la solicitud, una renovación o una enmienda, se conserva marcado y bloquea el envío y la aprobación (`service_retired`) hasta que Contratos lo quita. El alcance nunca agrega uno.
- **Revisores de Finanzas.** Enviar exige una cuenta con `finance.contract_approvals.decide` que cubra todas las estaciones de la versión (`finance_reviewer_missing`). El aviso del envío llega a las cuentas con `finance.contract_approvals.read` que cubren todas esas estaciones, aunque no puedan decidir.
- **Observaciones.** La aerolínea comenta en `Draft` y mientras Finanzas revisa. Contratos responde desde Borradores, y el portal muestra la respuesta como «Contratos AVIAM». Un borrador cerrado responde `draft_closed`; uno en revisión rechaza las ediciones con `draft_in_finance_review`.
- **Privacidad del portal.** La aerolínea no recibe la tarifa base, los valores base de los cargos ni el motivo interno de una devolución de Finanzas: solo ve que la versión fue devuelta. Su línea de tiempo también omite ese motivo.
- **Avisos a Contratos.** Notificaciones de departamento nuevas: `portal_account_ready` (la cuenta del portal quedó lista, al aprovisionarla o vincularla), `contract_returned` y `contract_approved` (decisión de Finanzas). El recurso de cambios `contract_drafts` hace releer Borradores.

**4. Finanzas: aprobación de precios, enmiendas, unidades y paquetes.**
- **Aprobación.** `POST finance/contract-approvals/{id}/decision` exige `expectedVersion` y acepta la clave como opcional (acción `finance.contract.decide`). Aprobar se bloquea con un código por causa: `package_retired`, `package_not_eligible`, `ambiguous_package_coverage`, `package_service_not_in_contract`, `service_retired` y `valid_from_not_after_current`. Aprobar no activa el contrato (ADR-0024): la pantalla aprueba precios y explica que faltan la vigencia, las dos firmas y el permiso de operación.
- **Enmienda.** `POST contracts/versions/{versionId}/amendments`, con permiso `contracts.drafts.update`, sobre un contrato `Active` o `Suspended`:
  - parte siempre de la última versión `Approved`, aunque la ruta nombre otra versión del contrato;
  - hereda su fin, sus términos, sus estaciones, sus cargos negociados y sus paquetes, y copia las tarifas sin confirmar, con la unidad como código;
  - solo pide «Vigente desde»: posterior al inicio de esa versión (`valid_from_not_after_current`) y no posterior a su fin (`valid_from_after_current_end`);
  - se rechaza si ya hay un borrador o una versión en revisión (`draft_in_progress`), si el contrato no admite enmiendas (`contract_not_amendable`) o si no tiene versión aprobada (`no_approved_version`);
  - exige la `Idempotency-Key` sin fase expand, porque no tenía consumidores. Su token es `expectedStatus`, el estado del contrato que vio el usuario, porque ninguna lectura expone la versión de la versión aprobada; la transacción serializable revalida que no haya otro borrador;
  - responde `201` con la versión nueva, que sigue el flujo normal: Borradores, Finanzas, vigencia y firmas.
- **Unidad de cobro como código.** Todo el ciclo comercial guarda el código de `ref.billing_units`: catálogo, solicitud, borrador, alcance, renovación, enmienda, tarifas, cargos y paquetes.
  - Un nombre heredado («operación») se traduce al leer y al guardar, sin reescribir filas (`BillingUnitNames`).
  - Una unidad desconocida responde `billing_unit_unknown`.
  - Las pantallas proponen una unidad activa y la muestran en español; el portal también.
- **Seed de Development.** Crea los servicios `RAMP-*` nuevos con la unidad `operation`; los ya sembrados conservan «operación», que la API traduce al leer y al guardar. También publica, solo insertando, la tarifa base en USD y en DOP de los siete servicios públicos, incluso en bases ya sembradas.
- **Tarifarios.** Tarifas, cargos, unidades de cobro y tasas de cambio responden un código por causa (`tariff_draft_exists`, `tariff_start_not_after_current`, `billing_unit_exists`, `charge_code_exists`, `exchange_rate_exists`, `invalid_exchange_rate`…).
- **Paquetes.** Dos comandos nuevos, con clave, versión y motivo de 5 a 500 caracteres:
  - `POST finance/packages/{id}/discard`, con el permiso nuevo `finance.packages.delete`: el borrador pasa a `Discarded`;
  - `POST finance/packages/{id}/retire`, con el permiso nuevo `finance.packages.retire`: la versión publicada pasa a `Retired`.

  Ambos permisos se suman al alias heredado `finance.packages.manage`. Una versión retirada:
  - ya no se puede vincular (`package_retired`);
  - bloquea el envío y la aprobación de los borradores que la vinculan: las pantallas de Borradores releen esos borradores (`Draft` o `PendingFinanceApproval`) por el recurso de cambios `contract_drafts`, y su readiness muestra `package_retired`. Retirarla no genera una notificación de departamento;
  - no se quita de los contratos aprobados, que conservan el paquete congelado;
  - no revive la versión `Superseded` anterior.
- **Etiquetas.** Finanzas traduce el ámbito del paquete y los estados `Superseded`, `Discarded` y `Retired`. Un código desconocido nunca se muestra crudo.

**5. Catálogo comercial y clausuras.**
- **Ocultar y dar de baja son decisiones distintas.**
  - Ocultar del catálogo público solo desmarca «Visible al público» (`PUT contracts/catalog/services/{id}` con `isPublic=false`). El servicio sigue disponible para los contratos y para OCC.
  - Dar de baja es el comando nuevo `POST contracts/catalog/services/{id}/retirement`, con el permiso `contracts.catalog.delete` (ahora rotulado «Dar de baja»), clave, `expectedVersion` y motivo de 10 a 1000 caracteres. Se audita como `commercial.catalog.retired`. El servicio sale del catálogo público, de los contratos nuevos y de la operación.
- **La baja se rechaza** con `409 service_in_active_contract` mientras un contrato `Draft`, `Active` o `Suspended` tenga el servicio, como tarifa o dentro de un paquete vinculado, en una versión pendiente de Finanzas o en una `Approved` o `Superseded` que no haya vencido. Hay un día de margen por las estaciones que van detrás de UTC. Las versiones `Draft` no bloquean: el servicio queda marcado en ellas. La regla es pura: `CommercialServiceRetirement.KeepsServiceInForce`.
- **El `PUT` del catálogo:**
  - ya no desactiva un servicio (`400 retirement_command_required`);
  - no publica un servicio dado de baja (`service_retired`);
  - responde `409 closure_requires_reopen` si una clausura aprobada lo mantiene oculto;
  - puede reactivar un servicio dado de baja; la pantalla lo reactiva oculto, y se publica después;
  - acepta la clave como opcional.
- `DELETE contracts/catalog/services/{id}` queda como alias obsoleto (`deprecated` en OpenAPI), con la misma comprobación y la clave opcional.
- La baja y la reactivación hacen releer los borradores `Draft` que incluyen el servicio (recurso de cambios `contract_drafts`); no generan una notificación de departamento.
- **Clausuras.**
  - Aprobar funciona aunque Contratos ya haya ocultado o dado de baja el servicio; solo lo despublica si seguía público.
  - Republicar (`POST service-closures/services/{id}/reopen`) un servicio dado de baja responde `service_retired`: primero se reactiva en el catálogo. También responde `service_already_public`, `closure_pending` o `no_approved_closure`.
  - La decisión y la reapertura aceptan la clave como opcional (acciones `commercial.closure.decide` y `commercial.closure.reopen`).
  - Quien reportó la clausura no la decide: `403 closure_self_decision`.
  - La lectura de clausuras incluye `isServiceActive` (solo la usa private-web), y toda falla de regla, estado o versión lleva código.

**6. Cuentas del portal, Superadministración y correos.**
- **Aprovisionamiento** (`POST governance/provisioning/{requestId}`, superadministrador). La invitación por correo es la opción por defecto y la contraseña temporal, la alternativa explícita (ADR-0022). La clave y la versión de la solicitud son opcionales. Si el correo ya tiene cuenta, el código explica qué hacer:
  - `email_has_account`: es una cuenta del portal de la misma aerolínea o de ninguna, y se puede vincular;
  - `email_in_use_other_airline`, `email_in_use_internal`, `email_in_use` o `account_disabled`: no se puede.
- **Vincular una cuenta existente.** `POST governance/provisioning/{requestId}/account-link`, con clave y versión obligatorias, añade o reactiva la membresía de la aerolínea, completa la solicitud y avisa a Contratos (`portal_account_ready`). No toca credenciales.
- **Solicitud no disponible.** Ambos comandos responden `request_unavailable` cuando la solicitud ya no espera su cuenta: ya se aprovisionó o su contrato se descartó.
- **Reenviar la invitación** (`POST governance/provisioning/accounts/{accountId}/resend-invitation`). La clave y la versión de la cuenta son opcionales. Los enlaces anteriores dejan de servir y sus correos en cola se descartan (`superseded`).
- **Contraseña temporal sobre una invitación pendiente** (`POST governance/clients/{organizationId}/users/{id}/password-reset`).
  - Acepta la invitación, confirma el correo, retira los enlaces de activación y descarta su correo en cola (`invitation_closed`). El primer ingreso exige cambiar la contraseña.
  - Ya no depende de los tokens de Identity.
  - La clave y la versión son opcionales.
- **Identidad de una aerolínea que ya opera.** Cuando la ficha tiene su fila en `ref.airlines` o una solicitud aprobada, `PUT governance/airlines/{id}` responde `409 airline_identity_locked` si se intenta cambiar la razón social, el IATA o el ICAO, o quitar la verificación.
  - El nombre comercial, el logo, la publicación y las fuentes siguen editables.
  - Guardar sin cambios ya no vuelve a sellar la verificación.
  - La ficha expone `identityLocked`, y el `PUT` acepta la clave como opcional (`commercial.airline.update`).
- **Cola de correos** (`infra.email_outbox`):
  - Hay un estado nuevo, `Discarded`. Un enlace de activación (72 h), un código de inicio de sesión (10 min) o un enlace de recuperación (30 min) que vence en la cola se descarta con el motivo `expired` y pierde su cuerpo. Los demás propósitos no vencen.
  - Sin SMTP, el worker revisa la cola cada minuto, descarta lo vencido y no envía nada.
  - Al emitir un código nuevo o reenviar una invitación, los correos anteriores en cola se descartan (`superseded`).
  - El código de inicio de sesión ya no viaja en el asunto; la primera pasada del worker limpia los asuntos antiguos.
  - Un fallo guarda un motivo normalizado (`smtp_rejected`, `smtp_authentication`, `smtp_unavailable`, `attachment_unavailable` o `send_failed`), nunca el texto del proveedor.
- **Lecturas nuevas:**
  - `GET governance/email/outbox?status&page&limit`, solo para el superadministrador: estado, motivo y referencia de cada correo (contrato, factura, pago, cuenta o solicitud), nunca el cuerpo. La respuesta de `GET governance/email/deliveries` no gana claves; su último error pasa a ser un código normalizado.
  - `GET finance/invoices/{invoiceId}/email-deliveries`: el estado de los correos «Factura emitida» de esa factura, con `finance.invoicing.read`, `finance.invoicing.issue` o `finance.reconciliation.read` y la estación de la factura en alcance.
- **Textos veraces.** Superadministración y Finanzas dicen que un correo quedó en cola, no que se envió, y presentan la invitación como opción por defecto; el portal tampoco afirma que un correo ya salió. El inicio de sesión, `/activar` y `/recuperar` del portal no nombran ningún entorno: solo muestran una etiqueta si el build define `NEXT_PUBLIC_ELEVANT_ENVIRONMENT_LABEL`.

**7. Arnés E2E del ciclo completo.**
- `frontend/public-web/playwright.cycle.config.ts` y `frontend/public-web/tests/e2e-cycle/` recorren el ciclo con cuatro proyectos encadenados, uno por fase (comercial, pre-operación, operación y facturación). Cada corrida crea su propia aerolínea sintética.
- El arnés:
  - levanta public-web (`localhost:4174`) y private-web (`localhost:4175`) en modo desarrollo;
  - reenvía el nombre HTTPS de la API, por HTTP y por el WebSocket de SignalR, a la API local;
  - lee los correos en Mailpit.
- Necesita el stack local de `compose.local.yml` con el overlay `compose.local.e2e.yml`, que suma almacenamiento S3 con Garage fijado por digest, el CORS de los puertos del arnés y límites de uso altos, solo en local. `E2E_CYCLE_ENV_FILE` apunta al `.env` del stack, del que lee las credenciales sembradas sin imprimirlas.
- Se ejecuta con `npm run test:e2e:cycle` desde `frontend/public-web`. El estado de la corrida y las capturas quedan fuera del repositorio. Solo usa el reporter `list`, sin trazas ni reporte HTML, porque guardarían las contraseñas tecleadas.
- Los huecos aún abiertos de las fases siguientes figuran como `test.fixme("hueco …")`; los de esta fase ya son pruebas reales.
- Ningún workflow de CI lo ejecuta, y una corrida local no prueba un despliegue.

### Migración

`20261106020045_AddCommercialRequestReviewAndIcaoOnlyAirlines`, después de `AddSimulatedCardPayments`, es la única migración de la fase:
- `commercial.service_requests` recibe siete columnas que admiten nulos: la confirmación del representante (fecha, cuenta con FK `NO ACTION` e índice, y nota) y la aerolínea propuesta (país, IATA, ICAO y sitio).
- `ref.airlines.iata_code` pasa a `char(2) NULL`, y su índice único se filtra por `iata_code IS NOT NULL`. `ck_airline_iata` no cambia.
- No usa `HasData` ni DML. El `Down` se niega (`THROW 52370`) si ya hay confirmaciones, propuestas o aerolíneas sin IATA, porque esa historia comercial se conserva.

No necesitan migración:
- los valores que la fase empieza a usar, porque se guardan como texto: `InReview` y `Cancelled` de la solicitud, `Rejected` de la versión, `Discarded` y `Retired` del paquete, y el propósito `CommercialDecision` y el estado `Discarded` del correo;
- los recibos, que usan `commercial.finance_pricing_commands`;
- los permisos nuevos, que viven en `DepartmentPermissionCatalog`. Los administradores y el superadministrador los reciben, y los grants heredados `commercial.requests.full` y `commercial.requests.write` incluyen los de Contratos.

### Compatibilidad y orden de despliegue

- La API es retrocompatible gracias a la fase expand: los clientes anteriores siguen llamando sin clave, y sin versión en los comandos que no la exigían (sección 1). A la inversa, en estos endpoints una API anterior ignora los campos nuevos de un cuerpo: sus contratos no rechazan miembros desconocidos.
- **La API y private-web salen juntas.** Aprobar ahora exige la confirmación del representante, que la web anterior no puede registrar, y private-web necesita los endpoints nuevos.
- Public Web puede salir después: la API acepta el cuerpo anterior de la solicitud pública.
- El APK no cambia. Ninguna respuesta que valida de forma estricta gana claves, y un IATA vacío pasa su validación.
- En la siguiente release, el seed de Development insertará las tarifas base de los servicios públicos en las bases ya sembradas, sin reescribir filas.

## Consecuencias

- Toda solicitud termina con una respuesta (aprobada, rechazada o cancelada) y un correo al solicitante.
- Una aerolínea afiliada no genera un segundo contrato ni una segunda entrada al portal: amplía su contrato con una enmienda o una renovación.
- El acceso al portal descansa en una confirmación registrada del representante, no solo en el correo del formulario.
- Contratos ve por qué un borrador no avanza y recibe aviso cuando ya puede. Descartar no borra nada.
- OCC no pierde en silencio un servicio de un contrato en vigor.
- La cola de correos no envía secretos vencidos ni guarda códigos en el asunto.
- Mientras dure la fase expand conviven dos formas de llamar a los comandos que ya existían.

**Queda pendiente**
- **Paso «contract».** Cuando no queden clientes antiguos:
  - hacer obligatorias la `Idempotency-Key` y la versión esperada en la decisión de solicitudes, el `PUT` y el envío del borrador, el comentario de la aerolínea, el aprovisionamiento, el reenvío de la invitación y la contraseña temporal de clientes;
  - hacer obligatoria la `Idempotency-Key`, porque la versión ya lo es, en el ciclo de vida del contrato, la decisión de Finanzas, el `PUT` del catálogo, la decisión y la reapertura de clausuras y el `PUT` de aerolíneas;
  - retirar el `DELETE` obsoleto del catálogo.
- Los comandos de los tarifarios (tarifas, cargos, unidades y tasas) tienen versión esperada, pero no `Idempotency-Key`.
- Un servicio dado de baja antes de esta corrección que siga en un contrato vigente no se detecta solo; se reactiva desde el catálogo.
- El restablecimiento de contraseña de los usuarios internos (`POST governance/departments/{department}/users/{id}/password-reset` y `POST governance/users/{id}/password-reset`) todavía pide un token de Identity (`GeneratePasswordResetTokenAsync`), y la API registra Identity sin proveedores de tokens: la llamada falla con un error de servidor. Ninguna prueba cubre esas rutas. Necesita el mismo arreglo que el de clientes.
- Las pantallas bilingües de OCC y Revisión todavía muestran el código de la unidad (`operation`).
- **Defecto abierto en la emisión de facturas.** La emisión directa ([ADR-0035](0035-direct-invoicing-simulated-ecf.md)) valora los paquetes con `FinancePackageValuation`, que compara como texto la unidad congelada del servicio ejecutado con la del componente del paquete. Un servicio cuya unidad congelada sigue siendo «operación» (contratos tarifados antes de esta fase), cubierto por un componente guardado como `operation`, bloquea la emisión con `package_unit_mismatch` hasta que la valoración normalice ambas con `BillingUnitNames`.
- «Contratos listos» de OCC sigue omitiendo sin aviso una aerolínea con dos versiones aplicables el mismo día (ADR-0027). La aprobación ya impide crear contratos nuevos duplicados.
- Una enmienda o renovación aprobada pero sin firmar ya cubre vuelos desde su inicio: es el hueco 2-C de la fase 2.
- La imagen de Public Web y su plantilla de Dokploy no pasan `NEXT_PUBLIC_ELEVANT_ENVIRONMENT_LABEL`, así que hoy el portal no muestra ninguna etiqueta de entorno.
- La readiness calcula en cada lectura qué cuentas pueden decidir en Finanzas, y el estado de correo de una factura filtra la cola sin índice. Alcanza con el volumen actual; se revisará si crece.

## Trazabilidad de huecos

El código y las pruebas citan estos identificadores.

| Hueco | Qué faltaba | Sección |
|---|---|---|
| 1-A | Cancelar una solicitud o pasarla a revisión; dos solicitudes creaban dos contratos | 2 |
| 1-B | Descartar un borrador o un contrato que no prosperó | 3 |
| 1-C | Enmiendas con pantalla y su propia fecha de inicio | 4 |
| 1-D | Idempotencia y versión esperada al decidir, guardar y enviar | 1, 2 y 3 |
| 1-E | Unidad «operación» inválida y servicios públicos sin tarifa base | 4 |
| 1-F | «Aprobar y activar», que no activaba | 4 |
| 1-N01 | Segundo contrato o segunda cuenta de una aerolínea ya afiliada | 2 |
| 1-N02 | El solicitante nunca conocía la decisión | 2 |
| 1-N03 | «Retirar» quitaba un servicio de los contratos en vigor | 5 |
| 1-N04 | Servicios y estaciones fijos desde la solicitud | 3 |
| 1-N05 | Datos internos de Finanzas en el portal | 3 |
| 1-N06 | Precio base distinto en el editor, el portal, el alta y Finanzas | 3 |
| 1-N07 | Moneda o vigencia sin revalidar paquetes, y 409 genérico en Finanzas | 3 y 4 |
| 1-N08 | «Enviamos» cuando el correo solo quedó en cola | 6 |
| 1-N09 | Enlaces y códigos vencidos o reemplazados en la cola | 6 |
| 1-N10 | Servicios dados de baja dentro de borradores y renovaciones | 3 |
| 1-N11 | Clausuras y reaperturas sin salida | 5 |
| 1-N12 | Contraseña temporal sobre una invitación pendiente | 6 |
| 1-N13 | Aprovisionamiento atascado por un correo con cuenta | 6 |
| 1-N14 | Envío a Finanzas sin causa visible ni aviso | 3 |
| 1-N15 | Observaciones de un solo sentido, que fallaban durante la revisión de Finanzas | 3 |
| 1-N16 | Problem Details en inglés y sin código; error mostrado como vacío | 1 y 2 |
| 1-N17 | Aerolíneas sin IATA | 2 |
| 1-N18 | Representante sin confirmar | 2 |
| 1-N19 | Alcance por estación distinto entre Contratos y Finanzas | 3 |
| 1-N20 | Identidad de una aerolínea operativa editable en Superadministración | 6 |
| 1-N21 | Textos que presentaban la entrega manual como la vía normal | 6 |
| 1-N22 | Panel de correos sin traducir ni referencias | 6 |
| 1-N23 | Bandeja truncada en 200 solicitudes y sin filtro | 2 |
| 1-N24 | Portal que se declaraba «Development» | 6 |
| 1-N25 | Aerolínea que no figura en el listado | 2 |
| 1-N26 | Códigos crudos en Solicitudes y en Finanzas | 2 y 4 |
| 1-N27 | Paquetes sin descarte ni retiro | 4 |
