# ADR-0042: Imagen aérea y vuelos del mapa del OCC

## Estado

Accepted — 2026-11-13. Lo entrega el PR A3 «Imagen aérea y vuelos para el mapa» del plan «OCC a nivel NOC» (código de `77dff268` a `e098ccde`). Es solo API y cliente compartido: ninguna pantalla lo consume todavía. El carril de mapas lo dibuja desde el PR M5 ([ADR-0043](0043-occ-maps-one-engine.md)).

## Contexto

El plan «OCC a nivel NOC» pide mapas con los aviones reales de la zona, la trayectoria de cada vuelo hasta su posición y los vuelos de ELEVANT, también los demo ([ADR-0041](0041-demo-flights-and-punta-cana-stands.md)), en la consola, Monitoreo de vuelos, el Mapa de posiciones y Planificación. Lo que había no alcanzaba:
- El único tráfico era `GET occ/traffic/aircraft`, de OpenSky: apagado sin credenciales, con un recuadro fijo (17–21° N, 73–67° O), unidades métricas y un validador del cliente que fija esa caja. No sabía qué avión era un vuelo de ELEVANT: [ADR-0028](0028-aerodatabox-flight-feed-with-unit-budget.md) dejó pendiente «enlazar el tráfico de OpenSky con los vuelos importados por matrícula o *callsign*».
- Los vuelos estaban repartidos en lecturas con permisos y claves distintos: la revisión del feed (con `operations.planning.read` y el presupuesto de AeroDataBox), la planificación y el tablero de posiciones. El id de un vuelo cambiaba al importarlo, de la propuesta al tramo, así que un mapa que lo siguiera lo soltaría justo al pulsar «Importar escala».
- La API limita a 100 peticiones por minuto por dirección, y en una presentación la consola, Superadministración y la tablet salen de la misma dirección.
- La imagen de la API se certifica como Development sin red ni base de datos, y el plan no admite migraciones.

Erick decidió (plan del 12 de noviembre de 2026):
- **Tráfico híbrido (decisión 1).** Posiciones reales de una red ADS-B abierta, consultada por el backend. Donde no haya cobertura, y para los vuelos demo, la posición se calcula con el horario y se marca como estimada.
- **adsb.fi (decisión 6).** Fue la única red que vio aviones en aproximación y en tierra en Punta Cana. Su licencia es de uso personal y no comercial: se muestra su crédito y, antes de un uso comercial, se pide permiso o se cambia de red por configuración. adsb.lol queda como alternativa lista.
- **Todo encendido en Development, sin variables nuevas en el VPS (decisión 10).**

Del plan aprobado salen también el límite de 600 peticiones por minuto, solo en Development, y que cualquier cuenta del OCC que pueda ver un mapa vea los vuelos propuestos y las horas de los hitos, como este ADR deja escrito (sección 10).

Las revisiones del plan pidieron además un relevo por si adsb.fi rechaza la dirección del VPS, leer la red solo mientras alguien mira (la certificación corre sin red) y no versionar respuestas reales como fixtures, porque la licencia de adsb.fi no permite redistribuirlas.

## Decisión

**1. Híbrido: la red da los aviones y ELEVANT, sus vuelos.** Dos lecturas independientes bajo `api/v1/occ/map`: la imagen aérea, servida desde memoria, y los vuelos de ELEVANT, una lectura SQL. Un avión de la imagen que es un vuelo de ELEVANT lleva en `matchedFlightKey` la `flightKey` de su fila en `flights`, y en `matchedBy` cómo se reconoció. `flights` nunca trae la posición de un vuelo, una pista ni la geometría de una posición: el mapa decide dónde dibujar, con los instantes del servidor, y rotula lo estimado («est.») y lo simulado («Demo»).

**2. adsb.fi en Development, adsb.lol de relevo.**
- El puerto es `IAirTrafficProvider` (`backend/Elevant.Application/Abstractions/Operations/IAirTrafficProvider.cs`): una lectura de los aviones alrededor de un punto, en unidades aeronáuticas (pies, nudos, pies por minuto), que devuelve su resultado (`Succeeded`, `RateLimited`, `Unauthorized`, `QuotaExceeded` o `Failed`) y nunca lanza por un fallo de la red. Sin red configurada, `UnconfiguredAirTrafficProvider` responde `Failed` y no llama a nada; es el valor por defecto de todo host.
- Un solo adaptador para la familia readsb v2, `ReadsbAirTrafficProvider`, con dos perfiles (`ReadsbProfile`, en `backend/Elevant.Infrastructure/Integrations/AirTraffic/`):

  | Perfil | Consulta | Clave | Límite diario |
  | --- | --- | --- | --- |
  | `AdsbFi` | `https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}` | no lleva | ninguno (la red admite una consulta por segundo) |
  | `AdsbLol` | `https://api.adsb.lol/v2/point/{lat}/{lon}/{nm}` | opcional, en `x-api-key` | 450 lecturas por día UTC sin clave y 900 con clave, el 90 % de las 500 y 1 000 que admite la red |

- El parser puro `ReadsbV2Parser` acepta la lista en `ac` o en `aircraft` y `now` en segundos o en milisegundos. Descarta las direcciones que no son seis dígitos hexadecimales (una `~` marca una dirección no ICAO), los aviones sin latitud y longitud válidas y las posiciones de más de 120 segundos; `alt_baro: "ground"` es un avión en tierra, y de una dirección repetida se queda la posición más reciente.
- Cada perfil usa su propio `HttpClient`: sin redirecciones, 10 segundos para la respuesta completa, respuestas comprimidas, 8 MiB como máximo, `Accept: application/json` y el `User-Agent` genérico `air-traffic-reader/1.0`, sin el nombre del proyecto, correos ni direcciones. Un 200 se lee; un 429 es `RateLimited`, con lo que pida su `Retry-After`; un 401 o un 403 es `Unauthorized`; cualquier otro estado, un tiempo agotado o un JSON ilegible es `Failed`. El mensaje del error nunca se registra, porque puede nombrar el host.
- La clave es opcional y solo de adsb.lol: sale de la configuración secreta (`AirTraffic__ApiKey`), nunca se envía a adsb.fi y nunca llega a un log, a un Problem Details ni al OpenAPI. Development no configura ninguna.
- El contador diario de adsb.lol vive en memoria: cuando se agota responde `QuotaExceeded` sin llamar a la red, y un reinicio lo pone en cero.
- `FailoverAirTrafficProvider` recorre `AirTraffic:Providers` en su orden. Cada lectura la responde la red activa: la primera, hasta que falla tres veces seguidas; entonces toma el turno la siguiente, y después de la última vuelve la primera. Mientras otra está activa, cada 10 minutos una lectura pregunta antes a la primera. Si responde, recupera el turno y su respuesta es la de esa lectura. Si no, la activa responde esa misma lectura, como si no se le hubiera preguntado a la primera: ni el fallo de esa prueba ni su `Retry-After` llegan al lector, así que la imagen no espera ni cambia de estado por una red que no está activa, y la activa y su cuenta de fallos quedan como estaban. Es una consulta más cada 10 minutos, no un segundo ritmo. Si la primera pide con su `Retry-After` esperar más de 10 minutos, al perder el turno o en una prueba, no se le vuelve a preguntar antes, y nunca se espera más de un día. Con una sola red en la lista, se le sigue preguntando al ritmo de las esperas (sección 4).

**3. Licencias y crédito obligatorio (decisión 6).**

| Red | Licencia | Crédito que viaja en `source` |
| --- | --- | --- |
| adsb.fi | Uso personal y no comercial; pide citar adsb.fi y enlazar su página | `name` «adsb.fi», `homeUrl` `https://adsb.fi`, `licenseName` «Uso personal y no comercial», `licenseUrl` `null` |
| adsb.lol | Open Database License (ODbL) 1.0 | `name` «adsb.lol», `homeUrl` `https://adsb.lol`, `licenseName` «ODbL 1.0», `licenseUrl` `https://opendatacommons.org/licenses/odbl/1-0/` |

- Cada respuesta de la imagen aérea y de la estela lleva en `source` el crédito de la red que dio los aviones que muestra; sin aviones, el de la red activa, así que el crédito sigue al relevo. Solo es `null` con el tráfico apagado.
- Cada mapa que dibuje estos aviones muestra en su atribución «Datos de aeronaves: {source.name}», con un enlace a `source.homeUrl` y, si existe, otro a `source.licenseUrl`. Lo dibuja el carril de mapas (PR M5), que traduce también el crédito y los motivos en los archivos de mensajes del OCC, en español e inglés.
- adsb.fi sirve para la demostración de Development, que es uso personal y no comercial. Antes de un uso comercial hay que pedir permiso por escrito a adsb.fi, cambiar a adsb.lol (`AirTraffic:Providers`, un cambio de configuración) o instalar un receptor ADS-B propio. `appsettings.Production.json` deja el tráfico apagado.
- Nada de adsb.fi se versiona: los fixtures de las pruebas son sintéticos (sección 13).

**4. Solo se lee mientras alguien mira, y nada se guarda.** `AirPictureService` (singleton de Application, `backend/Elevant.Application/Operations/AirPicture/`) guarda la imagen en memoria y `AirTrafficPollWorker` (`backend/Elevant.Api/Integration/AirTrafficPollWorker.cs`) es el único que llama a la red.
- **Demanda.** Cada lectura autorizada de la imagen o de una estela es demanda durante `IdleAfterSeconds` (900 segundos). Sin demanda no hay ninguna llamada: el worker duerme hasta la siguiente lectura. La primera después de un rato sin nadie responde `Warming` y despierta al worker; ninguna pantalla espera nunca a la red.
- **Ritmo.** Una sola lectura de la red por intervalo para todas las pantallas: `IntervalSeconds` es 10, y con menos la API no arranca. Después de cada lectura, `AirTrafficBackOff` fija una sola espera: el intervalo tras un éxito; lo que pida el `Retry-After` de un 429, y al menos un minuto; 30 minutos tras un 401 o un 403 o con el contador diario agotado; y 15 segundos tras un fallo, el doble con cada fallo seguido, hasta 5 minutos. Nunca menos que el intervalo y nunca un reintento en bucle. Si tras un fallo toma el turno otra red, la lectura siguiente va al ritmo normal. La prueba de la primera red cada 10 minutos (sección 2) va dentro de una de esas lecturas; si falla, la espera es la que fija la respuesta de la red activa.
- **Estado.** Viaja siempre en un 200, así que una lista vacía nunca pasa por éxito y el resto del mapa sigue dibujando. `Live` mientras el dato no pasa de 30 segundos o de dos intervalos y medio, lo que sea mayor; `Stale` hasta 10 minutos, con sus aviones (las pantallas los atenúan) y el motivo del último intento si falló; `Unavailable` después, sin aviones y con su motivo; `Warming` hasta que termina la primera lectura de una nueva vigilancia; y `Disabled` con el tráfico apagado. Los motivos son `not_configured`, `quota_exceeded`, `rate_limited`, `unauthorized` y `provider_error`. `refreshAfterSeconds` es la espera vigente acotada entre 10 y 60 segundos, 2 mientras calienta y 60 con el tráfico apagado: las pantallas nunca preguntan antes.
- **Estelas (`AirTrailBuffer`).** Un punto nuevo cuando el avión se movió al menos 50 metros o pasaron 10 segundos. Un hueco de más de 300 segundos empieza un segmento nuevo y descarta el anterior, así que una estela nunca une dos tramos a través de un hueco. Se guardan como mucho `TrailMinutes` (180), y un avión que nadie vio en 15 minutos se olvida. La estela corta tiene hasta 8 puntos, del más viejo al más nuevo; la completa, hasta 600, aclarados de forma pareja.
- **Nada se persiste.** Ni tabla, ni registro de uso, ni migración. Guardar las respuestas crearía una base derivada de datos ajenos: de adsb.fi, cuya licencia es personal y no comercial, o de adsb.lol, con las obligaciones de la ODbL. La imagen certificada sin red ni base de datos no llama a nadie: el worker termina enseguida con el tráfico apagado, y encendido no llama sin demanda. Un reinicio solo vacía las estelas y el contador de adsb.lol. Por eso la guía de la presentación dirá que se abra la consola unos minutos antes, para que ya haya estelas.
- El worker se registra siempre y escribe sus eventos 6421 (tráfico apagado), 6422 (una racha de pasadas fallidas, con un solo error), 6423 (recuperado) y 6424 (empieza una vigilancia).

**5. Las tres lecturas.** `backend/Elevant.Api/Controllers/OccMapController.cs`, bajo `api/v1/occ/map`, con sesión, respuestas privadas y solo lectura. Los contratos están en `backend/Elevant.Contracts/Operations/OccMapContracts.cs`: sin `long`, con ids públicos y las enumeraciones como texto.

| Operación | `operationId` | Respuesta |
| --- | --- | --- |
| `GET air-picture?stationId=&trails=short\|none` | `GetOccAirPicture` | Estado, motivo, `serverTime`, `observedAt` y `ageSeconds`, `refreshAfterSeconds`, `source`, el círculo de las lecturas (`center`: 18.5674, −68.3634 y 250 NM) y los aviones: dirección (`hex`), *callsign*, matrícula, tipo OACI, categoría, posición, altitud en pies (`null` en tierra), `onGround`, nudos, rumbo, régimen vertical, *squawk*, hora de la posición, `matchedFlightKey` y `matchedBy` (`Registration` o `Callsign`), y la estela: hasta 8 puntos con `short`, que es el valor por omisión, y ninguno con `none`. Una pantalla pide `short` en su primera lectura y después `none`, y suma ella las posiciones que recibe. |
| `GET aircraft/{hex}/track?stationId=` | `GetOccAircraftTrack` | La estela en memoria de un avión: `hex`, `serverTime`, `source` y hasta 600 puntos de su último segmento. Nunca se pregunta a la red por el pasado de un avión. |
| `GET flights?stationId=&hoursBack=&hoursAhead=` | `GetOccMapFlights` | Los vuelos de ELEVANT de la estación (secciones 6 a 8), desde `hoursBack` horas antes de ahora (de 0 a 24; 2 por omisión) hasta `hoursAhead` horas después (de 1 a 36; 12 por omisión). |

- Errores con Problem Details en español y un `code` estable, que la interfaz traduce sin mostrar nunca el título. `400 invalid_map_query`: sin estación o con una mal formada, una ventana fuera de rango, un `trails` que no es `short` ni `none` o un `hex` que no son seis dígitos hexadecimales. Los fallos de enlace del modelo también responden así, porque `OccMapProblemDetailsAttribute` corre antes que el filtro de `[ApiController]`. `401` sin código, con `WWW-Authenticate: Bearer`. `403 forbidden` y `404 not_found`, según la sección 10; un avión que ninguna lectura vio en los últimos 15 minutos también es `404 not_found`.
- El controlador, sus esquemas y el worker se registran siempre, así que el OpenAPI no depende de la configuración: el snapshot suma 3 rutas, 15 esquemas y la etiqueta `OccMap`.
- El cliente compartido suma `getOccAirPicture`, `getOccAircraftTrack` y `getOccMapFlights` (`packages/api-client/src/occMap.ts`). Valida la consulta antes de enviarla y la respuesta con validadores estrictos en cada nivel (`isOccAirPicture`, `isOccAircraftTrack` e `isOccMapFlights`): listas cerradas, una clave en `null` solo donde el contrato lo dice y las coordenadas comprobadas como posiciones de la Tierra, sin caja. El código nuevo es `invalid_map_query`. La app de la tablet no lee ninguna de estas respuestas.

**6. La clave del vuelo y la de la visita.** Son textos opacos: los clientes solo los comparan.
- `flightKey` es `p:` y el id de la propuesta para una propuesta abierta. Un tramo que creó la importación (escala con `Source = ExternalProvider`) es `p:` y el id de la propuesta del mismo proveedor cuya referencia externa es la del tramo. Cualquier otro tramo es `l:` y el id del tramo: los manuales, los charter, los de la semilla y también un vuelo planificado al que se unió un par del feed (regla 3-N07). Así la clave no cambia con una importación normal, y un mapa que sigue el vuelo no lo suelta al importarlo. En un enlace 3-N07 la clave de la propuesta se acaba y el tramo conserva su `l:`; `proposalId` nombra la última propuesta enlazada al tramo, así que un cliente resuelve con ella una clave `p:` que ya no encuentra.
- `visitKey` agrupa los dos tramos de una visita del avión: `p:` y el id de la propuesta de llegada para una escala que creó la importación y para los pares abiertos, y `t:` y el id de la escala en los demás casos. Una salida abierta se une a la visita de la llegada que le sugiere la revisión del feed, buscada entre todas las propuestas abiertas de esos días, y los dos tramos de un vuelo demo se unen por su id de vuelo demo.

**7. Una sola lista de fases y qué es la hora real.** `MapFlightPhases.Of` es una función pura de Application, que lee el texto del proveedor sin distinguir mayúsculas ni espacios alrededor:

| Caso | Llegada | Salida |
| --- | --- | --- |
| Hora real de pista (`actualKind: Runway`) | `landed` | `departed` |
| Hora real en posición (`actualKind: OnBlock`) | `arrived` | `departed` |
| Sin hora real y con Expected, Unknown, CheckIn, Boarding, GateClosed o Delayed, o sin texto | `scheduled`; `enroute` cuando llegó su hora (la estimada o, si no hay, la programada) | `scheduled` |
| Departed | `departed` | `departed` |
| EnRoute | `enroute` | `enroute` |
| Approaching | `approaching` | `approaching` |
| Arrived | `arrived` | `arrived` |
| Canceled, Cancelled o CanceledUncertain | `cancelled` | `cancelled` |
| Diverted | `diverted` | `diverted` |
| Cualquier otro texto | `unknown` | `unknown` |

- `actualKind` sale de la fuente del tramo. Con `Source = ExternalProvider`, la hora real la escribió el feed o el worker de los vuelos demo y es la de pista (`Runway`); con `Manual` («Registrar llegada» de OCC) o cualquier otra fuente, es la de llegada a la posición (`OnBlock`). La hora de pista de una propuesta es `Runway`, y sin hora real es `null`.
- `providerStatus` es el texto tal como lo informó el proveedor, solo informativo; el de un tramo sale de la propuesta enlazada a él.
- Las filas demo que nadie importó toman su estado, su hora de pista (desde que el avión toca pista) y el bloque `demo` del `DemoFlightTimeline` al leerlas, la misma función que usa el worker ([ADR-0041](0041-demo-flights-and-punta-cana-stands.md)); nada se escribe. Los dos tramos de un vuelo demo llevan el mismo bloque `demo`, con su estado (`Active`, `Cancelled` o `Finished`), su fase y sus instantes. `suggestedStandCode` solo lo lleva una propuesta demo antes de importarse: la posición del disparo.

**8. Qué filas trae `flights`.** `EfOccMapFlightStore` (`database/DevelopmentDB/Elevant.Persistence/Operations/EfOccMapFlightStore.cs`) hace una sola lectura, de la que salen también las claves del emparejamiento (sección 9):
- Los tramos de las escalas de la estación que no están canceladas ni desviadas, cuando la mejor hora del tramo (la real; si no, la estimada; si no, la programada) cae en la ventana. Además, los dos tramos de una visita cuyo avión está en tierra: la llegada tiene hora real, la salida no, la escala no está completada y su día no es anterior a ayer. Ese avión sigue en el mapa aunque pase la medianoche.
- Las propuestas abiertas de los días de la estación cuya mejor hora (la de pista; si no, la revisada; si no, la programada; la de un vuelo demo, de su reloj) cae en la ventana, de las aerolíneas que muestra la revisión del feed. Esa regla vive ahora en un solo lugar, `FlightFeedVisibility`, que usan la revisión y el mapa: las aerolíneas con contrato en vigor ese día y las candidatas a charter; nunca las de un contrato suspendido o vencido en la estación.
- Las propuestas de los tramos se leen por escala, con su índice, y cada tramo toma la suya por su clave.
- Las coordenadas del aeropuerto de la estación y del contraparte salen de `ref.airports`; si la fila no las tiene, del catálogo `DemoAirports`, que solo se lee.
- `stand` es la asignación abierta de la escala, también después de que el `PUSHBACK` liberara la posición para la ocupación ([ADR-0041](0041-demo-flights-and-punta-cana-stands.md), sección 11), sin coordenadas: el mapa sabe dónde está cada posición.
- `milestones` son los hitos registrados de la operación (los que tienen hora real), en el orden del reporte de vuelo (`FlightReportMilestones`, 25 como mucho), o una lista vacía. No hay otra lectura de hitos ni un color de «va atrasado», porque ningún hito tiene una hora objetivo.
- `aircraft` es la matrícula y el tipo de la escala («fabricante modelo» y tamaño) o, en una propuesta, la matrícula y el modelo que informó el proveedor con el tipo que sugiere `AircraftModelMatcher`. `callsign` es el designador OACI de la aerolínea y el número sin ceros a la izquierda, cuando se puede formar.
- Las filas van por su mejor hora y después por número de vuelo. Sus datos cambian con escrituras que ya anuncian `occ_planning`: la importación y las lecturas del feed, la asignación, los hitos de la tablet, el vuelo demo y su worker, entre otras. Lo que depende de la hora (la fase de una llegada cuya hora llegó y el reloj de un vuelo demo sin importar) se calcula al leer, y los instantes del vuelo demo ya vienen en la respuesta: el mapa los anima sin releer.

**9. Qué avión es qué vuelo.** `FlightAircraftMatcher` es una función pura de Application y corre en la lectura de la imagen:
- Son candidatas las llegadas cuya mejor hora va de 2 horas antes a 6 horas después de ahora, y las salidas de 1 hora antes a 3 horas después. Un vuelo demo nunca es candidato, porque su avión no existe: las claves del emparejamiento ni siquiera lo leen.
- Primero por matrícula, cuando el avión y el vuelo la conocen (en mayúsculas, sin guiones ni espacios). Si no, por *callsign*, contra los del vuelo: el designador OACI con el número sin ceros a la izquierda y con ellos, el designador IATA con el número con y sin ceros, y el número de vuelo tal cual.
- Entre varios vuelos, el avión toma el que transmite exactamente su *callsign* OACI, después cualquier otro de sus *callsign*; después el que todavía no ocurrió, el más temprano primero; y después el más cercano en el tiempo.
- Un vuelo por avión y un avión por vuelo: la matrícula gana a un *callsign*, y después la posición más reciente.
- Las claves se leen de SQL solo cuando la imagen tiene aviones, y `AirPictureService` las conserva 20 segundos por estación: como mucho tres lecturas por minuto y estación, mire quien mire, y una a la vez. Si la lectura falla, la imagen sigue con las últimas claves que conocía. Por eso un vuelo importado o cambiado puede tardar hasta 20 segundos en aparecer emparejado; un cliente que recibe una `matchedFlightKey` que no conoce relee `flights`.
- Cierra para la imagen aérea el pendiente de [ADR-0028](0028-aerodatabox-flight-feed-with-unit-budget.md) (nota del 13 de noviembre de 2026). El tráfico de OpenSky sigue sin emparejar.

**10. Quién lee los mapas (`OccMapAccess`).** El personal interno de AVIAM con la estación en su alcance y cualquiera de `operations.dashboard.read`, `operations.flight_monitoring.read`, `operations.positions_map.read` u `operations.planning.read`. Quien no es personal interno de AVIAM o no tiene ninguno de esos permisos recibe `403 forbidden`, y una estación fuera de su alcance, `404 not_found`; `flights` responde también `404 not_found` para una estación inactiva. La imagen aérea y la estela, además, solo existen para la estación de `AirTraffic:StationCode` (PUJ): otra estación responde `404 not_found`.
- **Ampliación deliberada.** La revisión del feed exige `operations.planning.read`. `flights`, en cambio, muestra a cualquier lector de mapas las propuestas abiertas (las de aerolíneas con contrato, las candidatas a charter y las demo) y las horas de los hitos registrados de cada operación. El tablero de llegadas y salidas de la consola y el mapa necesitan la misma lista para quien puede ver el mapa. Una propuesta en `flights` no lleva presupuesto de AeroDataBox, versión ni capacidad de importar: importar sigue exigiendo `operations.planning.create`. Un hito es un código y una hora, sin datos personales.

**11. Presupuesto de peticiones y límite de Development.**
- La API limita las peticiones con una ventana fija por dirección: 100 por minuto en `appsettings.json` (10 para crear sesiones). `appsettings.Development.json` sube `RateLimiting:PermitLimit` a 600: va en la imagen, sin variable en el VPS, y los demás entornos conservan 100. El overlay del arnés E2E conserva su propio límite.
- Presupuesto por pestaña del OCC (contratos 2.7): como mucho 40 peticiones por minuto en reposo y 70 durante un minuto de vuelo demo. La imagen aérea se pide al ritmo de `refreshAfterSeconds` (10 segundos), con `trails=short` una vez y `none` después, y en pausa con la pestaña oculta. `flights` se relee con `occ_planning`, como mucho una vez cada 3 segundos, más un sondeo de seguridad de 60 segundos. Lo cuenta la prueba de presupuesto del marco del OCC ([ADR-0044](0044-occ-noc-visual-system.md)).
- Hacia la red: una lectura cada 10 segundos mientras alguien mira, 8 640 si se mira el día entero, muy por debajo del ritmo que admite adsb.fi. En adsb.lol, el contador de 450 lecturas da unos 75 minutos de vigilancia continua al día. Sin nadie mirando, ninguna.

**12. Configuración (`AirTraffic`).**

| Clave | Valor | Regla |
| --- | --- | --- |
| `Enabled` | `false` en `appsettings.json` y en `appsettings.Production.json`; `true` en `appsettings.Development.json` | Apagado, o con la lista vacía, el estado es `Disabled` y nunca se llama a nada. |
| `Providers` | vacía; `["AdsbFi", "AdsbLol"]` en `appsettings.Development.json` | Solo `AdsbFi` y `AdsbLol`, sin repetir, en orden de preferencia. |
| `StationCode` | `PUJ` | La única estación con imagen aérea. |
| `CenterLatitude` y `CenterLongitude` | 18.5674 y −68.3634 | El punto de referencia de Punta Cana. |
| `RadiusNm` | 250 | De 1 a 250 millas náuticas. |
| `IntervalSeconds` | 10 | Nunca menos de 10. |
| `IdleAfterSeconds` | 900 | Al menos el intervalo. |
| `TrailMinutes` | 180 | De 1 a 180. |
| `ApiKey` | vacía | Opcional y solo para adsb.lol, desde la configuración secreta (`AirTraffic__ApiKey`). |

- Las opciones se enlazan con `GetSection().Get<AirTrafficOptions>()` y se validan en cada arranque, también con el tráfico apagado: un nombre de red desconocido o repetido, una lista escrita como un solo valor o un valor fuera de rango lanzan `InvalidOperationException` y la API no arranca. Ningún entorno se rechaza, a diferencia de los vuelos demo: Production lo deja apagado por configuración.
- Application registra con `TryAddSingleton` el proveedor sin red y los ajustes apagados, e Infrastructure registra siempre los efectivos (`backend/Elevant.Infrastructure/DependencyInjection.cs`).
- El overlay del arnés E2E fija `AirTraffic__Enabled` en `${ELEVANT_E2E_AIR_TRAFFIC_ENABLED:-false}` y nunca sobrescribe la lista por índice: el recorrido no lee una red real salvo que alguien lo pida a propósito ([guía local](../workflows/local-development.md)).

**13. Pruebas sin red.** Los fixtures del adaptador son respuestas sintéticas con la forma real de readsb v2 y direcciones, matrículas, *callsign* y posiciones inventadas (`backend/tests/Elevant.UnitTests/Infrastructure/Fixtures/*.synthetic.json`). El HTTP se simula con un manejador de prueba. La única prueba que lee una red, `AirTrafficLiveTests`, hace una sola lectura alrededor de Punta Cana y solo corre con `ELEVANT_LIVE_AIR_TRAFFIC=1`, como `AeroDataBoxLiveTests`; CI nunca la activa.

## Consecuencias

- El mapa puede dibujar el tráfico real con los vuelos de ELEVANT reconocidos, y los vuelos de ELEVANT (también los demo) con claves estables, fase, posición e hitos, con dos lecturas: una de memoria cada 10 segundos y una SQL que se relee con `occ_planning`.
- Toda API que corre como Development lee adsb.fi cada 10 segundos mientras una pantalla lea la imagen aérea (desde el PR M5, cualquier mapa abierto) y hasta 15 minutos después de la última lectura: el VPS de Development y también el stack local sin el overlay del arnés. El VPS tiene que alcanzar `opendata.adsb.fi`, y `api.adsb.lol` para el relevo: es la comprobación del operador de [integraciones externas](../architecture/external-integrations.md).
- La licencia de adsb.fi limita su uso a la demostración: un uso comercial necesita permiso de adsb.fi, adsb.lol o un receptor propio.
- La imagen, las estelas, la demanda y el contador de adsb.lol viven en la memoria de una instancia, como la presencia operativa. Un reinicio los vacía, y una segunda instancia tendría su propia imagen y duplicaría las lecturas de la red.
- adsb.fi no da trazas: un avión recién elegido solo tiene la estela que la API vio desde que empezó la vigilancia, hasta 3 horas.
- Una `matchedFlightKey` puede llegar hasta 20 segundos tarde tras un cambio de planificación.
- `GET occ/traffic/aircraft` (OpenSky) y el panel regional del Panorama no cambian: el endpoint sigue apagado sin credenciales, y U3 retirará ese panel.

**Pruebas.**
- Unitarias: el adaptador y el parser con los fixtures sintéticos (perfiles, tierra, direcciones no ICAO, posiciones viejas, duplicados, consulta en cualquier cultura, clave solo donde se configura, `User-Agent`, cliente sin redirecciones, 429, 401 y 403, fallos, cancelación y contador de adsb.lol); el relevo; la configuración; el servicio de la imagen (sin llamadas sin demanda, `Warming`, una lectura por intervalo para todos, estelas y huecos, `Stale` y `Unavailable`, esperas, ritmo de 10 a 60, relevo visible en `source` y claves del emparejamiento); las esperas; el emparejamiento; las claves y las fases; y los manejadores de las tres lecturas.
- De la API, montando el host sin SQL: el worker (apagado, demanda, ritmo y una sola entrada por racha de fallos) y los endpoints (validación, estado en el 200, códigos y títulos, lector solo de planificación, estación con tráfico y la imagen de Development, que enciende el tráfico y sube el límite).
- De arquitectura: contratos sin `long` y con ids públicos, tres lecturas bajo `occ/map` y el worker, que solo depende de Application.
- SQL, contra SQL Server (`backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.MapFlights.cs`): seis casos, con propuestas, tramos, posiciones, hitos y el reloj demo; la clave que se conserva al importar; el enlace 3-N07; las fases; el avión en tierra pasada la medianoche; y las claves del emparejamiento sin vuelos demo.
- Del cliente compartido: los tres envoltorios, sus consultas, los validadores estrictos y el código `invalid_map_query`.

**Compatibilidad y despliegue.** Sin migración: `dotnet ef migrations has-pending-model-changes` sigue limpio. Las tres lecturas son aditivas, y ninguna respuesta que lee la tablet cambia. El backend, la persistencia y el overlay del arnés son entradas del release de base de datos, que sale sin cambio de esquema, y el snapshot y el cliente compartido lo son de las dos webs. Por eso, como en el PR A1, se despliegan juntos y en el orden habitual: release de base de datos, API, AVIAM Web y Public Web. El VPS no necesita variables nuevas; el operador comprueba antes que la API alcanza `opendata.adsb.fi`. Ninguna pantalla cambia hasta el PR M5.

**Queda fuera.**
- Las trazas del proveedor (`/trace` de adsb.lol): adsb.fi no las tiene, y la estela sale solo de la memoria.
- Un adaptador de OpenSky para este puerto; el endpoint viejo sigue como está.
- El ritmo de adsb.lol según su cuota restante: hoy tiene un contador diario fijo.
- El retiro de `GET occ/traffic/aircraft` y de los orígenes que ya no use la CSP, cuando ninguna pantalla los lea.
- Un receptor ADS-B propio en la rampa, la ruta profesional para la cobertura en tierra.
- El clima por la API (`occ/weather`), que entra con el PR M8.
