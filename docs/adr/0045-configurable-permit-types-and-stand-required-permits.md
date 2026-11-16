# ADR-0045: Tipos de carnet configurables y carnets exigidos por posición

## Estado

Accepted — 2026-11-16.

## Contexto

Los tipos de carnet y permiso eran un enum fijo (`PermitDocumentType`: `AirportId` y `RampDriverLicense`), y el catálogo de equipos de habilitación (`ref.equipment_types`) no tenía pantalla de alta. Erick pidió una sección **Gestión Humana › Configuración** con el alta y la edición de esas listas, y poder **exigir un carnet en una posición de la rampa**, para que OCC solo asigne a quien lo tenga vigente. Decidió que el requisito es **por posición**.

## Decisión

**1. Catálogo de tipos de carnet.**
- Tabla `ref.permit_document_types`: `id` bigint identity, `public_id` uuid, `code` (único, hasta 32 caracteres en mayúsculas, dígitos o guiones), `name` (hasta 160), `description` (hasta 500, opcional), `is_active`, `row_version` y las marcas de tiempo de siempre. La migración `AddPermitTypesAndStandRequiredPermits` es aditiva y no inserta datos.
- Los dos tipos del sistema siguen en código (`PermitDocumentTypes` en `Elevant.Domain`, con sus nombres «Carnet aeroportuario» y «Licencia de conducir en rampa»). Conservan todas sus reglas: elegibilidad, cobertura, avisos, «¿Puede operar?» y alertas de horario. Un código personalizado nunca puede coincidir con uno del sistema, sin importar mayúsculas (`code_taken`).
- `hr.airport_permit_cycles.document_type` ya era `nvarchar(32)`. La propiedad pasa de enum a texto sin cambio de esquema. Un ciclo nuevo acepta un código del sistema o el de un tipo personalizado **activo**; los índices por agente y tipo no cambian.
- Un tipo personalizado no bloquea a nadie por sí solo: solo cuenta en una posición que lo exige.
- El código de un tipo en uso (con ciclos, o exigido por una posición) no cambia (`code_in_use`). Un tipo que una posición exige tampoco se desactiva. Nada se borra.

**2. Equipos de habilitación.** Se crean, editan y desactivan en `ref.equipment_types`. El código `BOARDING-BRIDGE` lo usa la regla del puente (ADR-0030): no cambia ni se desactiva (`system_type_locked`). El código de un equipo con ciclos, activos u operaciones que lo usan no cambia (`code_in_use`).

**3. Carnets exigidos por posición.**
- Tabla `ref.stand_required_permits` con la posición (`stand_id`, FK `NO ACTION` a `ref.stands`) y el código del carnet, único por par.
- OCC fija la lista exacta de una posición con la versión que vio (`PUT occ/master-data/stands/{id}/required-permits`), o la de hasta 200 posiciones a la vez (`POST occ/master-data/stands/required-permits`). Ambos llevan Idempotency-Key y el permiso `operations.master_data.update`.
- Un cambio toca la posición, así que su versión avanza. Se audita como `occ.stand.required_permits_changed` y se anuncia a `occ_planning`.
- Al quitar un carnet se elimina su fila de la lista. El antes y el después quedan en la auditoría (`stand.required_permits`).
- Datos maestros devuelve en cada posición los carnets exigidos, con código y nombre, y los tipos que se pueden exigir (`permitTypes`). El tablero de posiciones devuelve sus nombres (`requiredPermits`), que el detalle muestra como «Exige: …».

**4. Elegibilidad.** Hay una sola regla pura (`RequiredPermitRules`). Un carnet exigido cuenta como presente solo con un ciclo vigente de su código, con la misma noción de «vigente» del carnet aeroportuario: emitido en la fecha de trabajo y sin vencer hasta el final de la ventana.
- `PositionCoveragePolicy` rechaza la cobertura con `required_permit_missing`. El 422 trae `missingPermits` con los nombres.
- `OccAgentEligibilityPolicy` añade la misma razón y, en la opción del agente, `missingPermits`.
- La regla se aplica en estos puntos: la asignación manual (sus opciones y el comando), el relevo, la reasignación por cambio de posición, el sorteo de posición del vuelo demo (que evalúa cada posición) y los avisos de asignación no apta (`EfOccAssignmentReadinessStore`).
- Las pantallas dicen «Le falta: {carnet}».

**5. Gestión Humana › Configuración.**
- Módulo `human_resources.settings` con Read, Create y Update («Modificar y desactivar»), en la sección «Configuración» del catálogo de permisos.
- La lectura de los tipos de carnet también la permite `human_resources.permits.read`: así el formulario y las listas de carnets nombran los tipos personalizados.
- Códigos de error: `invalid_settings`, `code_taken`, `code_in_use`, `system_type_locked`, `version_conflict`, `idempotency_conflict`, `forbidden` y `not_found`.
- La auditoría usa `hr.permit_type.*` y `hr.equipment_type.*`.

## Consecuencias

- Las posiciones que no exigen ningún carnet se comportan como antes.
- Los campos nuevos son opcionales. `missingPermits` se omite cuando falta.
- Los validadores estrictos del cliente compartido anteriores a este cambio rechazan `requiredPermits` y `permitTypes` en Datos maestros. Por eso la API y la web privada se despliegan juntas.
- La tablet no traduce códigos: muestra el nombre que la API le da a cada documento, que para un tipo personalizado es el del catálogo.

## Fuera de alcance

Plantillas de turno, motivos de ausencia, tipos de documento de identidad y departamentos, que siguen en código.
