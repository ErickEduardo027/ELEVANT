# Solicitud y aprobación de acceso móvil de rampa

Estado: plan de implementación de un tramo aditivo en Development. Continúa el diseño aprobado de entrevistas de Gestión Humana; no autoriza merge, promoción ni cambios en Production.

## Evidencia actual

- `RampProfilesPanel` guarda el perfil laboral, sus estaciones y terminales, pero no crea una solicitud ni una cuenta. Su texto debe permanecer en «sin cuenta vinculada» hasta que exista una solicitud real.
- `EfGovernanceStore.CreateUserAsync` es la única ruta de creación de cuenta móvil de un perfil. Exige Superadministración, perfil activo, rol `RAMP_AGENT` y alcance de estación; concede los grants iniciales en una transacción serializable.
- `GovernanceSnapshot.RampProfiles` permite seleccionar un perfil sin cuenta, pero no registra quién pidió el acceso, cuándo, su decisión ni la relación con la cuenta creada.
- El feed durable de cambios de cuenta ya puede invalidar las vistas de `ramp_profiles`; la nueva bandeja debe emitir una pista dirigida a Superadministración.

## Contrato objetivo

1. Gestión Humana solicita acceso para un perfil activo sin cuenta mediante una clave de intención UUID. La API devuelve la misma solicitud ante un reintento idéntico; si ya hay una pendiente para el perfil no duplica la intención. No se introduce correo ni contraseña en la solicitud.
2. Gestión Humana ve estado `Pending`, `Rejected` o `Fulfilled` asociado al perfil. «Sin cuenta» no equivale a «pendiente»; la identidad y el alcance de cuenta efectivos se siguen derivando de IAM.
3. Superadministración ve una bandeja de solicitudes, puede rechazarlas con motivo y puede aprobar una pendiente introduciendo correo y contraseña temporal. La aprobación crea la cuenta `RAMP_AGENT`, la membresía y los grants de estación con las validaciones existentes y cierra la solicitud en la misma transacción. No envía invitación automática.
4. Al aprobar se revalidan perfil activo, estaciones vigentes, ausencia de cuenta y versión de la solicitud. Una actualización de perfil por Gestión Humana nunca amplía grants de una cuenta ya aprobada. Un rechazo no modifica el perfil. Una nueva solicitud posterior a rechazo es explícita y auditada.
5. La solicitud y decisión conservan identidad del actor e instantes UTC. Se evita guardar contraseñas, correos innecesarios o documentos en la tabla de solicitud. La respuesta HTTP no devuelve contraseña ni trazas internas.

## Secuencia RED → GREEN

1. Añadir prueba SQL de solicitud repetida, autorización por rol, concurrencia, rechazo, aprobación y no escalación de estaciones. Cubrir que un perfil sin solicitud no aparece como pendiente.
2. Añadir entidad `hr.ramp_mobile_access_requests`, configuración EF, índice único filtrado para una pendiente por agente y migración generada con `database/DevelopmentDB/scripts/add-migration.ps1`. Revisar `Up`, `Down` y snapshot; no añadir DML de negocio.
3. Exponer `POST /api/v1/human-resources/ramp-profiles/{id}/access-requests` y lectura aditiva de estado. Añadir `GET` y decisión restringida en Gobernanza; incorporar el ID de solicitud opcional a la creación de usuario móvil para cerrar solicitud y cuenta atómicamente. Añadir auditoría y pistas durables.
4. Añadir acción explícita en Gestión Humana y bandeja en Superadministración. Conservar la intención ante resultado de red incierto, revalidar por feed/foco/reconexión y ocultar datos si se pierde acceso. Ninguna pantalla afirma que un correo fue enviado.
5. Regenerar OpenAPI y cliente, actualizar README/Vault, ejecutar suites backend/frontend, prueba SQL, build y comprobación de secretos. Describir el orden DB → API → AVIAM Web para una futura promoción controlada del operador.

## Fuera de este tramo

No se implementan invitaciones por correo, recuperación de contraseña, cambio de roles, aprobación masiva, Production ni mutaciones del VPS. La cuenta sigue usando el cambio obligatorio de contraseña ya existente.
