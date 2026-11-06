---
id: dominio-gobernanza-por-departamento
title: "Gobernanza de usuarios por departamento"
type: architecture
area: domain
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-10-26"
verified_commit: "e49e58d39b3eae80bd0184581d9231268ef55f7b"
sources:
  - docs/adr/0015-department-user-governance.md
  - docs/adr/0019-menu-option-permissions-and-department-notifications.md
  - frontend/private-web/src/features/department-users/PermissionMatrix.jsx
  - database/DevelopmentDB/Elevant.Persistence/Identity/DepartmentNotificationWriter.cs
  - docs/adr/0017-employees-positions-and-access.md
  - backend/Elevant.Domain/Entities/Workforce/Employees.cs
  - backend/Elevant.Application/Abstractions/Identity/IEmployeeGovernanceStore.cs
  - backend/Elevant.Api/Controllers/HumanResourcesEmployeesController.cs
  - database/DevelopmentDB/Elevant.Persistence/Identity/EfDepartmentGovernanceStore.EmployeeAccess.cs
  - frontend/private-web/src/features/employees/EmployeesPage.jsx
  - backend/Elevant.Domain/Governance/DepartmentPermissionCatalog.cs
  - backend/Elevant.Domain/Entities/Identity/DepartmentGovernance.cs
  - backend/Elevant.Application/Identity/DepartmentAccess.cs
  - backend/Elevant.Application/Abstractions/Identity/IDepartmentGovernanceStore.cs
  - backend/Elevant.Api/Controllers/DepartmentGovernanceController.cs
  - database/DevelopmentDB/Elevant.Persistence/Identity/EfDepartmentGovernanceStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/DepartmentGovernanceConfiguration.cs
  - frontend/private-web/src/features/access/DepartmentAccessContext.jsx
  - frontend/private-web/src/features/department-users/DepartmentUsersPage.jsx
  - frontend/private-web/src/features/department-users/AccessValidationsPage.jsx
  - frontend/private-web/src/features/governance/GovernanceShell.jsx
tags:
  - identidad
  - autorizacion
  - departamentos
  - gobernanza
---

# Gobernanza de usuarios por departamento

Las cuentas internas de AVIAM se administran en dos niveles: un
superadministrador único y administradores por departamento. Gestión Humana
es dueña de las personas: solo un empleado registrado por ella puede recibir
acceso, y valida cada alta que piden los administradores. Las decisiones están
en [ADR-0015](../../docs/adr/0015-department-user-governance.md),
[ADR-0017](../../docs/adr/0017-employees-positions-and-access.md) y
[ADR-0019](../../docs/adr/0019-menu-option-permissions-and-department-notifications.md).

| Concepto | Dueño | Qué es |
| --- | --- | --- |
| Empleado | Gestión Humana | Expediente de la persona: identificación, departamento, puesto, estaciones, ingreso y baja. |
| Puesto | Gestión Humana | Cargo del organigrama de un departamento; los de rampa existen solo en Operaciones. |
| Perfil de acceso | Administrador del departamento | Plantilla o permisos que definen qué ve la persona en ELEVANT. |

## Niveles

```mermaid
flowchart TD
    ADM[Administrador de departamento] -->|requisición de personal| GH[Gestión Humana]
    GH -->|registra| EMP[Empleado con puesto y estaciones]
    SA[Superadministrador único] -->|nombra desde un empleado| ADMIN2[Administrador]
    ADM -->|solicita acceso para un empleado| REQ[Solicitud de acceso]
    EMP --> REQ
    REQ -->|valida con contraseña temporal| GH
    GH -->|cuenta de la misma persona| MEM[Usuario del departamento o agente de rampa]
    ADM -->|plantillas, puesto sugerido y permisos| MEM
    GH -->|traslado o baja| OFF[Cuenta desactivada]
```

| Nivel | Puede | No puede |
| --- | --- | --- |
| Superadministrador | Ver todos los departamentos, solicitudes y actividad; nombrar administradores desde un empleado registrado sin validación; gestionar usuarios de aerolíneas; convertir roles heredados. | Transferirse ni ser duplicado (índice único filtrado). Operar Finanzas u OCC. |
| Administrador | Todos los módulos de su departamento; pedir personal; solicitar acceso para sus empleados; elegir la plantilla sugerida de sus puestos; editar permisos y estaciones; desactivar, reactivar y restablecer claves de sus miembros; leer la actividad del departamento. | Crear administradores, personas o puestos; editar nombre o correo (son del expediente); gestionarse a sí mismo u otros administradores; conceder estaciones que no tiene el empleado o él mismo. |
| Miembro | Lo que su plantilla o sus permisos explícitos conceden. | Nada fuera de su departamento. |

## Permisos

Gestión Humana no programa turnos. `human_resources.schedules` solo concede
lectura, porque el OCC programa los turnos con `operations.planning.assign`.
Gestión Humana decide la disponibilidad con `human_resources.availability.decide`.

El catálogo vive en código (`DepartmentPermissionCatalog`) con el formato
`<departamento>.<opción>.<acción>`, por ejemplo `contracts.catalog.create` u
`operations.review.decide`.

- **Una opción por entrada del menú.** Cada opción del menú lateral es un
  módulo, con su sección; las funciones que viven dentro de una pantalla
  declaran su opción padre.
- **Columnas de la matriz.** Cada acción cae en una columna: Ver, Crear,
  Modificar, Eliminar u Otras acciones (aprobar, publicar, emitir, exportar,
  firmar…).
- **Ver se concede siempre.** Conceder cualquier acción concede también «Ver».
- **Subventanas.** Conceder una subventana (por ejemplo, Solicitudes de
  clausura dentro de Servicios) concede «Ver» de la pantalla que la contiene;
  prohibir esa pantalla prohíbe sus subventanas. La matriz ofrece por fila el
  selector rápido «Prohibido / Ver / Editar», con las casillas para el ajuste
  fino ([ADR-0019](../../docs/adr/0019-menu-option-permissions-and-department-notifications.md)).
- **Grants antiguos.** Los códigos anteriores a ADR-0019 (`*.manage`,
  `employees.terminate`, `attendance.record`…) se traducen al resolver el acceso,
  así que las plantillas guardadas siguen funcionando. Las plantillas (`iam.access_profiles`) se aplican en vivo: editar o
desactivar una plantilla cambia el acceso de sus miembros y rota su sello de
seguridad.

**Altas de la fase 1 del ciclo**
([ADR-0037](../../docs/adr/0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md)):

- `contracts.requests.cancel` cancela solicitudes comerciales;
- `contracts.drafts.delete` descarta borradores de contrato;
- `finance.packages.delete` descarta borradores de paquete y
  `finance.packages.retire` retira paquetes publicados.

`contracts.catalog.delete` se rotula «Dar de baja» y la verificación de
solicitudes, «Verificar aerolínea y representante». Los grants heredados
`commercial.requests.full` y `commercial.requests.write` incluyen las dos
acciones nuevas de Contratos, y el alias `finance.packages.manage`, las dos de
paquetes. No hacen falta migraciones: el catálogo vive en código.

El acceso efectivo se calcula en el servidor para cada petición. Private Web
sólo lo usa para mostrar u ocultar módulos y acciones (`GET governance/me/access`).

## Empleados, altas, traslados y bajas

1. El departamento puede pedir personal con una requisición (puesto, cantidad y
   motivo). Gestión Humana la atiende, la cubre o la rechaza con motivo.
2. Gestión Humana registra al empleado (`employees.create`): identificación
   real normalizada y única, número de empleado único, correo corporativo,
   departamento, puesto y estaciones. Un puesto de rampa crea su `RampAgent`.
3. El administrador elige un empleado de su departamento sin cuenta activa y
   solicita el acceso con un UUID propio. El tipo (web o rampa) sale del puesto,
   la plantilla viene precargada desde el puesto y las estaciones deben estar
   entre las del empleado y las del administrador.
4. Gestión Humana o el superadministrador la valida definiendo (o generando) la
   contraseña temporal, o la rechaza con motivo. Quien la envió no puede
   resolverla. La cuenta se emite para la misma persona del empleado y exige
   cambio de contraseña.
5. Un traslado (`employees.delete`) desactiva la cuenta, invalida sesiones,
   revoca estaciones y cancela solicitudes; el nuevo departamento solicita el
   acceso y la misma cuenta se reaprovisiona.
6. Una baja hace lo mismo y desactiva el agente de rampa; ninguna ruta reactiva
   la cuenta de un empleado dado de baja.

Las cuentas creadas antes de los expedientes aparecen en **Expedientes
pendientes**: Gestión Humana registra su identificación real y su puesto.

**Alta directa por el superadministrador.** Desde «Usuarios internos → Nuevo
usuario interno», el superadministrador registra el expediente y la cuenta en
un solo paso, sin solicitud ni validación de Gestión Humana. Puede crear un
administrador o un sub-usuario con permisos por opción y subventana. El alta
queda auditada como hecha por el superadministrador. Los agentes de rampa
siguen el flujo de solicitud.

## Notificaciones

Cada departamento con la opción «Notificaciones» recibe en pantalla las alertas
de lo que debe atender:

- **Gestión Humana:** altas por validar, requisiciones y disponibilidad.
- **Contratos:** solicitudes comerciales, comentarios y firmas de aerolíneas,
  clausuras, permisos enviados o por vencer, y cambios del ciclo del contrato
  (activación, suspensión, vencimiento y aviso a 30 días;
  [ADR-0024](../../docs/adr/0024-airline-permits-and-contract-lifecycle.md)).
  Desde la fase 1 del ciclo, también la cuenta del portal lista para enviar un
  borrador y las devoluciones y aprobaciones de precios de Finanzas
  ([ADR-0037](../../docs/adr/0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md)).
- **Finanzas:** contratos por aprobar, que solo recibe quien cubre todas las
  estaciones de la versión, y facturas pagadas con tarjeta
  ([ADR-0036](../../docs/adr/0036-simulated-card-payment.md)). Las alertas de
  prefacturas aceptadas o disputadas siguen en el código, pero el portal ya no
  ofrece esas acciones
  ([ADR-0035](../../docs/adr/0035-direct-invoicing-simulated-ecf.md)).

Solo las recibe quien también puede abrir la fuente; ver
[ADR-0019](../../docs/adr/0019-menu-option-permissions-and-department-notifications.md).

**Pruebas.** Cada tipo tiene una prueba SQL que comprueba quién la recibe y quién
no, el filtro por estación, la marca de leída, la reaparición como no leída de
la misma fuente y la señal del feed de cambios. Las shells reciben la opción
`observeNotifications`, de modo que sus pruebas cubren la campana con su contador,
el aviso emergente con «Abrir» y el cajón de notificaciones.

## Actividad

Los inicios de sesión se auditan. Cada departamento lee su actividad
(inicios de sesión, accesos y operación de su gente según el historial de
asignaciones); Gestión Humana con `human_resources.audit.read` lee la
trazabilidad de personas de todos los departamentos y el superadministrador
lee todo, por periodos de hasta 92 días.

## Compatibilidad

- Cuentas creadas antes del modelo: su rol de departamento equivale a
  administrador y `ramp.agent@` a miembro de Operaciones.
- Roles `CUSTOM_*`: operan como miembros de Contratos hasta que el
  superadministrador los convierte en plantilla.
- Los endpoints `ramp-mobile-access-requests` siguen respondiendo pero están
  deprecados.
- La API acepta todavía la solicitud con persona escrita a mano y la creación
  directa de miembros (obsoleta); una entrega posterior las retirará
  (expand/contract, ADR-0017).

## Relacionados

- [Identidad, tenancy y autorización](identidad-tenancy-y-autorizacion.md)
- [Personal, roles y departamentos](personal-roles-y-departamentos.md)

## Fuentes

- [ADR-0015](../../docs/adr/0015-department-user-governance.md)
- [ADR-0017](../../docs/adr/0017-employees-positions-and-access.md)
- [ADR-0019](../../docs/adr/0019-menu-option-permissions-and-department-notifications.md)
- [API de empleados](../../backend/Elevant.Api/Controllers/HumanResourcesEmployeesController.cs)
- [Acceso por empleado](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfDepartmentGovernanceStore.EmployeeAccess.cs)
- [Catálogo de permisos](../../backend/Elevant.Domain/Governance/DepartmentPermissionCatalog.cs)
- [Resolución de acceso](../../backend/Elevant.Application/Identity/DepartmentAccess.cs)
- [Store de gobernanza](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfDepartmentGovernanceStore.cs)
- [API de gobernanza](../../backend/Elevant.Api/Controllers/DepartmentGovernanceController.cs)
