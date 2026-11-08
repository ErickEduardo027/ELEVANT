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

## Regla para nuevos proveedores

Primero se define la necesidad del caso de uso y el puerto mínimo. Después se construye el adaptador. Si se cambia de proveedor, Domain y los contratos públicos solo cambian cuando cambie realmente el producto, no por la forma particular de la API externa.

