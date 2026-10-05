# Acceso móvil solicitado por Gestión Humana: ejecución

> Continuación del diseño de entrevistas aprobado. Este tramo es aditivo para Development; no promueve ni modifica el VPS automáticamente.

## Contrato y persistencia

1. Añadir `RampMobileAccessRequest` a `hr` con identificador público UUID usado como clave de intención, perfil, actor solicitante, estado, decisión (actor, fecha, motivo) y cuenta creada. Índices únicos sobre UUID y sobre un único estado `Pending` por perfil. No almacenar correo ni contraseña.
2. Exponer `IRampMobileAccessRequestStore`: listar el estado por perfil a G.H., listar bandeja a Superadmin, solicitar con UUID, rechazar con motivo. Autorizar en persistencia y no confiar en filtros de cliente.
3. Extender `CreateGovernanceUserInput` con `AccessRequestId` opcional. Cuando está presente, exigir `RAMP_AGENT`, perfil coincidente, solicitud pendiente y cerrar como `Fulfilled` con el ID de cuenta en la misma transacción serializable que crea usuario, membresía, grants y auditoría. La ruta anterior sin solicitud conserva compatibilidad.
4. Enviar invalidaciones durables a G.H. y Superadministración tras cada mutación. Reintentos del mismo UUID y decisión ya aplicada devuelven el estado existente sin duplicar efectos; reutilizar UUID con otro perfil produce conflicto.

## RED → GREEN por frontera

1. Prueba SQL: crear perfil sintético activo; solicitar; reintentar misma intención; bloquear segunda pendiente; comprobar que otro rol no puede solicitar ni leer. Confirmar que un perfil nunca solicitado aparece sin estado. Ver falla por ausencia de contrato antes de implementar.
2. Prueba SQL: rechazar con motivo; reintentar rechazo; permitir intención nueva; comprobar auditoría, timestamp y no alteración de perfil. Ver falla y luego implementar entidad, EF, store, migración y rutas de solicitud/rechazo.
3. Prueba SQL: aprobar vía `CreateUserAsync` con solicitud; comprobar cuenta RAMP_AGENT, grants de estación, estado `Fulfilled`, único usuario e idempotencia; probar perfil desactivado, solicitud ajena y versión obsoleta. Ver falla y luego modificar creación en transacción.
4. Pruebas de contrato HTTP/OpenAPI: rutas autenticadas, DTO sin secretos y códigos 400/403/404/409. Regenerar cliente con comando del repositorio y comprobar diff.
5. Pruebas React: G.H. distingue sin solicitud, pendiente, rechazada, satisfecha; petición conserva UUID ante respuesta incierta. Bandeja Superadmin habilita rechazo y creación solo para pendientes; revalida con feed/foco/reconexión. Ver RED y después implementar UI adaptada al diseño existente.

## Verificación y entrega

- Ejecutar test SQL con LocalDB y suites completas backend/frontend, build, contrato OpenAPI, validación Vault y revisión de migración/secretos.
- Actualizar `docs/workflows/ramp-agent-readiness.md`, README y Vault con estado y límites, sin declarar despliegue.
- Integrar solo mediante PR revisada y checks verdes. Si se autoriza merge, sincronizar `Development`, eliminar el worktree tras verificar contenido único y dejar checkpoint manual DB → API → AVIAM Web para el operador.
