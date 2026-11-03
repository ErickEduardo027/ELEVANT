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

### «¿Puede operar?»

`GET human-resources/ramp-profiles/readiness` (`human_resources.ramp_profiles.read`) evalúa por
agente, para hoy, las mismas condiciones que OCC usa por vuelo (`RampAgentReadiness`):
- bloquean: perfil activo, cuenta de la tablet activa, rol `RAMP_AGENT` del portal móvil,
  membresía de AVIAM, estación compartida entre el perfil y la cuenta, terminal, carnet
  aeroportuario, licencia de rampa y al menos una habilitación vigente;
- avisan sin bloquear: documentos que vencen en 30 días o menos;
- informan: turnos de los próximos 14 días y ausencias aprobadas, que dependen del día.

Se muestra en «Agentes de rampa» y como etiqueta en cada fila del editor de turnos.

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
