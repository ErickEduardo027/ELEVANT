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

## Regla para nuevos proveedores

Primero se define la necesidad del caso de uso y el puerto mínimo. Después se construye el adaptador. Si se cambia de proveedor, Domain y los contratos públicos solo cambian cuando cambie realmente el producto, no por la forma particular de la API externa.

