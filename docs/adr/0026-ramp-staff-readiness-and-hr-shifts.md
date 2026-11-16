# ADR-0026: Gestión Humana programa turnos, «¿Puede operar?» y turnos del agente en la tablet

## Estado

Accepted — 2026-11-03.

## Contexto

Fase 2 del ciclo operativo, bloque 2 (personal listo). Gestión Humana ya registraba empleados,
perfiles de rampa, carnets, habilitaciones y solicitudes de disponibilidad, y OCC aplicaba las
reglas de elegibilidad al asignar un agente a un vuelo (`OccAgentEligibilityPolicy`). Faltaban
tres piezas:
- Nadie programaba turnos fuera de OCC: la escritura de `hr.shift_assignments` era «transicional,
  solo OCC», y Gestión Humana solo consultaba el roster.
- Gestión Humana no veía qué le faltaba a un agente para poder operar hasta que OCC intentaba
  asignarlo y aparecían los motivos de inelegibilidad.
- El agente no veía en la tablet sus turnos ni el vencimiento de sus documentos.

## Decisión

### Turnos programados por Gestión Humana

- Permiso nuevo `human_resources.schedules.write` («Programar turnos»).
  `HumanResourcesShiftWritePolicy` autoriza a ese permiso o al de OCC
  (`operations.planning.assign`), siempre personal interno de AVIAM con alcance de estación.
- Se mantiene `PUT human-resources/shifts/{id}` (idempotente por ID, un turno por agente y día) y
  se añade `DELETE human-resources/shifts/{id}` para turnos de hoy en adelante. Los pasados son
  historial y responden 409; borrar dos veces responde igual.
- **Editor semanal** en Horarios: una fila por agente, una celda por día, las mismas plantillas
  horarias que OCC y «Copiar semana anterior», que solo llena días libres y futuros.

> **Actualización (7 de noviembre de 2026).** Quitar un turno acepta la versión y una
> `Idempotency-Key`, y se rechaza si su día ya pasó según el calendario de la estación
> (`shift_in_past`) o si el agente tiene en él una cobertura o una operación asignada
> (`shift_in_use`). No se registra un turno sobre una ausencia aprobada
> (`shift_on_approved_absence`), y «Copiar semana anterior» omite las ausencias y a los agentes
> que ya salieron. La baja, el traslado, la desactivación del perfil y una ausencia aprobada
> liberan las coberturas, las operaciones no iniciadas y los turnos del agente. Una ausencia
> aprobada se cancela o se acorta con motivo. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

> **Actualización (8 de noviembre de 2026).** Gestión Humana y OCC ajustan las horas de un turno
> de hoy o de un día futuro con un solo comando, `PATCH human-resources/shifts/{id}`, con motivo,
> la versión leída y una `Idempotency-Key`. El turno debe seguir cubriendo las coberturas y las
> operaciones del agente (`shift_uncovers_work`) y no cambia si su asistencia ya está validada
> (`attendance_validated`). Si OCC programa un segundo turno el mismo día, la API responde
> `409 shift_day_taken` y Planificación ofrece «Ajustar turno del día»; Gestión Humana tiene
> «Ajustar horario» en el editor semanal. Ver
> [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).

### «¿Puede operar?»

`GET human-resources/ramp-profiles/readiness` (`human_resources.ramp_profiles.read`) evalúa por
agente, para hoy, las mismas condiciones que OCC usa por vuelo (`RampAgentReadiness`):
- bloquean: perfil activo, cuenta de la tablet activa, rol `RAMP_AGENT` del portal móvil,
  membresía de AVIAM, estación compartida entre el perfil y la cuenta, terminal, carnet
  aeroportuario, licencia de rampa y al menos una habilitación vigente;
- avisan sin bloquear: documentos que vencen en 30 días o menos;
- informan: turnos de los próximos 14 días y ausencias aprobadas, que dependen del día.

Se muestra en «Agentes de rampa» y como etiqueta en cada fila del editor de turnos.

> **Actualización (7 de noviembre de 2026).** «¿Puede operar?» y los documentos usan el día hábil
> de la estación, no el día UTC. Gestión Humana recibe un aviso
> `HumanResources:DocumentExpiryNoticeDays` días antes de cada vencimiento (30 por defecto), y OCC
> ve en Planificación qué agente asignado ya no está apto
> (`GET occ/planning/assignment-readiness`). Nada se libera solo. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

### Turnos y documentos del agente

`GET ramp/me/schedule?from&to` (rango de hasta 31 días) devuelve los turnos y los documentos
vigentes del agente detrás de la cuenta (`RampOperationsAccess`). La tablet muestra
«Mis turnos y documentos», de solo lectura, con los próximos 14 días; se actualiza con las
señales `hr_shifts`, `hr_permits` y `hr_qualifications`.

### Limpieza

El menú de Gestión Humana deja de mostrar contadores fijos de ejemplo (alertas de cobertura,
vencimientos y avisos que no venían de la API).

## Consecuencias

- La programación diaria pasa a Gestión Humana; OCC conserva la creación del turno que necesite
  un vuelo puntual.
- `coverage_requirements` sigue sin uso: la cobertura por estación queda pendiente.
- Sin cambios de esquema.
