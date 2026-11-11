---
id: dominio-glosario-canonico
title: "Glosario canónico"
type: reference
area: domain
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-11-06"
verified_commit: "8a79fe70a3c592ab3f5dc8af1e7c03f1314b526d"
sources:
  - README.md
  - docs/architecture/database-v1.md
  - docs/database/schema-v1.md
  - backend/Elevant.Domain/Enumerations/IdentityEnums.cs
  - backend/Elevant.Domain/Enumerations/OperationsEnums.cs
  - backend/Elevant.Domain/Enumerations/WorkforceCommercialEnums.cs
  - backend/Elevant.Domain/Enumerations/FinanceEnums.cs
  - backend/Elevant.Application/Commercial/ContractDraftRules.cs
  - backend/Elevant.Application/Commercial/ContractAmendment.cs
  - backend/Elevant.Application/Commercial/CommercialServiceRetirement.cs
  - backend/Elevant.Application/Identity/AccountEmails/EmailOutboxLifetimes.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/OperationsConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/IntegrationAuditConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/PlatformConfiguration.cs
  - frontend/private-web/README.md
  - frontend/public-web/README.md
  - frontend/mobile-agent/README.md
tags:
  - glosario
  - lenguaje-ubiquo
  - operaciones
  - referencia
---

# Glosario canónico

Este glosario normaliza términos usados por código, base y prototipos. “Canónico” significa que el concepto tiene respaldo en el modelo o en una decisión versionada; no significa que ya tenga endpoint público.

## Plataforma y actores

| Término | Significado | No confundir con |
| --- | --- | --- |
| ELEVANT | Plataforma de AVIAM para planificar y controlar asistencia en tierra. | Una sola de sus interfaces. |
| AVIAM | Organización operadora interna modelada como `AviamOperator`. | Una aerolínea cliente. |
| OCC | Función interna de control operacional observada en Private Web y en el flujo de revisión. | Un rol único y definitivo; la taxonomía fina aún no está cerrada. |
| Aerolínea cliente | Organización cliente con perfil canónico `Airline`, identificada por su código ICAO y, si lo tiene, por su IATA. | El texto libre de una solicitud previa a afiliación. |
| Agente de rampa | Persona con perfil laboral `RampAgent`, scopes y habilitaciones operativas. | Cuenta, rol IAM o asignación concreta. |
| Tenant | Organización que delimita los datos del cliente; para el portal se deriva de una membresía autenticada. | `airlineId` enviado por el navegador. |

## Identidad y acceso

| Término | Significado | Invariante clave |
| --- | --- | --- |
| Persona | Identidad humana y datos de contacto/identificación. | Puede tener como máximo una cuenta y un perfil de agente en el modelo actual. |
| Cuenta | Credencial ASP.NET Identity vinculada uno-a-uno con una persona. | Tiene ciclo de vida e invitación propios. |
| Organización | Entidad jurídica/operativa: AVIAM o cliente aerolínea. | La membresía, no el frontend, vincula una cuenta al tenant. |
| Membresía | Relación temporal cuenta-organización con tipo, estado y job title. | No equivale a rol ni a scope de estación. |
| Rol | Agrupación de acceso asociada a un portal y `userType`. | No equivale a departamento, posición operativa o cargo. |
| Permiso | Capacidad autorizable asignada a roles. | Un texto de botón o menú no concede permiso. |
| Scope de estación | Concesión revocable de una cuenta sobre una estación. | El scope laboral del agente usa tablas separadas. |
| Empleado | Expediente de Gestión Humana de una persona de AVIAM: departamento, puesto, estaciones, ingreso y baja. | Solo un empleado activo recibe cuenta interna; la baja la desactiva para siempre. |
| Puesto | Cargo del organigrama de un departamento, mantenido por Gestión Humana. | No es un perfil de acceso ni una posición operativa de rampa. |
| Perfil de acceso | Plantilla de permisos de un departamento que decide qué ve una cuenta en ELEVANT. | Lo administra el departamento; no cambia el puesto. |
| Requisición de personal | Petición de un departamento a Gestión Humana de N personas para un puesto. | Lo cubierto es una proyección de los empleados enlazados. |
| Refresh token | Secreto rotativo que renueva el access token de 15 minutos sin volver a iniciar sesión; solo se guarda su SHA-256 ([ADR-0021](../../docs/adr/0021-rotating-refresh-tokens.md)). | Reutilizar uno ya rotado revoca toda la familia. |
| Código de verificación | Código de 6 dígitos enviado al correo en cada inicio de sesión del portal; 10 minutos y 5 intentos ([ADR-0022](../../docs/adr/0022-portal-email-verification.md)). | Solo aplica a cuentas del portal, no a las internas. |
| Correo descartado | Correo de la cola que ya no se envía porque su enlace o código venció, otro lo reemplazó o se cerró la invitación; pierde el cuerpo y guarda el motivo (`Discarded`). | Un correo fallido (`Failed`), que no se pudo enviar después de los reintentos. |
| Subventana | Función dentro de otra pantalla (Solicitudes de clausura dentro de Servicios) con permiso propio. | Concederla concede «Ver» de la pantalla que la contiene. |

## Geografía y catálogos

| Término | Significado | Relación |
| --- | --- | --- |
| Aeropuerto | Lugar canónico con códigos IATA/ICAO, ciudad y país. | En v1 una estación referencia un aeropuerto y el índice actual hace esa relación uno-a-uno. |
| Estación | Unidad operativa de AVIAM en un aeropuerto, con código y zona IANA. | Enmarca scopes, turnos, equipos y operaciones. |
| Terminal | Subdivisión de una estación. | Agrupa stands y scopes laborales. |
| Stand o posición física | Lugar donde se atiende la aeronave; puede pertenecer a una terminal. | No es `OperationalPosition`, que es un puesto/función. |
| Ocupación de posición | Proyección: «ocupada» si la aeronave de la asignación activa ya llegó (hora real de llegada); «planificada» si aún no llegó; «libre» sin asignación activa. | El color del mapa del prototipo. |
| Distrito municipal | Subdivisión de un municipio según la DGII y la ONE (p. ej. Pedro Sánchez, en El Seibo). | Un municipio o una sección. |
| Definición de servicio | Catálogo de servicios y unidad de cobro predeterminada; lo gestiona Contratos. | No es una línea solicitada, contratada ni ejecutada. |
| Unidad de cobro | Cómo se mide un servicio o cargo (operación, hora, pasajero…); catálogo `ref.billing_units` que mantiene Finanzas. El ciclo comercial guarda su código (`operation`), no su nombre. | Un precio o un recargo. |
| Tipo de equipo | Clase de recurso; puede exigir habilitación. | No es un activo físico. |
| Activo de equipo | Unidad identificada y ubicada en una estación. | Se asigna temporalmente a una operación. |
| Tipo de aeronave | Catálogo de fabricante/modelo con código ICAO. | La matrícula pertenece al turnaround concreto. |
| Posición operativa | Puesto o función de trabajo; puede exigir habilitación/equipo. | No es stand, rol IAM ni `AssignmentRole`. |

## Vuelo y operación

| Término | Significado | Invariante clave |
| --- | --- | --- |
| Turnaround | Escala aeroportuaria de una aerolínea en una estación y fecha; raíz de planificación. | Tiene como máximo un tramo de llegada y uno de salida. |
| Tramo de vuelo | Llegada o salida con número, ruta, tiempos y procedencia. | No representa por sí solo toda la escala. |
| Operación en tierra | Ejecución asociada uno-a-uno al turnaround. | Posee asignaciones, servicios, hitos, checklist, incidentes y revisión. |
| Asignación de stand | Relación temporal turnaround-stand. | Sólo una asignación abierta por turnaround en el modelo. |
| Asignación de agente/equipo | Relación temporal entre la operación y un recurso. | Sustituye arrays duplicados dentro de un vuelo mock. |
| Servicio de operación | Línea ejecutable con definición obligatoria, tarifa contractual opcional y columnas snapshot de cobro. | La FK opcional no demuestra la procedencia ni coherencia del snapshot; esas reglas siguen pendientes. |
| Hito | Momento planeado, estimado o real dentro de una operación. | Sus estados no son los estados del turnaround. |
| Incidente | Evento operacional reportado con severidad, estado y resolución. | Evidencia binaria asociada sigue diferida. |

## Checklist y revisión

| Término | Significado |
| --- | --- |
| Template de checklist | Definición nombrada y versionable del procedimiento. |
| Versión de checklist | Snapshot temporal publicable con ítems ordenados. |
| Checklist de operación | Instancia de una versión aplicada a una operación. |
| Respuesta | Valor `Ok`, `NotApplicable` o `NotOk`, con nota y agente respondiente. |
| Envío de operación | Revisión numerada del checklist enviada a control. |
| Decisión de revisión | Resultado `Approved` o `Returned` emitido por una cuenta revisora. |

Las unicidades impiden duplicar una respuesta por pareja checklist-ítem y una revisión por pareja operación-número. No prueban que el ítem pertenezca a la versión del checklist ni que el checklist de un envío pertenezca a la misma operación. Un envío tampoco captura las respuestas como snapshot; por ello, otra revisión no preserva por sí sola el contenido anterior.

## Comercial y solicitudes

| Término | Significado | No confundir con |
| --- | --- | --- |
| Solicitud comercial | Solicitud de afiliación o servicio adicional que puede preceder a una aerolínea canónica. | Solicitud operativa ligada a una estación/turnaround. |
| Solicitud operativa | Petición de servicio durante la operación, con solicitante, necesidad y resolución. | Afiliación o negociación contractual. |
| Confirmación del representante | Registro de Contratos sobre quién confirmó, cuándo y por qué canal que el representante habla por la aerolínea; aprobar la solicitud la exige ([ADR-0037](../../docs/adr/0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md)). | La declaración de autoridad que marca el representante en el formulario público. |
| Aerolínea propuesta | Aerolínea que el solicitante describe cuando no figura en el listado; vive en la solicitud hasta que Contratos la vincula a una ficha o crea una. | Una ficha del catálogo de aerolíneas. |
| Contrato | Acuerdo de una aerolínea, opcionalmente originado en una solicitud comercial. | Una versión concreta del acuerdo. |
| Versión de contrato | Vigencia, moneda, términos, estaciones y tarifas aprobables. | El estado general del contrato. |
| Tarifa de servicio | Precio/unidad/mínimo de un servicio en una versión. | El snapshot guardado en una ejecución. |
| Tarifa base | Precio de referencia de Finanzas por servicio, moneda y estación opcional; versión publicada e inmutable. | La tarifa negociada de un contrato. |
| Cargo | Recargo o cargo adicional del catálogo de Finanzas (nocturno, tiempo extra…) con método y regla de cantidad. | Un ajuste manual de Finanzas. |
| Cargo de demora | Cargo DELAY por la demora de la llegada, cobrado por hora con minutos de gracia (regla `ArrivalDelay`). No existe una «tabla de tiempo de mora». | La unidad «hora», que solo dice cómo se mide. |
| Huella del contrato | SHA-256 del contenido canónico de una versión (partes, vigencia, estaciones, tarifas y términos); cada firma registra la huella que aceptó. | Un hash del archivo PDF. |
| Firma de contrato | Aceptación de una parte (AVIAM o la aerolínea) sobre una versión aprobada, con nombre, cargo, fecha y huella; solo de inserción. | Una firma electrónica certificada. |
| Marca de cargo | Tipo de cargo que el agente de rampa aplica a un servicio, sin precio ni cantidad. | La línea de cargo valorada en la factura. |
| Ajuste | Historia: línea manual, positiva o negativa y con motivo, que Finanzas agregaba a una prefactura en borrador; salió del producto con la prefactura en la fase 4. Hoy una factura emitida se corrige con una nota de crédito o débito. | Una nota de crédito sobre una factura emitida. |
| Listo para Finanzas | Regla del servidor que decide si un borrador puede enviarse a Finanzas, con un código por cada causa pendiente. | La aprobación de Finanzas. |
| Descartar un borrador | Cerrar sin borrar una versión que no prosperó: queda `Rejected` y, si el contrato nunca se activó, el contrato se termina. | Una devolución de Finanzas, que regresa la versión a `Draft`. |
| Enmienda | Versión nueva de un contrato activo o suspendido, creada desde la última versión aprobada con su propio «Vigente desde»; vuelve a pasar por Finanzas y por las firmas. Desde la fase 2 parte de la versión que rige (ver abajo). | Una renovación, que abre la vigencia siguiente. |
| Aprobación de Finanzas | Revisión que aprueba una versión de contrato enviada por Contratos o la devuelve con motivo; el contrato se activa después, con ambas firmas y el permiso de operación. La aerolínea no ve el motivo de una devolución. | La aprobación de una entrega por OCC. |
| Ocultar del catálogo | Quitar «Visible al público» a un servicio: sale del catálogo público, pero sigue en los contratos y en OCC. | Dar de baja el servicio. |
| Dar de baja un servicio | Comando con motivo que saca el servicio del catálogo, de los contratos nuevos y de la operación; se rechaza mientras un contrato en vigor o en aprobación lo use. | Ocultarlo o aprobar su clausura. |
| Paquete retirado | Versión publicada de un paquete que Finanzas dejó de ofrecer (`Retired`): no se vincula a borradores y los contratos aprobados la conservan. | Un borrador de paquete descartado (`Discarded`). |
| Permiso de operación | Autorización de la autoridad aeronáutica (JAC) que la aerolínea envía desde el portal y Contratos verifica ([ADR-0024](../../docs/adr/0024-airline-permits-and-contract-lifecycle.md)). | Vigente, por vencer o vencido se calcula con la fecha; un contrato no se activa sin uno verificado y vigente. |
| Verificación en registro | Consulta de la aerolínea en Wikidata (o la copia de OpenFlights) por IATA/ICAO ([ADR-0023](../../docs/adr/0023-airline-public-registry-check.md)). | La verificación legal de Contratos. |
| Tasa de cambio | Tasa diaria USD→DOP registrada manualmente por Finanzas; las correcciones conservan historia. | Una cotización bancaria automática. |
| Nota de crédito | Reducción del saldo de una factura emitida, con motivo, idempotente y nunca mayor que el saldo. Sobre una factura E31 recibe su propio e-NCF simulado `E34`, con el ITBIS congelado por línea y su PDF; la nota de débito recibe `E33`. | Un reembolso de dinero o un reclamo de la aerolínea, que el sistema no tiene. |
| Factura e-CF simulada | Factura de crédito fiscal (tipo 31) que Finanzas emite directamente de operaciones aprobadas, con e-NCF, código de seguridad e ITBIS 18 % ([ADR-0035](../../docs/adr/0035-direct-invoicing-simulated-ecf.md)). | Un comprobante válido ante la DGII: dice «Simulación — sin validez fiscal». |
| Pago con tarjeta simulado | Pago del saldo completo de una factura desde el portal con una pasarela simulada; guarda solo marca y últimos 4 dígitos ([ADR-0036](../../docs/adr/0036-simulated-card-payment.md)). | Un cobro real: no se mueve dinero. |
| e-NCF | Número del comprobante e-CF simulado: `E31` y 10 dígitos consecutivos en la factura, `E34` en la nota de crédito y `E33` en la de débito. | El número interno `NF-…` de la factura o `TC-`/`TD-` de una nota, que se conserva. |
| Saldo | Total de la factura y sus notas de débito menos pagos y notas de crédito; su estado (pendiente, parcial, pagada, vencida o anulada) es una proyección. | Una conciliación bancaria. |

### Términos de la fase 2 del ciclo

Posterior al commit verificado de esta nota: estos términos describen el código
de la fase 2 «Pre-operación» (`50e7778f`;
[ADR-0038](../../docs/adr/0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md)).

| Término | Significado | No confundir con |
| --- | --- | --- |
| Versión que rige | La versión que fija precios, servicios, estaciones, recargos y paquetes de una fecha: una `Approved` firmada por ambas partes sobre la misma huella, una `Superseded` en las fechas que conservó o, como exención heredada, la primera versión aprobada de un contrato que ya salió de `Draft`. | Una versión que Finanzas aprobó y nadie firmó, que no cubre nada. |
| Segunda firma | La firma que completa la aceptación de ambas partes sobre la misma huella. Desde ella la versión rige y la anterior termina, a más tardar, la víspera de su inicio. | La aprobación de Finanzas, que ya no reemplaza nada. |
| Retirar una versión | Comando de Contratos que deja `Rejected`, con motivo, una versión aprobada que todavía no rige; una firma de una sola parte se anula en la auditoría y nunca se borra. | Descartar un borrador, que cierra una versión antes de la aprobación. |
| Terminación programada | Terminación con una fecha efectiva que respeta el preaviso firmado. `TerminatedOn` es el primer día sin cobertura; se puede cancelar antes de esa fecha, y el barrido la ejecuta. | Una terminación inmediata por incumplimiento o mutuo acuerdo. |
| Permiso revocado | Permiso de operación verificado que Contratos dejó sin efecto con motivo (`Revoked`). Conserva su verificación original y suspende los contratos activos que se quedan sin un permiso usable. | Un permiso rechazado, que nunca se verificó. |
| Representante del portal | Cuenta del portal que gestiona los usuarios de su aerolínea: la aprovisionada para la solicitud aprobada, hasta la primera designación, o quien designe el superadministrador. Firma contratos y envía el permiso JAC. | Un rol de departamento: es un grant de cuenta (`airline_portal.representative`). |
| Firmante del portal | Usuario del portal que un representante o el superadministrador marca para firmar contratos y enviar el permiso JAC (`airline_portal.signer`). | Un usuario del portal sin ese grant, que no firma ni envía permisos. |
| Día hábil | El día del calendario de la estación o, si la regla no tiene estación, de `America/Santo_Domingo` ([`BusinessCalendar`](../../backend/Elevant.Application/Common/BusinessCalendar.cs)). Lo usan, entre otras, las reglas de contratos, permisos y Gestión Humana; Finanzas lo adoptó en la fase 4 (ver abajo). | El día UTC, que de 20:00 a 23:59 en República Dominicana ya es el siguiente. |
| Liberación del agente | Lo que la baja, el traslado fuera de rampa, el paso a oficina, la desactivación del perfil o una ausencia aprobada le quitan al agente en la misma transacción: coberturas, asignaciones en las operaciones que no empezaron y turnos que no empezaron. | La aptitud de una asignación, que solo marca al agente y no libera nada. |
| Datos maestros | Terminales y posiciones de una estación, y los tipos de avión compartidos por todas, que OCC crea, edita y desactiva; nada en uso se desactiva y nada se borra. | Las estaciones, que solo crea el superadministrador. |
| Tablet compartida | Instalación de la app de rampa que pasa al agente que inicia sesión y se libera al cerrar la sesión; OCC la desvincula o revoca una perdida. | El binding, que es el registro de cada vínculo entre instalación y cuenta. |
| Feed simulado | Proveedor de vuelos determinista y sin red (`Simulated`), apagado por defecto, solo para los entornos Development o Test y activado únicamente por el overlay del arnés E2E. | AeroDataBox, el feed real que usa el VPS Development. |

### Términos de la fase 3 del ciclo

Posterior al commit verificado de esta nota: estos términos describen el código
de la fase 3 «La operación» (`f2d5c52c`;
[ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).

| Término | Significado | No confundir con |
| --- | --- | --- |
| Código de operación | Identificador legible de una escala manual o importada: `{ESTACIÓN}-{AAAAMMDD}-{NNN}`, numerado por estación y día local. Los `MAN-`, `EXT-` y `DEV-` ya emitidos se conservan. | El número interno de los formularios AVIAM (`PUJ000000123`). |
| Ocupación del agente | Las operaciones que cuentan para el tope de tres simultáneas: asignadas, en curso o devueltas. Una operación entregada, aprobada o cancelada ya no ocupa al agente. | La asignación como registro, que se conserva abierta después de aprobar. |
| Relevo | Paso explícito de una operación en curso o devuelta a otro agente elegible, con motivo; la operación conserva su estado y su evidencia. | La liberación, que solo vale antes del inicio y devuelve la operación a `Planned`. |
| Ajuste de turno | Cambio, con motivo y versión, de las horas de un turno de hoy o de un día futuro; el turno debe seguir cubriendo el trabajo del agente. | Programar otro turno el mismo día, que se rechaza (`shift_day_taken`). |
| Ventana de evidencia | El lapso en que una hora de la tablet es evidencia de la operación: desde el inicio o la llegada registrada, lo que ocurrió primero, hasta el cierre, con 2 minutos de tolerancia. | El límite fijo de 24 horas que tenían antes los hitos. |
| Evidencia tardía | Un hito, un daño o un dato del vuelo capturado antes de la entrega que llega mientras OCC revisa; se acepta, recalcula los recargos y obliga a OCC a releer. | Una corrección después de una devolución, que es una ronda nueva. |
| Orden de Servicio corregida | Versión que OCC guarda, con su motivo, cuando ajusta cargos o la facturación después de la firma; el PDF la imprime como «Corregida por OCC después de la firma». | Una Orden firmada de nuevo por la aerolínea y AVIAM. |
| Servicio facturable | Un servicio completado o en excepción, con cantidad ejecutada, que OCC no excluyó en la revisión ([`ServiceBillability`](../../backend/Elevant.Application/Finance/ServiceBillability.cs)). | Un servicio planificado o no realizado, que no se factura. |
| Exclusión de facturación | Decisión de OCC, con motivo y reversible mientras la revisión siga abierta, de no facturar un servicio en excepción con cantidad. | Quitar un recargo, que es un ajuste de cargos. |
| Reapertura de la revisión | Envío nuevo `PendingReview` que OCC crea, con motivo, sobre una aprobación de la que nada se facturó; se corrige y se aprueba en OCC, sin volver a rampa. | Una devolución a rampa, que pide al agente corregir y reenviar. |
| Aerolínea charter creada por OCC | Aerolínea mínima (organización `OCC-…`, OACI obligatorio e IATA opcional) que OCC da de alta para un charter; una aprobación comercial posterior la vincula. | Una aerolínea aprobada por Contratos con su contrato. |
| Reabrir la cotización | Paso de Finanzas, con motivo y versión, que devuelve a `Pending` el prepago confirmado de un charter para que la tablet agregue servicios; el monto y la referencia se conservan hasta la confirmación siguiente. | La confirmación del prepago, que cierra la cotización. |

### Términos de la fase 4 del ciclo

Posterior al commit verificado de esta nota: estos términos, y las filas
«Marca de cargo», «Ajuste», «Nota de crédito», «e-NCF», «Saldo» y «Día hábil»
de arriba, describen el código de la fase 4 «Facturación y cobro»
(`39a85a46`; [ADR-0035](../../docs/adr/0035-direct-invoicing-simulated-ecf.md),
[ADR-0036](../../docs/adr/0036-simulated-card-payment.md),
[ADR-0040](../../docs/adr/0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md)
y [Finanzas](finanzas-tarifas-cargos-y-cobros.md)).

| Término | Significado | No confundir con |
| --- | --- | --- |
| Por facturar | Las operaciones aprobadas por OCC con servicios facturables que todavía no tienen factura ni cierre sin cargo, de la más antigua a la más reciente, con todos sus motivos de bloqueo. | «Servicios aprobados», pantalla retirada. |
| Borrador interno | La prefactura que la emisión crea y emite dentro de una sola transacción serializable; nunca queda visible ni pendiente. Desde la revisión del bloque A (`8b61f567`), uno antiguo sin factura no bloquea: la emisión o el cierre sin cargo que lo encuentra lo anula y libera, con la auditoría `finance.invoicing.stale_draft_released`; solo uno con factura emitida que todavía retiene un servicio bloquea la operación con `pending_preinvoice`. | Una prefactura que la aerolínea aceptaba o disputaba, retirada del producto. |
| Cierre sin cargo | Cierre, con motivo, de operaciones cuya valoración es 0: deja el borrador interno en `NoCharge`, sin e-NCF ni correo, y no tiene reversa. | Una factura en 0, que nunca se emite (`zero_total`). |
| Día hábil de Finanzas | El día de `America/Santo_Domingo` que usa todo día de Finanzas: emisión, vencimiento, cobros, notas, reportes, tarjeta, correos y cuentas por pagar. | El día UTC o el de la estación. |
| Anulada | Estado proyectado (`Voided`) de una factura sin cobros que las notas de crédito llevaron a 0; si hubo algún cobro, queda «Pagada». | Anular una factura de proveedor, que es un cambio de estado con motivo. |
| Saldo a favor | Crédito de notas por encima de lo adeudado más los cobros sin aplicar, como el excedente de un prepago; el portal lo muestra en «Estado de cuenta». | Una devolución, que es un movimiento propio de Cobros. |
| Prepago aplicado | El cobro `PREPAGO {referencia}` de un charter aplicado una sola vez a su factura; mientras no se aplique, Finanzas lo corrige con motivo. | El pago con tarjeta del resto del saldo. |
| Factura de proveedor anulada | Un borrador, una rechazada o una aprobada sin aplicaciones activas que Finanzas deja `Voided` con motivo; libera el NCF para registrarlo de nuevo. | Rechazar, que permite devolver la factura a borrador para corregirla. |
| Reverso de pago | Fila vinculada e inmutable que revierte una aplicación de un pago a proveedor o anula el pago, con motivo y `finance.payables.reverse`. | Borrar o editar el pago. |
| Segregación de funciones | Regla por persona: quien crea o envía una factura de proveedor no la aprueba, y quien la aprueba no registra ni aplica pagos contra ella (`segregation_of_duties`). | Un permiso del catálogo. |
| Escalamiento del gasto | Revisión de un gasto por un administrador de Finanzas (etapa `Escalation`) cuando el departamento no tiene otro administrador elegible; la aprobación final la da otra persona. | La aprobación final de Finanzas. |

## Integración y trazabilidad

| Término | Significado |
| --- | --- |
| Dispositivo móvil | Instalación registrada con plataforma, versión, última actividad y revocación. |
| Binding | Registro temporal separado que vincula dispositivo y cuenta; sólo uno puede permanecer no cerrado por dispositivo. |
| Recibo de comando | Registro separado que referencia dispositivo y cuenta y deduplica por dispositivo-clave, con hash, estado y resultado/error sanitizable. No demuestra que esa cuenta sea el binding activo ni que el dispositivo esté vigente. |
| Auditoría | Entrada atribuible y correlacionable, con cambios de campos separados. |
| Outbox | Mensaje persistido con evento, payload, fecha de proceso, intentos y último error para publicación transaccional posterior; no tiene campo de resultado ni es chat. |
| Read model | Proyección calculada como KPI, cobertura, elegibilidad, vencimiento o contador; no tabla autoritativa por defecto. |

## Vocabulario que sigue siendo de prototipo

Los departamentos `ADMIN_OCC`, `GESTION_HUMANA`, `CONTRATOS` y `FINANZAS`, los roles detallados de las interfaces, los estados descriptivos de vuelo del Mobile Agent y los objetos de factura/documento/notificación de Public Web expresan necesidades de UX. No amplían automáticamente los enums del dominio, la autorización ni el esquema.

Cuando un término de interfaz contradiga este glosario, conserva ambos como evidencia de una pregunta abierta; no renombres el modelo sin una decisión, migración y contrato coordinados.

## Relacionados

- [Índice de dominio](README.md)
- [Entidades y relaciones v1](entidades-y-relaciones-v1.md)
- [Personal, roles y departamentos](personal-roles-y-departamentos.md)
- [Tiempo, estados y trazabilidad](tiempo-estados-y-trazabilidad.md)

## Fuentes

- [Modelo de base de datos v1](../../docs/architecture/database-v1.md)
- [Inventario del esquema](../../docs/database/schema-v1.md)
- [Enums de identidad](../../backend/Elevant.Domain/Enumerations/IdentityEnums.cs)
- [Enums operativos](../../backend/Elevant.Domain/Enumerations/OperationsEnums.cs)
- [Enums de personal y comercial](../../backend/Elevant.Domain/Enumerations/WorkforceCommercialEnums.cs)
