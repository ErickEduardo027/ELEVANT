# ADR-0004: Centralizar el acceso a APIs externas

## Estado

Accepted — 2026-07-18.

## Contexto

Web y Mobile Agent podrían necesitar información de un proveedor como FlightAware. Exponer la credencial o llamar al proveedor desde cada cliente impediría controlar cuota, caché, errores y cambios de contrato. También revelaría detalles comerciales y dificultaría reemplazar el proveedor.

## Decisión

Todas las llamadas a APIs externas se realizan desde Infrastructure, detrás de puertos definidos por Application. Los clientes consumen únicamente la API Elevant. El modelo externo se traduce a tipos internos neutrales y después a contratos públicos mínimos.

El scaffold puede definir `IFlightInformationProvider` y opciones, pero no registra un adaptador funcional hasta confirmar el producto, endpoint, autenticación, límites y política de resiliencia oficiales.

## Consecuencias

- Las credenciales permanecen en el servidor y separadas por ambiente.
- El backend controla timeout, reintentos seguros, caché, cuota y observabilidad.
- Los clientes reciben un contrato estable aunque cambie el proveedor.
- La API asume costo y responsabilidad de disponibilidad/degradación.
- Se requieren pruebas con dobles y monitoreo de cuota antes de activar tráfico real.

## Alternativas consideradas

- Llamadas directas desde web/móvil: rechazadas por seguridad, CORS, cuota y acoplamiento.
- Biblioteca del proveedor compartida con todos los clientes: rechazada porque filtra su contrato.
- Stub que devuelve datos vacíos en Production: rechazado porque simula éxito y oculta que la integración no existe.

