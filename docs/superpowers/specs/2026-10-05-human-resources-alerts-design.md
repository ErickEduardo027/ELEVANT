# Alertas y avisos verificables de Gestión Humana: diseño

Estado: propuesta dentro del [diseño operativo de G.H.](2026-10-04-human-resources-operational-interviews-design.md). Requiere revisión antes del plan de implementación. No describe capacidad desplegada.

## Contexto y límites

La ruta actual de notificaciones de G.H. usa un arreglo en memoria del cliente y preferencias que se pierden al recargar. El contador del dashboard también procede de datos sintéticos. `OperationalNotification` pertenece al flujo OCC–agente y exige una operación; no representa una habilitación que vence ni un turno futuro. G.H. necesita un buzón durable por cuenta y estación, con lecturas persistentes, y señales provisionales de programación.

Una alerta de menos de 12 horas entre turnos o más de 48 horas programadas en siete días es una ayuda de planificación configurable en Development. No es dictamen legal, nómina, horas extra pagables ni impedimento automático para asignar. Se muestra la regla aplicada y sus datos de origen. Las horas realmente trabajadas solo se presentan cuando existe asistencia validada suficiente y una relación inequívoca con el turno; no se calcula a partir de un solo hito de vuelo.

## Evaluación de turnos

La API evalúa turnos confirmados del mismo agente en las estaciones a las que su perfil está asignado, no únicamente los visibles en la página actual. Convierte `WorkDate`, `StartsAtLocal` y `EndsAtLocal` a instantes con la zona IANA de cada estación; cuando el fin local precede al inicio, usa el día siguiente. Una hora local inexistente o ambigua por cambio de reloj produce estado «no evaluable» con motivo, sin ajustar silenciosamente la hora. Turnos simultáneos se señalan por separado y no se suman dos veces como tiempo trabajado.

El descanso se compara entre fin de un turno y comienzo del siguiente. La ventana de siete días incluye el día local consultado y los seis días anteriores; suma duración programada, sin descontar pausas no registradas. El umbral inicial es 12 horas de descanso y 48 horas programadas, con versión de configuración y fecha efectiva explícitas. La API devuelve evidencia mínima: identificadores de turnos, instantes, duración o descanso calculado, umbral y versión de regla. La UI no recalcula ni oculta que se trata de advertencias provisionales. Cuando la información necesaria falta, muestra «sin datos suficientes» y no «cumple».

`GET /api/v1/human-resources/schedule-warnings` acepta estación y rango de fechas locales validado, con un máximo de 30 fechas inclusivas y paginación estable. Solo una cuenta G.H. activa con rol BackOffice y alcance vigente puede consultar; la API filtra detalles de estaciones ajenas, incluso si un turno de allí participa en el cálculo de descanso. Si una alerta cruza estaciones, se presentan al usuario solo los elementos que su alcance permite y un indicador de evidencia restringida; no se revela nombre, estación ni identificador ajeno. La pérdida de acceso retira el snapshot del cliente. La respuesta privada lleva `Cache-Control: no-store`.

## Avisos persistentes

Una tabla propia guarda aviso, tipo, origen estructurado, estación, destinatario, instante de generación, versión de regla, estado activo/resuelto y lectura por cuenta. La identidad lógica `recipient + kind + source + occurrence/version` evita duplicados al reintentar o ejecutar el proyector varias veces. La resolución de la causa no borra el historial ni altera la lectura. Se conserva el vínculo a la fuente para abrir el módulo correspondiente tras volver a comprobar autorización. No se guardan cuerpos de correo ni datos sensibles innecesarios en el aviso.

La API materializa avisos por cambios confirmados de turnos, habilitaciones, permisos y cuentas, más una revisión periódica para fechas de vencimiento que avanzan sin cambios de datos. La misma lógica es idempotente en ambos caminos. Un evento de cambio se confirma en la misma transacción que su outbox; un trabajador recupera pendientes después de reinicios. La revisión periódica usa cursor y lotes acotados. Al cambiar la fuente, el siguiente cálculo crea o resuelve avisos de forma determinista; no deja contadores permanentes de una causa ya corregida.

`GET /api/v1/human-resources/notifications` ofrece página, filtros por estación, tipo, estado y lectura, `asOf` y conteo no leído calculado por servidor. `PUT /api/v1/human-resources/notifications/{id}/read` cambia solo la lectura de la cuenta autenticada y es idempotente; una cuenta ajena recibe 404. Las preferencias se guardan por cuenta con actualización parcial validada, incluidos 15, 30 o 45 días para anticipar vencimientos. El cambio de preferencia reevalúa avisos futuros sin reescribir sucesos históricos. Las acciones masivas exigen IDs acotados y fallan de manera explícita si alguno no pertenece a la cuenta; «marcar todo» usa un límite/cursor transaccional, no los elementos visibles de la página.

Las invalidaciones autorizadas anuncian que existe un cambio; el cliente relee la API al recibirlas, al volver a foco o al reconectar, con cursor recuperable si corresponde. No se transmiten datos personales en la pista. El dashboard consume un resumen API con `asOf` y no importa `mockData.js` para cifras presentadas como actuales.

## Entrega por correo y fallos

El buzón dentro de la aplicación es la entrega principal. Un proveedor SMTP opcional puede tomar avisos aptos desde un outbox con reintentos y estado `pending`, `sent` o `failed`. Sin configuración SMTP, el buzón sigue operativo y el estado permanece `pending`; la UI nunca afirma que salió un correo. El contenido de correo se minimiza y remite a la sesión autenticada para detalles. No se almacenan credenciales SMTP en el repositorio ni se exponen en respuestas.

Una falla de proyección o correo no revierte un turno ya confirmado. Se registran error clasificado, reintentos limitados, recuperación manual y métricas sin PII. La API expone el estado de frescura del resumen para no presentar una cuenta de alertas antigua como actual. No se envían avisos externos por escenarios sintéticos salvo configuración explícita de Development.

## Pruebas y entrega

Las pruebas abarcan medianoche, zonas distintas, cambio de reloj, turnos solapados, 11 h 59 min/12 h de descanso, 48 h/48 h 1 min programadas, siete días exactos, alcance de estaciones cruzadas, fuente revocada, reproyección idempotente, carrera de lectura, reinicio del worker y ausencia de SMTP. API, OpenAPI, cliente y UI comprueban 401/403/404, paginación, borrado de datos tras revocación, reconexión y que las acciones masivas no afecten a otra cuenta. Un recorrido Playwright con datos sintéticos abre, lee y resuelve un aviso y verifica que el dashboard coincide con la API.

La entrega usa migración aditiva y PR compatible, con promoción DB → API → AVIAM Web y checkpoints del operador. La nota de Vault y el README distinguen la advertencia provisional de una regla laboral. Reportes, firmas y checklist se entregan por subproyectos separados.
