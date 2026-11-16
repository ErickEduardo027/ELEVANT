# ADR-0028: Feed de vuelos AeroDataBox con presupuesto de unidades y revisión de OCC

## Estado

Accepted — 2026-11-03.

## Contexto

Fase 2 del ciclo operativo, bloque 4 (información aeronáutica). OCC planificaba vuelos solo a
mano. AVIAM contrató AeroDataBox, plan *Starter* directo:
- cuesta unos 20 USD al mes, sin presupuesto para subir de plan;
- incluye 40 000 unidades al mes y 5 peticiones por segundo;
- FIDS (llegadas y salidas de un aeropuerto) es *tier* 2: 2 unidades por llamada y ventanas de hasta 12 horas.

La condición es gastar **lo mínimo**. Además, la validación de aerolíneas de la fase 1
(ADR-0023) dependía solo de Wikidata y de la copia de OpenFlights.

## Decisión

### Una sola llamada de pago, y solo desde el servidor

- El puerto `IAirportFlightFeed` (Application) lo implementa `AeroDataBoxAirportFlightFeed` (Infrastructure).
- Endpoint: `GET /flights/airports/iata/{code}/{from}/{to}`, con:
  - `withLeg=true`, que trae el aeropuerto contrario sin costo extra;
  - `withCodeshared=false`, `withCargo=false`, `withPrivate=false` y `withLocation=false`, para que la respuesta sea pequeña.
- Ninguna pantalla llama al proveedor. Solo `FlightFeedSynchronizer` lo hace, desde dos sitios:
  - el worker, cada minuto;
  - «Actualizar ahora» de OCC.
- Sin `AeroDataBox:Enabled` y una clave, se registra `DisabledAirportFlightFeed` y no hay ninguna llamada.

### Cuándo se lee (`FlightFeedPlanner`, función pura)

1. Cada mitad del día de hoy (00:00–11:59 y 12:00–23:59) se lee **una vez** si la estación tiene contrato hoy. No se lee una mitad que terminó hace más de 2 horas.
2. Desde las 18:00 locales se leen una vez las dos mitades de mañana, si un contrato cubre mañana.
3. La ventana activa (2 horas atrás y 10 adelante) se refresca:
   - cada 15 minutos si hay un vuelo contratado a ±3 horas;
   - cada 60 minutos si quedan vuelos más tarde;
   - nunca cuando ya pasaron los vuelos contratados del día.
4. Al 80 % del presupuesto diario o mensual, el intervalo se duplica. Una llamada que superaría el límite no se hace.
5. Solo se consideran las estaciones con un contrato vigente hoy o mañana (ADR-0027).

Un día de actividad máxima (vuelos cada 90 minutos de 06:00 a 23:00) gasta entre 100 y 200
unidades. Eso son unas 4 500 al mes por estación, alrededor del 12 % del plan. Lo comprueba
una prueba unitaria que simula el día minuto a minuto.

### Presupuesto, candado y errores

- **Presupuesto:** `integration.provider_usage_entries` registra cada llamada (unidades, motivo, ventana, resultado), sin modificarse después. El presupuesto es la suma por día UTC y por mes UTC. Los límites se configuran: por defecto 1 200 al día y 38 000 al mes.
- **Candado:** `integration.provider_sync_leases` guarda un solo turno de sincronización por proveedor, con vencimiento. Así no hay lecturas dobles aunque haya reinicios o réplicas. La fila la crea el código en el primer uso, nunca una migración.
- **Errores, sin reintentos en bucle:**
  - una cuota agotada detiene las lecturas hasta el día UTC siguiente;
  - una clave rechazada las detiene 6 horas;
  - un 429 espera lo que diga `Retry-After`;
  - los demás fallos esperan 1, 2, 4… minutos, como máximo una hora.
- **«Actualizar ahora»:** como mucho una vez cada 10 minutos por estación. Si hay una lectura de menos de 5 minutos que cubre el momento actual, se reutiliza sin gastar.

### Vuelos propuestos y revisión de OCC

- De cada respuesta solo se guardan los tramos de aerolíneas con contrato que cubre su fecha en la estación. Se guardan en `integration.external_flight_proposals` como **propuestos**.
- OCC ve las llegadas con la salida sugerida:
  - la misma aerolínea;
  - la misma matrícula si se conoce;
  - si no, la siguiente salida entre 20 minutos y 8 horas después.
- **Importar:** OCC confirma el par (permiso «Crear escalas»). Se crea el `Turnaround` con:
  - `Source = ExternalProvider` y `ExternalProvider = AeroDataBox`;
  - el `ContractVersionId` que lo cubre;
  - los dos tramos y la operación de tierra.
  - Confirmar otra vez el mismo par devuelve la misma escala.
- **Lecturas posteriores:** actualizan las horas revisadas y reales del tramo confirmado (`EstimatedAt` y `ActualAt`) y anuncian `occ_planning`.
- **Descartar:** el tramo descartado no vuelve a aparecer.

> **Actualización (7 de noviembre de 2026).** La ingesta guarda también, sin coste extra, los
> tramos de las aerolíneas activas registradas sin un contrato que cubra su fecha: OCC las revisa
> aparte en la vista «Charter sin contrato». Las que solo tienen un contrato suspendido o vencido
> en la estación no aparecen en ninguna vista. Importar acepta el tipo de avión, que se sugiere
> desde el modelo que informa el proveedor, la posición y el modo charter sin contrato
> ([ADR-0033](0033-charter-flights-without-contract.md)). Descartar ya no es definitivo: la vista
> «Descartadas» restaura una propuesta mientras su vuelo no haya pasado. Para el ciclo local
> existe un proveedor simulado, apagado por defecto y solo para Development o Test, que nunca
> llama a AeroDataBox ni alimenta el registro de aerolíneas. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

> **Actualización (8 de noviembre de 2026).** Importar un par que coincide con una escala abierta
> de la misma estación, aerolínea, número de vuelo normalizado y día local lo vincula a esa escala
> (`linked`, auditoría `occ.turnaround.feed_linked`) en lugar de crear otra, y el alta manual del
> mismo vuelo responde `flight_already_planned`. Las escalas nuevas reciben el código
> `{ESTACIÓN}-{AAAAMMDD}-{NNN}`; los `EXT-` ya emitidos se conservan. Las lecturas posteriores ya
> no actualizan un tramo cuya llegada registró OCC, que pasa a `Manual`. Cuando el proveedor
> informa cancelado o desviado un vuelo importado, OCC recibe `flight_cancelled_by_provider` o
> `flight_diverted_by_provider` una sola vez y decide: el feed no cancela nada. Ver
> [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).

### Información aeronáutica gratis desde la misma respuesta

- **Aerolíneas:** cada aerolínea que aparece, contratada o no, se guarda en `ref.airline_registry_entries` (códigos, nombre y última vez vista).
  - `ObservedAirlineRegistrySource` se consulta **antes** de Wikidata y OpenFlights en la verificación de aerolíneas (ADR-0023) y no cuesta unidades.
  - Si no conoce la aerolínea responde «no puede responder», nunca «no encontrada», porque solo conoce las que operan en nuestras estaciones.
- **Aeropuertos:** el aeropuerto contrario de cada tramo se añade a `ref.airports` si trae IATA, ICAO y país. Sus nuevas columnas `iana_time_zone`, `latitude` y `longitude` se completan cuando están vacías.
  - Por eso **no se usa** `/airports/{code}`, que es *tier* 1.

### Lo que no se usa, a propósito

| Feature | Motivo |
|---|---|
| Estado por número de vuelo | FIDS ya trae todos los vuelos de la estación en una llamada |
| Webhooks | La API solo es accesible por la tailnet |
| FAA, distancias, autocompletado, imágenes de aeronaves, demoras históricas | No aportan a la operación de tierra |

La flota, la aeronave por matrícula y las rutas diarias sí se usan desde el 15 de noviembre de 2026. Las demoras actuales están implementadas pero apagadas, porque el plan Starter no las incluye; ver la última actualización.

## Consecuencias

- La planificación de OCC nace de datos reales, pero OCC decide qué escalas se operan.
- La validación de aerolíneas mejora sin gastar unidades a medida que se leen estaciones.
- **Pendiente:**
  - enlazar el tráfico de OpenSky con los vuelos importados por matrícula o *callsign*;
  - mostrar el consumo en Superadministración;
  - leer estaciones distintas de PUJ, que funcionaría igual pero aún no tiene contratos.
- La clave se configura fuera del repositorio. En Development local el feed queda apagado por defecto.

> **Actualización (7 de noviembre de 2026).** El overlay del arnés E2E
> (`database/DevelopmentDB/compose.local.e2e.yml`) activa el proveedor simulado
> (`SimulatedFlightFeed__Enabled`). La API se niega a arrancar si el simulado y AeroDataBox están
> activos a la vez. La plantilla del VPS Development no lo define: allí el feed sigue siendo
> AeroDataBox. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

> **Actualización (12 de noviembre de 2026).** Los vuelos demo de Superadministración son
> propuestas de un proveedor propio, `Demo`, que la API escribe sin llamar a nadie.
> `GetActivityAsync` las excluye, y también las escalas con `ExternalProvider = "Demo"`: un
> vuelo demo nunca adelanta una lectura de AeroDataBox ni gasta unidades. La revisión nunca
> empareja tramos de proveedores distintos, ni de dos vuelos demo distintos; la importación
> rechaza esa pareja con `flight_proposals_not_pairable`, y una propuesta demo descartada no se
> restaura (`flight_proposal_passed`). La lista marca esos tramos con `isDemo`, que solo viaja
> cuando es verdadero. Ver
> [ADR-0041](0041-demo-flights-and-punta-cana-stands.md).

> **Actualización (13 de noviembre de 2026).** Los vuelos del mapa del OCC
> (`GET occ/map/flights`) leen también las propuestas abiertas del feed, con la
> misma regla de visibilidad que la revisión, que ahora vive en un solo lugar
> (`FlightFeedVisibility`): las aerolíneas con contrato en vigor ese día y las
> candidatas a charter, nunca las de un contrato suspendido o vencido en la
> estación. Las filas demo que nadie importó toman su estado, su hora de pista y
> su reloj del `DemoFlightTimeline` al leerlas, sin escribir nada. La imagen
> aérea del mapa (adsb.fi, con adsb.lol de relevo) reconoce los vuelos de ELEVANT
> por matrícula y por *callsign*: eso cierra, para esa red, el pendiente de
> enlazar el tráfico con los vuelos importados. El tráfico de OpenSky
> (`occ/traffic/aircraft`) sigue sin enlazar. Ninguna de estas lecturas llama a
> AeroDataBox ni gasta unidades. Ver
> [ADR-0042](0042-occ-air-picture-and-map-flights.md).

> **Actualización (15 de noviembre de 2026). Lecturas de referencia bajo demanda.** El dueño pidió
> «sacarle provecho» a la API para la presentación. Además del FIDS, el servidor lee ahora cuatro
> datos de referencia. Solo los pide cuando una pantalla los muestra, los guarda en memoria y cada
> uno tiene un tope por día y otro por mes. Ningún navegador llama a AeroDataBox, no se agrega ningún
> origen a la CSP y nada se llama al arrancar ni en segundo plano.
>
> **Endpoints confirmados** con la especificación pública (`doc.aerodatabox.com`, OpenAPI directa) y
> la lista de precios (*tier* 1 = 1 unidad, *tier* 2 = 2 y *tier* 3 = 6). En el plan Starter la
> página de la flota es de 25 aviones. La política de AeroDataBox permite guardar los datos 7 días.
>
> | Lectura | Endpoint | *Tier* / unidades | Caché | Tope día / mes | Estimación al mes |
> |---|---|---|---|---|---|
> | Flota de una aerolínea | `GET /airlines/{code}/aircrafts?pageSize=25` | 3 / 6 | 7 días por código | 30 / 300 | ~60 (unas 10 aerolíneas) |
> | Aeronave por matrícula | `GET /aircrafts/reg/{reg}` | 1 / 1 | 1 día por matrícula | 40 / 1 200 | ~300 (unas 10 al día) |
> | Rutas diarias del aeropuerto | `GET /airports/icao/{code}/stats/routes/daily` | 3 / 6 | 24 horas | 12 / 200 | ~180 (una al día) |
> | Demoras actuales (**apagada**) | `GET /airports/{iata\|icao}/{code}/delays` | 3 / 6 | 1 hora por aeropuerto | 48 / 1 500 | 0: el plan Starter no la incluye |
>
> **Demoras apagadas.** El dueño confirmó que su plan Starter **no incluye** las demoras actuales de un
> aeropuerto. `AeroDataBox__DelaysEnabled` vale `false` por defecto: la lectura responde `Disabled` sin
> llamar al proveedor y sin escribir en el registro. La pastilla de la consola y la fila de demoras del
> inspector no se dibujan, y la pastilla deja de consultar tras esa primera respuesta. El código y sus
> topes quedan listos para encenderla si el plan sube.
>
> Con los topes por defecto, las tres lecturas activas gastan como mucho **1 700 unidades al mes**. Junto
> a las 9 000 del feed en el VPS, el total es de unas 10 700 de las 40 000 del plan (≈ 27 %).
>
> **Contabilidad.** Cada llamada queda en `integration.provider_usage_entries`:
> - `Operation` lleva el nombre de la lectura (`airline_fleet`, `aircraft`, `airport_routes`, `airport_delays`);
> - `Trigger` es el nuevo valor `OnDemand`;
> - `FlightsReceived` cuenta los elementos recibidos.
>
> No hizo falta migración, porque el disparador se guarda como texto. El presupuesto del feed
> (`DailyUnitLimit`, `MonthlyUnitLimit`) cuenta ahora **solo** la operación `fids`, en el
> sincronizador y en la cifra que muestra OCC. Así las lecturas nuevas no le quitan lecturas al feed.
>
> **Topes en configuración** (`AeroDataBox__…`, ninguno es secreto):
> - por lectura: `FleetDailyUnitLimit`, `FleetMonthlyUnitLimit`, `AircraftDailyUnitLimit`, `AircraftMonthlyUnitLimit`,
>   `RoutesDailyUnitLimit`, `RoutesMonthlyUnitLimit`, `DelaysDailyUnitLimit`, `DelaysMonthlyUnitLimit`;
> - para todas: `PlanMonthlyUnitLimit` (38 000 por defecto). Ninguna lectura se hace si la suma de
>   todas las operaciones del proveedor en el mes lo superaría.
>
> **Estados en lugar de errores.** Cada respuesta es un 200 con un estado: `Available`, `NotFound`,
> `Disabled`, `DailyLimitReached`, `MonthlyLimitReached`, `Unavailable` o `NotApplicable`.
> - Con un tope alcanzado, o el proveedor caído o en espera, se devuelve el último valor guardado si existe.
> - Las pantallas dicen «Límite diario alcanzado», «Límite mensual alcanzado», etc.
> - La espera ante fallos es la misma que la del feed: cuota agotada hasta el día UTC siguiente, clave
>   rechazada 6 horas, `Retry-After` en un 429 y cinco minutos por sujeto ante otros fallos.
> - Una matrícula demo (`HIDM01`–`HIDM99`) nunca se consulta: responde `NotApplicable`.
>
> **Endpoints de la API:**
> - `GET occ/aviation/aircraft`, `GET occ/aviation/routes` y `GET occ/aviation/delays`, para quien
>   puede leer el mapa del OCC;
> - `GET contracts/airline-fleet`, para el superadministrador o personal interno con `contracts.requests.read`.
>
> La flota informa y no bloquea ninguna aprobación. Código de error: `invalid_aviation_reference_query`.
>
> **Caché.** Vive en la memoria de la API, como la del clima. Un reinicio la vacía, pero el gasto
> sigue acotado por los topes, que se calculan sobre el registro persistido. Las pruebas, el CI y el
> E2E no llaman nunca a AeroDataBox: sin `AeroDataBox:Enabled` y una clave, el proveedor es el no
> configurado, y las pruebas usan respuestas sintéticas.
>
> **Descartado:**
> - `/airports/{code}/runways` (*tier* 1), por tiempo; el dato es útil y queda pendiente;
> - imágenes de la aeronave e historial de matrículas, que no están en Starter;
> - demoras históricas y globales, y demoras por número de vuelo (*tier* 3), porque no hacen falta.
