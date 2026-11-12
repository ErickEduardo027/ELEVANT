# ADR-0041: Vuelos demo y posiciones de Punta Cana

## Estado

Accepted — 2026-11-12 para los vuelos demo, que entrega el PR A1 del plan «OCC a nivel NOC» (código de `cba00f73`). La sección 11, «Posiciones de Punta Cana», describe lo que llega con el PR A2: hasta ese PR es una decisión registrada, no código.

## Contexto

Erick quiere demostrar el ciclo operativo completo sin esperar a que un avión real de la aerolínea contratada llegue a Punta Cana. Pidió un botón en «Configuración» de Superadministración que dispare un vuelo: OCC lo ve llegar marcado como demo, lo importa y sigue el flujo normal (asignar, operar, revisar y facturar). Él elige en cuántos minutos llega el avión, que aparece ya en aproximación.

Lo que había no servía para eso:
- El feed de vuelos ([ADR-0028](0028-aerodatabox-flight-feed-with-unit-budget.md)) solo trae lo que informa AeroDataBox, de pago y con presupuesto de unidades. El proveedor simulado ([ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md)) solo existe en el arnés E2E, tiene un horario fijo y no convive con AeroDataBox, que es el feed del VPS de Development.
- `EfFlightFeedSyncStore.GetActivityAsync` no filtraba por proveedor: un vuelo cercano de otro proveedor adelantaba las lecturas pagadas de AeroDataBox (cada 15 minutos con un vuelo contratado a ±3 horas).
- El superadministrador no tiene permisos de OCC ni alcance de estación, y una notificación de OCC exige una operación: `ops.operational_notifications.ground_operation_id` no admite nulos.
- El plan no admite migraciones.

## Decisión

**1. Un vuelo demo son dos propuestas del proveedor «Demo».**
- Disparar un vuelo escribe dos filas de `integration.external_flight_proposals` con `Provider = "Demo"`. La llegada se programa a la hora de llegada a la posición (ahora más los minutos elegidos) con estado `Approaching`, y la salida, después del tiempo en tierra, con estado `Expected`. Las dos llevan el aeropuerto contraparte, el modelo del tipo de avión elegido («fabricante modelo»), la matrícula y, si se eligió una posición, su código en `Gate` y su terminal en `Terminal`. Su fecha operativa es el día local de la llegada.
- No hay tabla nueva ni migración: un vuelo demo no es más que esas dos filas (`database/DevelopmentDB/Elevant.Persistence/Integration/EfDemoFlightStore.cs`). Su id es el de la propuesta de llegada, y las dos comparten la referencia del proveedor (`{id}|Arrival` y `{id}|Departure`).
- Los números de vuelo y la matrícula se generan, nunca se escriben (`DemoFlightNumbering`). La llegada toma el primer número impar libre desde el 9001 y la salida el par siguiente (`ZZ9001` y `ZZ9002`), sin repetir ningún número que la estación ya conozca ese día (propuestas de cualquier proveedor y escalas no canceladas), para que la importación nunca se vincule a otro vuelo (3-N07). La matrícula va de `HIDM01` a `HIDM99` según la secuencia del día: ningún registro la emite, así que nunca coincide con un avión real.
- El aeropuerto contraparte sale de `ref.airports`, donde el catálogo completa la zona horaria y las coordenadas que falten, o del catálogo interno `DemoAirports` (MIA, JFK, YYZ, MAD, BOG y SDQ, el mismo que rota el feed simulado). Un código que no está en ninguno responde `409 demo_origin_unknown`. Ni el origen ni el destino pueden ser el aeropuerto de la estación (`400 invalid_demo_flight`); sin destino, el avión vuelve a su origen.
- La aerolínea debe estar activa (`409 airline_inactive`) y tener exactamente un contrato aplicable ese día en la estación (`contract_not_in_force`, `contract_ambiguous`), como exige la importación; el tipo de avión debe estar activo (`aircraft_type_unavailable`).
- Posición: «Sin posición» (`standChoice: "None"`) o una concreta (`"Specific"`). Debe ser una posición activa de una terminal activa, libre durante la escala según `StandAvailability` (con las reglas de posiciones combinadas y el tamaño del avión), y ningún otro vuelo demo activo puede ir a ella u ocuparla; si no, `409 stand_unavailable` con los motivos en `reasons`. Los códigos de posición se comparan con una sola regla, `StandCodes.Normalize` en C# y `normalizeStandCode` en JavaScript, con un archivo de casos compartido (`backend/Elevant.Application/Operations/StandCodes.vectors.json`): `A01`, `a-1` y `A1` son la misma posición, y nada infiere que `9A` sea `A9`.
- Rangos: de 2 a 30 minutos hasta la posición (8 por defecto) y de 20 a 240 en tierra (60 por defecto, para que una demostración pausada no genere recargo por tiempo extra). Como mucho tres vuelos demo activos por estación (`409 demo_flight_limit_reached`).

**2. Activación por entorno.** `DemoFlights:Mode` vale `Disabled`, por defecto y de forma explícita en `appsettings.Production.json`, o `Enabled`, en `appsettings.Development.json`, como `CardPayments:Mode` ([ADR-0036](0036-simulated-card-payment.md)). Con `Enabled` fuera de los entornos `Development`, `Test` o `Testing`, o con otro valor, la API no arranca (`backend/Elevant.Infrastructure/DependencyInjection.cs`). Los controladores, los esquemas y el worker se registran siempre, así que el OpenAPI no depende del modo: apagado, cada comando responde `409 demo_flights_unavailable` antes de validar la solicitud, las lecturas responden `enabled: false` y el worker no corre. El VPS de Development ejecuta la API como `Development`: no necesita variables nuevas.

**3. API, solo para el superadministrador.** `backend/Elevant.Api/Controllers/DemoFlightsController.cs`, bajo `api/v1/governance`. Cualquier otra cuenta recibe `403 forbidden`; los títulos de Problem Details están en español y cada negativa lleva su `code`.

| Operación | `operationId` | Respuesta |
| --- | --- | --- |
| `GET demo-flights/options?stationId=` | `GetDemoFlightOptions` | Estaciones, aerolíneas con un solo contrato vigente hoy, aeropuertos, tipos de avión, posiciones activas con `free`, límites y avisos que no bloquean (`no_occ_accounts`, `crosses_local_midnight`). |
| `GET demo-flights?stationId=` | `ListDemoFlights` | Los vuelos demo de las últimas 24 horas, del más reciente al más antiguo (50 como máximo), con sus instantes y `serverTime`. |
| `POST demo-flights` | `CreateDemoFlight` | `201` con el vuelo; `200` al repetir la misma clave. |
| `POST demo-flights/{demoFlightId}/cancel` | `CancelDemoFlight` | `200` con el vuelo; cuerpo `{ "intent": "Cancel" }` o `{ "intent": "Finish" }`. |

Sin estación, las opciones y la lista toman PUJ, o la primera estación activa. Los comandos exigen `Idempotency-Key`, aceptan 2048 bytes como máximo y corren con `MasterDataCommand.RunAsync`: el recibo, el trabajo y el commit en una transacción serializable. La misma clave con el mismo cuerpo devuelve el mismo vuelo sin repetir auditoría ni avisos; con otro cuerpo, `409 idempotency_conflict`. Los códigos nuevos (`demo_flights_unavailable`, `invalid_demo_flight`, `demo_origin_unknown`, `demo_flight_limit_reached` y `demo_flight_closed`) están en `packages/api-client/src/errors.ts`, y las respuestas pasan por validadores estrictos (`packages/api-client/src/demoFlights.ts`).

**4. El reloj es del servidor (`DemoFlightTimeline`).** Una sola clase pura de Application (`backend/Elevant.Application/Integration/DemoFlights/DemoFlightTimeline.cs`), que usan el worker y todas las lecturas. La API entrega los instantes ya calculados y su propia hora; ningún cliente deriva uno.
- El avión aparece al dispararse. El rodaje de llegada es el 45 % del tiempo hasta la posición, entre 90 segundos y 5 minutos, y el avión toca pista a la hora de llegada a la posición menos ese rodaje.
- Sale de la posición por la primera regla que aplica: el despegue ya marcado menos el rodaje de salida; el hito `PUSHBACK` de la tablet; la entrega de la operación sin push-back; «Terminar demo»; si OCC lo importó (tramo enlazado y escala ni cancelada ni desviada), espera en la posición, hasta 2 horas después de su salida programada; si nadie lo importó, sale a su hora programada. Lo que ocurre antes de que el avión se estacione cuenta desde su llegada a la posición.
- El rodaje de salida dura 5 minutos; el avión despega al terminarlo y se sigue viendo 10 minutos más.
- Fases: `Approach`, `TaxiIn`, `Parked`, `TaxiOut`, `Departed` y `Gone`. Estados: `Cancelled` (cancelado antes de tocar pista, o descartado por OCC antes de importarlo), `Finished` (despegue marcado, descarte del worker o avión ya desaparecido) y `Active`. Solo los activos cuentan para el límite.

**5. Avance automático (`DemoFlightProgressWorker`).** Cada 5 segundos, y solo con el modo encendido, el worker (`backend/Elevant.Api/Integration/DemoFlightProgressWorker.cs`) llama a `IDemoFlightStore.AdvanceAsync`:
- A una pareja que OCC no importó **no le escribe nada** hasta que el avión desaparece; entonces la descarta sin cuenta, con la auditoría de sistema `governance.demo_flight.expired`. Mientras tanto, la revisión del feed calcula su estado y su hora de pista con el reloj al leerla, así que la versión que OCC leyó sigue sirviendo para importar.
- Una vez importada, escribe lo que escribiría el feed pagado. Al tocar pista: la hora de pista y `Arrived` en la propuesta, y la hora real en el tramo si sigue siendo del proveedor (`Source = ExternalProvider`; un tramo que OCC registró a mano no se toca). Al despegar: lo mismo en la salida, con `Departed`. También marca el aterrizaje de un vuelo importado después de tocar pista. No marca «Delayed» ni cambia el estado de la escala.
- Anuncia un `occ_planning` por estación que cambió en cada pasada.
- Un fallo de base de datos se reintenta en la pasada siguiente y se registra una sola vez por racha, así que la imagen certificada sin base de datos ni se detiene ni llena su registro.

**6. Cancelar o terminar por intención.** `CancelDemoFlight` lleva la intención, no una versión esperada: las marcas del worker dejan viejas las versiones a propósito. Antes de tocar pista solo vale «Cancelar vuelo» (`Cancel`) y después, «Terminar demo» (`Finish`); la otra intención responde `409 version_conflict` (la pantalla leyó una fase anterior y relee). Un vuelo ya cancelado o terminado, o cuya salida ya está decidida (push-back, entrega, un «Terminar demo» anterior o el fin de la espera), responde `409 demo_flight_closed`.
- «Cancelar vuelo» es una cancelación del proveedor: las dos propuestas pasan a `Canceled`, y las que nadie importó quedan descartadas con la cuenta del superadministrador, así que salen de la revisión de OCC. Si OCC ya lo había importado, recibe una sola vez el aviso existente `flight_cancelled_by_provider` y decide qué hacer con la escala: el superadministrador no la toca.
- «Terminar demo» sobre un vuelo sin importar marca ahora la hora de pista de la salida y descarta las dos propuestas sin cuenta: el vuelo queda terminado. Sobre uno importado adelanta la salida (`RevisedAt`, nunca antes de la llegada a la posición, estado `GateClosed` y hora estimada en el tramo del proveedor), y el worker marca el despegue 5 minutos después.
- Nunca se borra nada.

**7. El feed pagado no ve los vuelos demo.** `GetActivityAsync` excluye las propuestas del proveedor «Demo» y las escalas con `ExternalProvider = "Demo"`, con el caso nulo escrito aparte para que una escala manual siga contando: un vuelo demo nunca adelanta una lectura de AeroDataBox ni gasta unidades, y lo comprueba una prueba SQL con el proveedor AeroDataBox. La revisión del feed nunca empareja tramos de proveedores distintos ni de dos vuelos demo distintos, la importación rechaza esa pareja con `flight_proposals_not_pairable`, y una propuesta demo descartada no se restaura (`flight_proposal_passed`). Ver la nota fechada de [ADR-0028](0028-aerodatabox-flight-feed-with-unit-budget.md).

**8. Marca `isDemo`.** `OccFlightProposalResponse`, `OccTurnaroundResponse` y `OccPositionTurnaroundResponse` llevan `isDemo`, que solo se escribe cuando es verdadero: el OpenAPI la declara opcional y un cliente desplegado antes sigue validando toda respuesta sin vuelos demo. Los validadores del cliente compartido aceptan la clave ausente o `true`. La app de la tablet no lee esas respuestas.

**9. Auditoría y avisos.**
- `governance.demo_flight.created` guarda los números, la aerolínea, el origen, el destino, la matrícula, los minutos, el tiempo en tierra, la posición y el estado; `governance.demo_flight.cancelled` y `governance.demo_flight.finished`, el cambio de estado. Los campos `demo_flight.*` están en la lista cerrada `SafeAuditChanges`, así que el registro nunca queda vacío. Las marcas de pista del worker no se auditan, como las del feed.
- El disparo, la cancelación, «Terminar demo» y el worker anuncian `occ_planning` a las cuentas de OCC de la estación. Disparar un vuelo no escribe ninguna notificación de campana: pediría una migración, y el vuelo ya aparece en los vuelos propuestos.

**10. Pantallas.**
- **Superadministración → Configuración**, panel «Vuelo demo» (`frontend/private-web/src/features/governance/DemoFlightsPanel.jsx`), encima de «Correo del sistema». Dice si el entorno permite vuelos demo. El formulario «Disparar vuelo demo» pide estación, aerolínea con contrato vigente hoy, origen, destino («El mismo aeropuerto» por defecto), tipo de avión, «Sin posición» o una posición libre, «Llega a la posición en (minutos)», con atajos de 3, 5, 8 y 15, y «Tiempo en tierra (minutos)». La lista «Vuelos demo de hoy» muestra la fase y la cuenta regresiva, calculadas en el navegador con el reloj del servidor, si OCC ya importó el vuelo y con qué posición, y ofrece «Cancelar vuelo» o «Terminar demo» con su confirmación. Se relee cada 5 segundos mientras un avión se mueve y cada 20 si no, nunca con la pestaña oculta. Cada código se explica en español; el título del servidor nunca se muestra.
- **OCC → Planificación → «Importar vuelos»** (`frontend/private-web/src/features/planning/components/ProviderFlightsDialog.jsx`): los tramos demo llevan la etiqueta «Demo»; el diálogo relee con `occ_planning` sin perder lo que OCC eligió; la posición cuyo código normalizado coincide con la puerta de la llegada demo viene preseleccionada («Posición (sugerida)»), y las posiciones van en orden natural (A1, A2, A10).
- La etiqueta «Demo» aparece también en la tarjeta de Planificación, en el cajón del Mapa de posiciones y en la fila del tablero del Panorama.

**11. Posiciones de Punta Cana (llega con el PR A2).**
- `POST governance/demo-station` (`PrepareDemoStation`), solo para PUJ y con el mismo modo, creará las terminales A, B y FBO y las 41 posiciones del documento de coordenadas de Erick (sin la B33), sin coordenadas: adoptará por código normalizado las que ya existan y no cambiará ni borrará nada.
- La posición «Al azar» será la opción por defecto: el servidor la sortea, con la clave de idempotencia como semilla, entre las posiciones ubicadas, libres y cubiertas a la hora de llegada por un agente que pasa la regla real de asignación. Las opciones sumarán `located`, `eligible` y sus motivos, y los avisos `no_located_stands` y `no_eligible_stand`; una posición concreta que no sea elegible responderá `409 stand_not_eligible`.
- Una posición dejará de contar como ocupada cuando la tablet registre el `PUSHBACK`, sin cerrar su asignación.

Hasta ese PR, `standChoice: "Random"` responde `400 invalid_demo_flight`, las opciones no traen esos campos y el push-back no libera la posición: el vuelo la sigue ocupando hasta que OCC la libera o aprueba la revisión.

## Consecuencias

- La demostración corre de punta a punta en las pantallas de hoy: Superadministración dispara el vuelo; OCC lo importa, lo asigna y lo opera; el aterrizaje y el despegue quedan marcados, y AeroDataBox no gasta unidades.
- Un vuelo demo importado es una escala real de esa aerolínea en la base de Development: aparece en su portal y se factura. Se reconoce por `Turnaround.ExternalProvider = "Demo"`, pero ni el portal ni Finanzas lo marcan; conviene usar una aerolínea de prueba, como «Demo Airlines» de la semilla.
- La lista de Superadministración se lee por sondeo, porque el superadministrador no recibe `occ_planning`.
- Un avión importado que nadie opera espera hasta 2 horas en su posición y cuenta para el límite de 3 mientras tanto.
- Los números de vuelo solo esquivan los vuelos que la estación conoce al dispararse: un vuelo real de la misma aerolínea con ese número que el feed trajera más tarde ese día se vincularía a la escala demo (3-N07).

**Pruebas.** Unitarias del reloj, las reglas, la numeración, el catálogo de aeropuertos, la regla de códigos de posición con sus casos compartidos, el manejador y la configuración; de la API (endpoints, títulos y códigos, y el worker); de arquitectura (contratos sin `long`, contratos de escritura que rechazan miembros desconocidos, rutas bajo `governance`, la marca opcional y el worker que solo depende de Application); 15 pruebas SQL del almacén (`backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.DemoFlights.cs`); del cliente compartido, y de private-web (panel, estado, servicio, diálogo de importación, etiquetas y `normalizeStandCode`). El arnés del ciclo suma el proyecto `demo` (`frontend/public-web/tests/e2e-cycle/demo-vuelo.spec.ts`), que corre contra el stack local y nunca en CI.

**Compatibilidad y despliegue.** Sin migración: `dotnet ef migrations has-pending-model-changes` sigue limpio. Los endpoints y la marca son aditivos. Un AVIAM Web anterior rechazaría la lista del feed mientras contenga un vuelo demo, porque su validador no conoce `isDemo`: la API, AVIAM Web, Public Web y el release de base de datos (sin cambio de esquema; la persistencia es entrada de ese release) se despliegan juntos. Producción no los activa: con el modo encendido allí, la API no arranca.

**Queda fuera.** La imagen aérea y los vuelos para el mapa (PR A3, ADR-0042), el avión demo en los mapas y su cinemática (carril de mapas), la notificación de campana al disparar y una marca del vuelo demo en el portal y en Finanzas.
