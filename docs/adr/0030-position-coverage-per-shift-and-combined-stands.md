# ADR-0030: Cobertura de posiciones por turno y posiciones combinadas

## Estado

Accepted — 2026-11-04.

## Contexto

Fase 3 del ciclo operativo, bloque 2. En las entrevistas, José Pillier (encargado de OCC) describió cómo asigna OCC a los agentes de operaciones:
- por **posiciones y turno**, no vuelo a vuelo;
- con reglas claras de terminal, licencias, habilitaciones y antigüedad.

Además, el aeropuerto combina posiciones con un código alfa. Por ejemplo:
- la 9A o la 11A anulan la 10;
- la 23A limita la 25 a estrechos;
- la 30 y la 30A nunca se ocupan a la vez.

Y cambia la posición de un vuelo «al minuto».

Hasta ahora la asignación tenía estas limitaciones:
- un agente por operación;
- el turno se validaba en un instante;
- un cambio de posición solo avisaba al agente (ADR-0029);
- las posiciones combinadas existían solo como texto en el mapa.

## Decisión

### Modelo (migración aditiva `AddPositionCoverage`)

| Dónde | Qué guarda |
|---|---|
| `ref.terminals` | `max_stands_per_agent` (1–6; vacío equivale a 3) y `requires_bridge_qualification` |
| `ref.stands` | `has_boarding_bridge`, `is_remote` y `max_aircraft_size` (`Narrowbody`/`Widebody`; vacío admite cualquiera) |
| `ref.aircraft_types` | `size_category` (`Narrowbody`/`Widebody`) |
| `ref.stand_constraints` | «mientras X está ocupada, Y queda anulada» (`Cancels`) o «Y solo admite estrecho» (`NarrowbodyOnly`). Se desactivan, no se borran |
| `ops.position_coverages` y `ops.position_coverage_stands` | Agente, terminal, ventana UTC, mentor opcional, vehículo, si es refuerzo, y liberación con autor. La historia se conserva |

**Habilitación de puente:** es la habilitación vigente del tipo de equipo `BOARDING-BRIDGE`.

**Carnet y licencia:** el carnet aeroportuario vigente es el permiso `AirportId`. La licencia de conducir en rampa es el permiso `RampDriverLicense`.

### Reglas (`PositionCoveragePolicy`, función pura con pruebas unitarias)

| Regla | Código |
|---|---|
| No más posiciones que el máximo de la terminal | `too_many_stands` |
| Más de 2 posiciones exige licencia de conducir y vehículo | `driver_license_required`, `vehicle_required` |
| Terminal con puente o posición con puente exige la habilitación de puente | `bridge_qualification_required` |
| Carnet aeroportuario vigente | `airport_permit_required` |
| El turno cubre **toda** la ventana (por defecto, el turno completo) | `shift_not_covering` |
| Sin ausencia aprobada | `absent` |
| El agente no cubre otra ventana que se solape | `agent_overlap` |
| Menos de 3 meses desde la contratación exige mentor | `mentor_required` |
| El mentor tiene 3 meses o más, está activo y su turno cubre la ventana | `mentor_not_eligible` |
| Una posición ya cubierta solo la comparte la pareja aprendiz-mentor o un refuerzo marcado por OCC | `stand_taken` |
| La ventana dura entre 0 y 16 horas | `window_invalid` |

`StandConstraintPolicy` rechaza colocar un avión cuando:
- otra posición ocupada en la misma ventana anula esa posición, o esa posición anularía una ocupada (`stand_cancelled`);
- un avión ancho va a una posición limitada a estrecho (`stand_narrowbody_only`);
- se limitaría a un vecino que ya tiene un avión ancho (`neighbour_widebody`).

> **Actualización (7 de noviembre de 2026).** La cobertura también comprueba que el mentor no tenga una ausencia aprobada y que su carnet aeroportuario esté vigente (`mentor_absent` y `mentor_permit_required`). Con el tipo de avión que ahora aceptan el vuelo manual y la importación del feed, un avión ancho no entra en una posición limitada a estrecho (`stand_unavailable`). La importación aplica además las mismas reglas del mapa; el vuelo manual, solo la de tamaño. Desactivar desde la configuración una posición en uso responde `422` con la razón `stand_in_use`. Ver [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

### Comportamiento

**La cobertura**
- Se crea en una transacción serializable.
- Se audita: `occ.coverage.assigned` y `released`.
- Avisa `occ_planning` a OCC y `ramp_schedule` al agente y al mentor.
- Un rechazo responde **422** con `reasons`. El cliente solo conserva los códigos conocidos (`ElevantApiError.reasons`).

**El vuelo sigue al agente que cubre la nueva posición.**
- Ocurre cuando OCC o el aeropuerto cambian la posición de una escala cuya operación está asignada pero no iniciada.
- La operación pasa al agente cuya cobertura incluye la nueva posición a la hora del bloqueo planificado. Se prefiere una cobertura que no sea refuerzo.
- Se avisa a los dos: `assignment_released` al anterior y `operation_assigned` al nuevo.
- Se audita `occ.operation.reassigned_by_stand`.
- No se reasigna si el nuevo agente ya tiene 3 operaciones simultáneas.
- La primera asignación sigue en manos de OCC en Planificación, porque materializa los servicios del contrato.

**Liberación manual.** OCC puede liberar al agente de una operación asignada y no iniciada (`POST occ/planning/turnarounds/{id}/assignment/release`). La operación vuelve a `Planned` y se avisa al agente.

> **Actualización (8 de noviembre de 2026).** Una sola regla de ocupación (`OperationOccupancyRules`) limita al agente a 3 operaciones simultáneas, y al aprobar, la operación deja de ocuparlo a él y a la posición por su estado. Un cambio de posición reasigna la operación solo a un agente que cubra la nueva posición y sea elegible con todas las reglas de la asignación; si no lo hay y el anterior tampoco sigue siendo elegible, vuelve a `Planned` y OCC recibe `stand_change_unassigned`. La cobertura exige el alcance en la terminal (`terminal_scope_missing`), la cobertura y la liberación del agente aceptan una `Idempotency-Key` opcional, y una operación ya iniciada no se libera: se releva. Ver la sección 3 de [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).

**Mapa de posiciones.** Cada posición muestra:
- quién la cubre;
- si tiene puente;
- si está limitada a estrecho;
- qué posición ocupada la anula. Una posición libre anulada aparece inhabilitada, como alerta a OCC.

**Módulo `operations.coverage`** («Cobertura de posiciones»):
- `read`;
- `assign`, para asignar posiciones;
- `update`, para configurar posiciones, terminales y combinaciones.

**Tablet.** «Mis posiciones de hoy» (`GET ramp/me/coverage`) muestra:
- las posiciones y la ventana;
- el mentor o el aprendiz;
- el vehículo.

Se actualiza con `ramp_schedule`.

**Datos**
- El plano real de PUJ lo carga OCC desde Configuración.
- El seed de Development solo trae un ejemplo sintético: Terminal B con máximo 2 y puente, B01 y B02 con puente, `BOARDING-BRIDGE` y un A333 ancho.

> **Actualización (7 de noviembre de 2026).** OCC crea, edita y desactiva terminales, posiciones y tipos de avión en «Datos maestros», con el permiso nuevo `operations.master_data.*`; la configuración de cobertura conserva los atributos de las posiciones y las combinaciones. El superadministrador crea las estaciones. Nada en uso se desactiva y nada se borra. Ver [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

## Consecuencias

**Ventajas**
- OCC asigna como trabaja: por posiciones y turno.
- Las reglas son explícitas, están probadas y se explican en español.
- Las combinaciones imposibles se rechazan.
- El agente se entera de cada cambio.

**Pendiente**
- No hay asignación automática inicial desde la importación de AeroDataBox. La primera asignación sigue siendo manual en Planificación.
- El supervisor de rampa todavía no tiene un rol propio.
- El modelo de volumen (refuerzos de los sábados y 3 agentes por terminal de madrugada) existe, pero OCC lo marca a mano.
- El pre-uso del puente y la entrega de la llave por cobertura llegan en el bloque 3.
