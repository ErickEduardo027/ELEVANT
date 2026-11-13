# Integraciones externas

Una integración se encapsula en Infrastructure detrás de un puerto definido por Application. Los casos de uso trabajan con consultas y resultados neutrales, no con DTO, excepciones ni URLs del proveedor.

## FlightAware

`IFlightInformationProvider` representa el límite previsto para consultar información de vuelos. El scaffold puede enlazar opciones de configuración y reservar su estructura, pero no registra una implementación que devuelva colecciones vacías como si fueran respuestas reales. Tampoco inventa endpoints, headers o políticas sin confirmar el producto contratado y la documentación oficial vigente.

Antes de habilitar tráfico real se debe definir:

- finalidad y campos mínimos;
- API y plan contratado;
- autenticación y custodia de la credencial;
- límites, cuotas y política de caché;
- timeouts, reintentos seguros y circuit breaker;
- mapeo de errores y degradación visible;
- datos que pueden persistirse y su retención;
- pruebas mediante un servidor simulado, sin consumir cuota real en CI.

Las claves solo entran como secretos de ambiente. No se exponen a web/móvil, OpenAPI, logs, Problem Details ni archivos de configuración versionados.

## Feed de vuelos: AeroDataBox y proveedor simulado

El feed de vuelos que sí está conectado es AeroDataBox, detrás del puerto `IAirportFlightFeed` ([ADR-0028](../adr/0028-aerodatabox-flight-feed-with-unit-budget.md)). Solo el servidor lo llama, con un presupuesto de unidades, y sin `AeroDataBox:Enabled` y una clave no hay ninguna llamada.

El mismo puerto tiene un segundo adaptador, `SimulatedAirportFlightFeed` ([ADR-0038](../adr/0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md)), para recorrer el ciclo sin gastar la cuota:

- Se activa con `SimulatedFlightFeed:Enabled=true` y está apagado por defecto. La API se niega a arrancar si se activa fuera de los entornos `Development` o `Test`, o junto con AeroDataBox.
- Responde un horario determinista de las aerolíneas activas registradas, sin red, con su propio nombre de proveedor (`Simulated`), así que su registro de uso, su candado y su presupuesto no se mezclan con los de AeroDataBox.
- No alimenta el registro de aerolíneas observadas.
- Solo lo activa el overlay del arnés E2E, `database/DevelopmentDB/compose.local.e2e.yml`. La plantilla del VPS Development no lo define.

Desde la fase 3 del ciclo ([ADR-0039](../adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)), lo que informa el proveedor nunca reemplaza una decisión de OCC:

- Importar un par que coincide con una escala abierta de la misma estación, aerolínea, número de vuelo normalizado y día local lo vincula a esa escala (`linked`) en lugar de crear otra.
- Cuando OCC registra la llegada, el tramo pasa a `Manual` y las lecturas posteriores ya no reescriben su hora real.
- Si el proveedor informa cancelado o desviado un vuelo importado, OCC recibe un aviso una sola vez y decide; el feed no cancela ni desvía nada.

## Pasarela de tarjeta: simulada y apagada por defecto

El pago con tarjeta del portal pasa por el puerto `ICardPaymentGateway` de Application ([ADR-0036](../adr/0036-simulated-card-payment.md)). No hay adaptador de un proveedor real: `SimulatedCardGateway` aprueba o rechaza en memoria las tarjetas de prueba, sin red, y `DisabledCardGateway` ocupa el puerto cuando no hay pasarela. Desde la fase 4 del ciclo ([ADR-0040](../adr/0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md)):

- `CardPayments:Mode` elige el adaptador: `Disabled`, por defecto y en `appsettings.Production.json`, o `Simulated`, en `appsettings.Development.json` y en el overlay del arnés E2E. La API se niega a arrancar con `Simulated` fuera de los entornos `Development`, `Test` o `Testing`, o con un valor desconocido.
- Sin pasarela, `GET airline/portal/card-payments/availability` lo dice, el portal muestra el pago como no disponible y el pago responde `409 card_payments_unavailable` antes de mirar la tarjeta; `DisabledCardGateway` falla si algo llegara a llamarlo.
- De la tarjeta solo se guardan la marca y los últimos 4 dígitos, junto al estado del intento, su código de rechazo y la autorización; nunca el número, el CVV ni el titular.

## Vuelos demo: sin proveedor externo

Los vuelos demo que dispara Superadministración ([ADR-0041](../adr/0041-demo-flights-and-punta-cana-stands.md)) no llaman a ningún proveedor. La API escribe en `integration.external_flight_proposals` dos propuestas de un proveedor propio, `Demo`, y `DemoFlightProgressWorker` las hace avanzar con el reloj del servidor (`DemoFlightTimeline`):

- `DemoFlights:Mode` los activa: `Disabled` por defecto y en `appsettings.Production.json`, y `Enabled` en `appsettings.Development.json`. La API se niega a arrancar con `Enabled` fuera de los entornos `Development`, `Test` o `Testing`, o con un valor desconocido. Apagados, los endpoints existen igual: las lecturas responden `enabled: false` y los comandos, `409 demo_flights_unavailable`.
- No tocan el feed pagado: `GetActivityAsync` excluye sus propuestas y sus escalas, así que nunca adelantan una lectura de AeroDataBox ni gastan unidades. La revisión de OCC no empareja tramos de proveedores distintos, y una propuesta demo descartada no se restaura.
- Su matrícula (`HIDM01` a `HIDM99`) no la emite ningún registro, así que nunca coincide con un avión real, y sus números de vuelo (desde el 9001) esquivan los que la estación ya conoce ese día.
- El aeropuerto contraparte sale de `ref.airports` o del catálogo interno `DemoAirports`, con datos públicos de referencia, sin consultar a nadie.

## Tráfico aéreo en vivo: adsb.fi y adsb.lol

La imagen aérea del mapa del OCC ([ADR-0042](../adr/0042-occ-air-picture-and-map-flights.md)) lee dos redes ADS-B abiertas que responden en el JSON v2 de readsb, detrás del puerto `IAirTrafficProvider`: adsb.fi y, de relevo, adsb.lol. Solo el servidor las llama, desde `AirTrafficPollWorker`; los navegadores leen `GET occ/map/air-picture` y la CSP no cambia.

| Red | Consulta | Licencia y crédito | Clave y límite |
| --- | --- | --- | --- |
| adsb.fi | `https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}` | Uso personal y no comercial: citar adsb.fi con un enlace a `https://adsb.fi` | Sin clave; como mucho una consulta por segundo |
| adsb.lol | `https://api.adsb.lol/v2/point/{lat}/{lon}/{nm}` | ODbL 1.0 (`https://opendatacommons.org/licenses/odbl/1-0/`), con crédito a `https://adsb.lol` | Clave opcional en la cabecera `x-api-key`; la API se detiene en 450 lecturas por día UTC sin clave y en 900 con clave, antes de las 500 y 1 000 que admite la red |

- **Cadencia.** Solo con demanda: cada lectura de la imagen mantiene las lecturas de la red durante `IdleAfterSeconds` (900 s), y sin nadie mirando no hay ninguna llamada. Hay una lectura de la red cada `IntervalSeconds` (10 s, nunca menos) para todas las pantallas. Tras un 429 se espera lo que pida `Retry-After`, y al menos 60 s; tras un 401 o un 403, o con el límite diario agotado, 30 minutos; y tras un fallo, de 15 s a 5 minutos. Después de tres fallos seguidos toma el turno la red siguiente de `AirTraffic:Providers`, y la primera se vuelve a probar cada 10 minutos, o cuando pase su `Retry-After` si pide más (un día como máximo). Si esa prueba falla, la red activa responde la misma lectura: ni el lector espera ni la imagen cambia de estado por ella.
- **Petición.** Un `GET` de 250 NM alrededor de Punta Cana, sin redirecciones, con 10 s para la respuesta completa, respuestas comprimidas, 8 MiB como máximo, `Accept: application/json` y el `User-Agent` genérico `air-traffic-reader/1.0`, que no nombra el proyecto ni lleva correos ni direcciones.
- **Crédito.** Cada respuesta lleva el de la red en `source` (nombre, página, licencia y enlace a la licencia), y cada mapa que dibuje estos aviones, desde el PR M5, mostrará «Datos de aeronaves: {source.name}» con su enlace. adsb.fi solo sirve para la demostración de Development: antes de un uso comercial hace falta un permiso escrito de adsb.fi, cambiar a adsb.lol o un receptor ADS-B propio.
- **Nada se guarda.** La imagen y las estelas viven en la memoria de la API, sin tabla, registro de uso ni migración. Las pruebas usan respuestas sintéticas y nunca llaman a la red; `AirTrafficLiveTests` lee la red real solo con `ELEVANT_LIVE_AIR_TRAFFIC=1`.
- **Activación.** `AirTraffic:Enabled` es `false` por defecto y en `appsettings.Production.json`. `appsettings.Development.json` lo enciende con `Providers` `AdsbFi` y `AdsbLol`, así que el VPS de Development y el stack local lo usan sin variables nuevas. El overlay del arnés E2E lo apaga salvo `ELEVANT_E2E_AIR_TRAFFIC_ENABLED=true` ([desarrollo local](../workflows/local-development.md)). Un valor inválido de la sección impide arrancar la API.
- **Clave opcional, solo de adsb.lol.** Development no la necesita. Si se quiere, llega como secreto de ambiente, nunca en un archivo versionado:

  ```text
  AirTraffic__ApiKey=REPLACE_ME_API_KEY
  ```

  Nunca se envía a adsb.fi, y no aparece en logs, Problem Details ni OpenAPI. La plantilla del VPS (`backend/compose.development.api.yml`) todavía no la pasa: usarla allí pide añadir esa entrada en un PR y la variable en el Environment del proyecto API, como la clave de AeroDataBox.

**Comprobación del operador.** Antes de desplegar la API que trae el tráfico, el operador comprueba a mano, una sola vez y nunca desde CI, que la red de la API en el VPS alcanza adsb.fi. Usa la misma imagen de curl de los checklists de la [configuración de Dokploy](../deployment/dokploy-configuration.md), con una consulta de 1 NM alrededor de Punta Cana cuya respuesta se descarta:

```bash
docker run --rm --network elevant-dev-api-runtime curlimages/curl:8.22.0@sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777 -s -o /dev/null -w '%{http_code}\n' --max-time 10 -A 'air-traffic-reader/1.0' https://opendata.adsb.fi/api/v3/lat/18.5674/lon/-68.3634/dist/1
```

Debe responder `200`. Un `000` significa que la red no sale. Un `403` o un `429` significa que adsb.fi rechaza o frena esa dirección: la API pasará a adsb.lol tras tres fallos. Para comprobar también el relevo, se repite la línea con `https://api.adsb.lol/v2/point/18.5674/-68.3634/1`, que gasta una de las 500 consultas diarias de esa dirección.

El tráfico de OpenSky (`GET occ/traffic/aircraft`) no cambia: sigue apagado sin credenciales y no pasa por este puerto.

## Regla para nuevos proveedores

Primero se define la necesidad del caso de uso y el puerto mínimo. Después se construye el adaptador. Si se cambia de proveedor, Domain y los contratos públicos solo cambian cuando cambie realmente el producto, no por la forma particular de la API externa.

