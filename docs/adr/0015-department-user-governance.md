# ADR-0015: Gobernanza de usuarios internos por departamento

## Estado

Accepted — 2026-10-07. Sustituye la gobernanza plana en la que sólo el
superadministrador creaba usuarios internos y los permisos finos existían
únicamente para el módulo comercial (`commercial.*`, roles `CUSTOM_*`).

## Contexto

Hasta ahora cada cuenta interna tenía un rol y los departamentos eran sólo
códigos de rol (`ADMIN_OCC`, `GESTION_HUMANA`, `CONTRATOS`, `FINANZAS`). OCC,
Gestión Humana y Finanzas se autorizaban con comprobaciones de código de rol
repartidas por los stores. Nada impedía un segundo `SUPERADMIN`. Los agentes de
rampa nacían como perfil en Gestión Humana, que pedía el acceso móvil al
superadministrador.

AVIAM necesita una administración en dos niveles: un superadministrador único y
administradores por departamento que gestionen a su equipo con permisos por
módulo y acción, con Gestión Humana como control de altas.

## Decisión

- **Departamentos** (`HumanResources`, `Contracts`, `Operations`, `Finance`) son
  un enum de dominio y su catálogo de permisos
  (`<departamento>.<módulo>.<acción>`) está definido en código
  (`DepartmentPermissionCatalog`), no en filas sembradas: funciona igual en
  Production, que nunca se siembra.
- **Asignación** (`iam.department_assignments`): una por cuenta, con nivel
  `SuperAdministrator`, `Administrator` o `Member`. Un índice único filtrado
  garantiza un único superadministrador en base de datos; la gestión de usuarios
  rechaza conceder o retirar `SUPERADMIN`.
- **Acceso efectivo** se resuelve una vez por petición en `ActorContext`:
  - el superadministrador gobierna y conserva el acceso de Gestión Humana y
    Contratos que ya tenía; no opera Finanzas ni el OCC;
  - el administrador tiene todos los permisos de su departamento;
  - el miembro tiene los de su plantilla (`iam.access_profiles`) o sus permisos
    explícitos (`iam.account_permission_grants`);
  - una asignación sólo cuenta mientras la cuenta conserva el rol del
    departamento, y los roles sólo cuentan en su portal.
- **Compatibilidad**: las cuentas sin asignación derivan el mismo acceso de su
  rol (los roles de departamento son administradores) y los `CUSTOM_*` se
  tratan como miembros de Contratos con sus permisos comerciales traducidos.
  El superadministrador puede convertirlos en plantillas de Contratos.
- **Altas**: un administrador crea una solicitud (`iam.user_access_requests`,
  idempotente por su UUID). Gestión Humana la valida definiendo la contraseña
  temporal o la rechaza con motivo; nadie resuelve su propia solicitud. El
  superadministrador crea administradores y miembros sin validación. Los
  agentes de rampa los solicita Operaciones con su perfil operativo completo y
  nacen al validarse (persona, `RampAgent`, scopes y cuenta `RAMP_AGENT`).
- **Estaciones heredadas**: un administrador sólo concede estaciones que tiene.
- Toda decisión se audita (`governance.*`) y se anuncia por el feed de cambios
  de cuenta (`access_requests`, `department_users`); los clientes releen por
  REST.
- Los endpoints `ramp-mobile-access-requests` quedan deprecados (expand/contract)
  y la interfaz deja de usarlos.

## Consecuencias

- Las comprobaciones de autorización de Finanzas, OCC, Gestión Humana y
  Contratos usan permisos de acción (`finance.preinvoices.manage`,
  `operations.review.decide`, …) en vez de códigos de rol.
- Private Web carga `GET governance/me/access` y muestra sólo los módulos y
  acciones concedidos; el servidor sigue siendo la autoridad.
- Se retira `/espacio-de-trabajo`; los roles heredados abren Contratos.
- Cada cuenta interna pertenece a un solo departamento.
- La migración `AddDepartmentGovernance` sólo crea esquema; las asignaciones
  sembradas de Development las añade el seeder, de forma insert-only.
