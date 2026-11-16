# ADR-0017: Empleados, puestos y perfiles de acceso

## Estado

Accepted — 2026-10-09. Sustituye la sección «Altas y validación» de
[ADR-0015](0015-department-user-governance.md). El resto de ADR-0015 sigue
vigente: superadministrador único, administradores por departamento, catálogo de
permisos en código, plantillas y validación de Gestión Humana.

## Contexto

En el modelo de ADR-0015, el administrador de un departamento escribía a mano
el nombre y el correo de la persona en la solicitud de alta:

- La cuenta nacía con un `Person` cuya identificación era ficticia.
- Solo los agentes de rampa tenían datos laborales.
- Nada impedía dar acceso a alguien sin expediente de empleado.
- La baja de una persona no tenía una fuente única.

La revisión del flujo con el equipo (2026-10-08) separó tres conceptos que se
mezclaban bajo la palabra «rol»:

| Concepto | Dueño | Qué es |
| --- | --- | --- |
| Empleado | Gestión Humana | Expediente de la persona en AVIAM. |
| Puesto | Gestión Humana | Cargo del organigrama, por departamento. |
| Perfil de acceso | Administrador del departamento | Qué módulos y acciones ve en ELEVANT (las plantillas de ADR-0015). |

## Decisión

### Datos

- **`hr.employees`**:
  - Persona (única), número de empleado (único), departamento, puesto, fecha de
    ingreso y estado (`Active` o `Terminated`, con fecha, motivo y autor).
  - Historial en `hr.employee_assignments`, con una sola fila abierta.
  - Estaciones en `hr.employee_stations`.
  - La identificación real (`CEDULA`, `PASAPORTE`, `RESIDENCIA`, normalizada) y
    el correo corporativo viven en `iam.persons`.
- **`hr.job_positions`**:
  - Puestos por departamento, mantenidos por Gestión Humana.
  - `is_ramp_position` solo existe en Operations: el empleado recibe un
    `RampAgent` al registrarse.
  - El administrador del departamento elige la plantilla sugerida del puesto.
- **`hr.personnel_requisitions`**:
  - El departamento pide personal: puesto, cantidad y motivo.
  - Gestión Humana la atiende y la cierra (`Open` → `InProgress` → `Fulfilled`,
    o `Rejected` / `Cancelled` con motivo).
  - Las contrataciones se enlazan a la requisición; lo cubierto se calcula
    como proyección.
- **`iam.user_access_requests.employee_id`**: la solicitud apunta al empleado.
  Nombre, correo, número y puesto se guardan como copia tomada al solicitar.
- **`audit.audit_entries.department`**: atribuye la entrada a un departamento.

### Flujo

1. **Requisición.** El administrador del departamento pide personal (opcional).
2. **Registro del empleado.** Gestión Humana registra al empleado con su
   departamento, puesto y estaciones (`employees.manage`).
3. **Solicitud de acceso.** El administrador elige un empleado de su departamento
   sin cuenta activa. No escribe datos personales.
   - El perfil viene precargado desde el puesto y se puede cambiar.
   - Las estaciones deben estar a la vez en las del empleado y en las del
     solicitante.
   - Si el puesto es de rampa, se piden terminales y supervisor.
4. **Validación.** Gestión Humana valida.
   - La cuenta se emite para la misma persona del empleado.
   - Un empleado tiene una sola cuenta: tras un traslado o una nueva solicitud,
     la misma cuenta se reaprovisiona (rol, asignación, permisos y estaciones).
5. **Traslado** (`employees.terminate`):
   - Desactiva la cuenta e invalida sesiones.
   - Revoca alcances y cancela solicitudes pendientes.
   - El departamento de destino solicita el acceso de nuevo.
6. **Baja** (`employees.terminate`):
   - Hace todo lo anterior y además desactiva el `RampAgent`.
   - Es definitiva: ninguna ruta (gobernanza, perfiles de rampa ni
     endpoints heredados) reactiva la cuenta de un empleado dado de baja.
   - Nadie se da de baja a sí mismo ni al superadministrador.
7. **Superadministrador.** Nombra administradores directamente, pero siempre
   desde un empleado registrado. Ya no crea sub-usuarios.

> **Actualización (7 de noviembre de 2026).** El traslado también retira los
> roles del departamento de origen: ese departamento ya no reactiva ni edita al
> empleado (`employee_transferred`), y solo la solicitud del nuevo departamento,
> validada por Gestión Humana, le devuelve el acceso. La baja y el traslado fuera
> de rampa liberan las coberturas, las operaciones no iniciadas, los turnos y las
> tablets del agente, y se rechazan mientras tenga una operación en curso o devuelta para
> corrección (`agent_has_operation_in_progress`). El traslado y la baja también cancelan
> las solicitudes pendientes que había pedido esa persona, y no se valida una
> solicitud cuyo solicitante ya no administra el departamento. Las estaciones de
> un miembro salen de su expediente. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

### Auditoría y actividad

- Los inicios de sesión se auditan: `auth.session.created` y
  `auth.session.failed`, este último solo para cuentas existentes.
- **Atribución a un departamento.** Una entrada pertenece a un departamento si:
  - se escribió para él, o
  - su autor trabajaba en él en ese instante, según el historial de
    asignaciones.

  Las cuentas sin expediente usan su asignación actual.
- **Quién lee qué:**
  - el administrador lee la actividad de su departamento;
  - Gestión Humana, con `audit.read`, lee la trazabilidad de personas de todos
    los departamentos;
  - el superadministrador lee todo.
- **Paginación:** por cursor, con un máximo de 92 días por consulta.

### Permisos

Nuevos módulos de Gestión Humana:

- `employees.read|manage|terminate`
- `positions.read|manage`
- `requisitions.read|attend`
- `ramp_profiles.manage`: hasta ahora bastaba `read` para escribir perfiles de
  rampa.

Las acciones del departamento (requisiciones, actividad, perfil sugerido) son de
administrador, como las solicitudes de alta.

## Compatibilidad (expand/contract)

### Esta entrega

- La API acepta las dos formas de solicitud. Las solicitudes pendientes escritas
  a mano se siguen validando.
- `POST departments/{d}/users` queda marcado como obsoleto.
- Las cuentas anteriores aparecen en «Expedientes pendientes». Gestión Humana
  registra su identificación real y su puesto.

### Entrega posterior (contract)

- Rechazar la forma escrita a mano.
- Retirar la creación directa de miembros y los endpoints de alta móvil
  heredados.
- Exigir `employee_id` en las solicitudes nuevas.

> **Actualización (7 de noviembre de 2026).** Las escrituras de la gobernanza
> heredada (`POST` y `PUT` en `governance/roles` y `governance/users`) ya
> responden `410 legacy_governance_retired`, así que una solicitud móvil heredada
> solo se puede rechazar. `POST departments/{d}/users` sigue obsoleto y los
> demás puntos siguen pendientes. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

## Consecuencias

- **Fuente única:** Gestión Humana es la fuente de las personas y de su baja.
  Los departamentos conservan la decisión de qué ve cada persona en ELEVANT.
- **Datos de identidad:** el administrador del departamento ya no edita nombre ni
  correo. Esos datos se corrigen en el expediente.
- **Reversión de la migración:** `AddEmployeesPositionsRequisitions` se niega a
  revertirse cuando ya hay historia (bajas, traslados, requisiciones cerradas,
  solicitudes enlazadas o auditoría por departamento).
- **Fuera de alcance:** la autenticación sigue siendo local con JWT. Microsoft
  Entra ID queda fuera de esta decisión.
