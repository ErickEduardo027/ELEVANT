# ADR-0027: OCC ve los contratos listos, el vuelo guarda su contrato y las posiciones se ubican en el mapa

## Estado

Accepted — 2026-11-03.

## Contexto

Fase 2 del ciclo operativo, bloque 3 (OCC listo). Con el contrato activo (ADR-0025) y el personal
habilitado (ADR-0026), OCC debía poder planificar, y había tres huecos:
- OCC no veía qué aerolíneas podía planificar: la regla «qué contrato cubre este vuelo» estaba
  repetida en cuatro consultas y no coincidía. La creación manual solo aceptaba versiones
  `Approved`; la asignación de agentes también aceptaba `Superseded`.
- El vuelo no guardaba qué versión del contrato lo cubría; se recalculaba en cada lectura.
- Las coordenadas de las posiciones vivían solo en el navegador (`positionsData.js`), sin
  procedencia verificada, y Planificación no tenía mapa.

## Decisión

### Una sola regla de cobertura

`ApplicableContracts.For(context, airlineId, stationId, date)` es la única consulta que decide qué
versión cubre a una aerolínea en una estación y una fecha:
- contrato `Active`, firmado en o antes de la fecha y no terminado antes de ella;
- versión `Approved` o `Superseded`, con `ValidFrom ≤ fecha ≤ ValidTo` (o sin fin) y la
  estación entre las suyas. Una versión reemplazada sigue cubriendo los días que conservó,
  porque la aprobación de la siguiente recorta su fin y nunca se solapan.

La usan la lectura de Planificación, las opciones y la creación de vuelos manuales y la asignación
de agentes. Dos versiones que cubren la misma fecha son un conflicto de datos: no se planifica
con ninguna.

> **Actualización (7 de noviembre de 2026).** La versión que cubre es una versión que rige:
> `Approved` y firmada por ambas partes sobre la misma huella, `Superseded` en las fechas que
> conservó, o la primera versión heredada de un contrato que ya salió de `Draft`. Una versión que
> Finanzas aprobó y nadie firmó no cubre nada. Ahora el fin de la versión anterior lo recorta la
> segunda firma de la siguiente, no su aprobación. «No terminado» significa que `TerminatedOn`, el
> primer día sin cobertura, es posterior a la fecha. El feed de vuelos usa la misma regla. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

### «Contratos listos para operar»

`GET occ/contracts?stationId&date` (permiso `operations.planning.read`, estación en alcance)
devuelve por aerolínea el código del contrato, la versión, la vigencia, el modo de renovación, los
servicios contratados (sin precios) y cuántos vuelos tiene planificados ese día. Admin OCC lo
muestra en el módulo nuevo «Contratos listos», con enlace a Planificación.

### El vuelo guarda su contrato

`ops.turnarounds.contract_version_id` (*nullable*, FK sin cascada) se fija al crear el vuelo
manual con la versión que lo cubre. Los vuelos anteriores quedan en `NULL` y se siguen resolviendo
con la regla anterior; no hay *backfill* en la migración (sin datos de negocio en migraciones).

### Posiciones ubicadas por OCC

`ref.stands` gana `latitude`, `longitude` (`decimal(9,6)`, WGS84) y `located_at`, con
restricciones de rango y de par completo. `PUT occ/stands/{standId}/location` (permiso
`operations.positions_map.assign`, estación en alcance, auditoría `occ.stand.located`) ubica o
borra la posición y anuncia `occ_planning`. El tablero de posiciones devuelve las coordenadas.

En el Mapa de posiciones, OCC elige «Ubicar en el mapa» en una posición y hace clic en el punto
real. Las coordenadas guardadas reemplazan a la referencia interna; las posiciones que no tienen
ubicación siguen usando `positionsData.js`, marcada como referencia sin verificar. Esas
coordenadas **no** se cargan en el seed: son datos del prototipo sin procedencia.

### Mapa en Planificación

Planificación suma la vista «Mapa» (MapLibre, la misma capa del Mapa de posiciones): posiciones
con los vuelos del día, vuelos sin posición y un clic que abre el vuelo en el panel de
asignación.

> **Actualización (8 de noviembre de 2026).** El Mapa de posiciones registra la llegada con la
> hora que OCC escribe en la hora local de la estación y, si quiere, el tipo de avión; desde ese
> registro el tramo pasa a `Manual` y el feed ya no reescribe su hora real. Reemplazar una hora
> que el tramo ya tiene exige motivo (la de OCC siempre; la del feed, si OCC escribe otra), y
> registrar o corregir la llegada solo vale antes de la primera entrega (`arrival_locked`), aunque
> la hora sea del feed o el tramo no la tenga. La llegada, la asignación de
> la posición y su liberación corren en una transacción serializable y aceptan una
> `Idempotency-Key` y un `If-Match` opcionales (con la clave, el `If-Match` es obligatorio,
> `expected_version_required`). La asignación bloquea primero la fila de la posición, así que dos
> vuelos nunca toman la misma. Sin fecha, Planificación abre el día de hoy de la estación, no la
> última fecha con vuelos. La regla única de cobertura decide también si la tablet puede iniciar
> una operación (`contract_not_in_force`). Ver
> [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).

## Consecuencias

- La importación de vuelos del proveedor (bloque 4) fijará `contract_version_id` con la misma regla.
- La regla vive en Persistence. Si otro módulo la necesita, se mueve a un puerto de Application.
- Las posiciones de otras estaciones se pueden ubicar igual, pero el mapa solo pinta las de PUJ
  hasta que existan referencias de otras estaciones.

> **Actualización (13 de noviembre de 2026).** «Cargar posiciones de Punta Cana», el comando que
> el superadministrador usa donde están encendidos los vuelos demo
> ([ADR-0041](0041-demo-flights-and-punta-cana-stands.md)), crea terminales y posiciones sin
> coordenadas: no escribe `latitude`, `longitude` ni `located_at`, ni en las posiciones que crea
> ni en las que adopta. El conjunto de datos del mapa sigue dibujando cada posición por su código
> normalizado, como referencia interna sin verificar, y la ubicación que OCC guarda con
> `PUT occ/stands/{standId}/location` sigue reemplazándola. Para el vuelo demo, una posición está
> «ubicada» si su código está en el catálogo de Punta Cana o si OCC la colocó.

> **Actualización (13 de noviembre de 2026).** El mapa del OCC tiene un plano propio de Punta Cana,
> `frontend/private-web/src/features/maps/airport/data/mdpc.layout.json` (PR M3,
> [ADR-0043](0043-occ-maps-one-engine.md)), generado desde OpenStreetMap, OurAirports y los puntos
> internos de `positionsData.js`. Desde la vista Aeródromo el mapa dibuja con él las pistas, las
> calles de rodaje, las plataformas y las terminales. El plano guarda la geometría de cada posición
> (su caja, su rumbo y su entrada) por el código normalizado: `A01`, `a-1` y `A1` son la misma
> posición, y las equivalencias no se infieren. «1», «9A» o «23A» solo casan con una posición o con
> un alias que liste el plano, y la tabla de alias nace vacía. El centro de cada caja es el punto de
> `positionsData.js` (decisión 20 de Erick), así que la referencia interna sin verificar no se
> mueve. La base sigue guardando solo la ubicación que OCC coloca con
> `PUT occ/stands/{standId}/location`, que sigue reemplazando a la referencia. En M3 las posiciones
> siguen dibujándose como puntos; con M4, el mapa dibujará la caja del plano y la trasladará sin
> deformarla al punto que OCC guardó.
