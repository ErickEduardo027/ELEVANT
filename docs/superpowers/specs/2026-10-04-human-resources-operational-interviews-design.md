# Gestión Humana y documentación operativa: diseño de convergencia

Estado: aprobado para implementación en Development. Fuente: plan aceptado en la conversación del 4 de octubre de 2026, entrevistas del 15 y 17 de septiembre y entrevista operativa del 22 de mayo de 2026. Esta nota describe comportamiento objetivo, no funcionalidad ya desplegada.

## Resultado y fronteras

ELEVANT debe permitir que Gestión Humana prepare personal habilitado, que OCC programe y atienda vuelos con ese personal, y que el agente registre la ejecución una sola vez para que OCC, la aerolínea y Finanzas vean evidencia coherente. Todo usa la API versionada y una base lógica por entorno. La API impone rol, estación, terminal y organización; los clientes no autorizan por sí solos.

La implementación se divide en PR independientes y compatibles, con contratos y migraciones aditivos antes de actualizar clientes. Cada PR describe honestamente lo disponible. La aceptación final ocurre en Development con operador y checkpoints DB → API → clientes; no modifica Production. No hay merge ni promoción automáticos.

## Gestión Humana, gobernanza y turnos

- Gestión Humana crea y actualiza el perfil de agente —identificador de empleado, categoría, fecha de ingreso, estaciones, terminales y supervisor—, habilitaciones, permisos, ausencias y evidencia privada. Solicita el acceso móvil, pero Superadministración aprueba y vincula la cuenta y sus alcances. La interfaz distingue perfil, solicitud pendiente, cuenta activa y cuenta revocada; no anuncia invitaciones enviadas si no lo fueron.
- OCC es el único editor de patrones, turnos y programación diaria. Gestión Humana lee calendarios de 15 días y mes, comprueba vigencia y valida las incidencias de asistencia y horas extra que Operaciones registró con evidencia. El registro manual no se presenta como fichaje biométrico.
- Los seis horarios completos mencionados por Randy son plantillas provisionales editables: 07:00–16:00, 08:00–17:00, 11:00–20:00, 12:00–21:00, 15:00–00:00 y 23:00–08:00. Los cruces de medianoche conservan fecha y zona de la estación. No se inventan los otros patrones ni se presupone una pausa remunerada.
- La elegibilidad existente sigue siendo decisión del servidor: cuenta/perfil activos, alcance de estación y terminal, puesto, habilitación, permisos actuales, turno compatible, ausencia aprobada y ausencia de conflictos. Al asignar se muestra contexto y antecedentes. Como alerta provisional configurable en Development, señalar menos de 12 horas entre turnos o más de 48 horas acumuladas en siete días; no declararlas límites legales ni usarlas como veto automático.
- El dashboard, informes, auditoría y avisos de GH usan proyecciones de la API, paginación y estados vacío/error; jamás cifras sintéticas presentadas como actuales. Informes exportan el conjunto filtrado, no solo la página visible, a PDF y XLSX. Avisos de vencimiento son persistentes y pueden enviarse por SMTP si está configurado; sin proveedor permanecen pendientes, nunca «enviados».

## Documentos y ejecución por vuelo

La entrevista operativa distingue dos artefactos por vuelo en terminal A —reporte de vuelo y orden de servicio— y un tercero en terminal B —checklist del puente—. Los formularios exhibidos son evidencia de flujo, no esquema de base de datos ni prueba de que la app actual los implemente.

- El reporte de vuelo reúne verificaciones generales, hitos, tiempos, incidencias y observaciones del vuelo asignado. Los eventos se escriben de forma idempotente y auditable conforme ocurren; OCC ve su secuencia en vivo y puede recuperar eventos desde un cursor tras reconexión. Un reporte de actividades se deriva de estos datos: no se digita otra vez.
- La orden de servicio se deriva de servicios contratados y ejecutados, con tarifas históricas congeladas. El agente asignado debe firmar su versión. La aerolínea puede confirmar o disputar esa misma versión presencialmente en la tablet o posteriormente desde Public Web autenticado. Ambas vías registran identidad, instante, versión, hash y evidencia privada; no se afirma certificación jurídica de la firma.
- Sin firma de la aerolínea, la operación queda pendiente de validación del cliente. OCC puede aprobar su parte solo mediante excepción con motivo obligatorio, pero Finanzas no factura hasta confirmación del cliente. Una corrección crea nueva versión y requiere nueva conformidad; jamás sobrescribe evidencia firmada.
- El chequeo preuso del puente se registra por puente físico y comienzo/cambio de turno. Las comprobaciones de antes de llegada, antes de salida y después de salida se registran por vuelo si se usa puente. El contenido del puente visto en el formulario se versiona; el resto de equipos admite plantillas aprobadas por equipo y fase, sin fabricar preguntas no verificadas.
- Una operación sin puente no recibe preguntas de puente y puede completarse con reporte y orden. Se corrige la incompatibilidad actual entre el checklist opcional del móvil y el requisito universal de entrega de la API. Las operaciones y respuestas históricas conservan su plantilla y revisión.
- Solo una instalación del agente posee la edición activa de una operación; otra observa. OCC puede transferirla con auditoría. Los borradores offline se conservan, pero se revalidan antes de enviar y nunca sobrescriben una versión ajena.

## Comercial, revisión OCC y Finanzas

- Public Web conserva la selección de servicios del catálogo y valida el máximo de 20 también en la interfaz. Al programar manualmente un vuelo bajo contrato activo aplicable a la estación y fecha, OCC materializa una sola vez los servicios y precios congelados. No se presenta FlightAware ni un mapa planificado como telemetría real.
- Una aerolínea sin contrato puede presentar solicitud puntual; queda pendiente de aprobación por Contratos y Finanzas y de un acuerdo de vuelo firmado con precios congelados. No habilita atención inmediata ni elude la autorización actual.
- Una factura emitida sin pago registrado genera aviso a OCC y Finanzas; no bloquea automáticamente el servicio ni se etiqueta «vencida» sin fecha de vencimiento estructurada.
- Una diferencia temporal superior al umbral provisional de diez minutos se muestra a OCC y exige justificación para aprobar. No causa cobro automático. Finanzas puede proponer un cargo adicional antes de prefacturar solo si existe tarifa contractual aplicable; la aerolínea valida la orden corregida antes de facturar.

## Pruebas, entrega y exclusiones

Cada capacidad incorpora pruebas RED→GREEN de dominio, API, persistencia y cliente; migración de base vacía y actualización; OpenAPI y cliente generados; alcance por rol/estación/tenant; revisiones, concurrencia e idempotencia. La aceptación cruza terminal A sin puente, terminal B con preuso por turno, mezclas de servicios, ausencias, turnos nocturnos, documentos firmados/disputados, dos tablets y reconexión. Playwright y el emulador recorren sesiones reales con datos sintéticos en local y, después de aprobación de los PR y checkpoints del operador, en Development VPS.

Fuera de esta entrega: reclutamiento público, telemetría externa, Google Maps, reloj biométrico, facturación fiscal, certificación jurídica de firmas, chat departamental y Production. No se incorporan secretos, datos personales reales ni plantillas de equipo no verificadas al seed.
