# Fronteras de integración

## Cliente a backend

Web y móvil consumen contratos publicados por Api. No importan ensamblados .NET, no conocen tablas y no llaman al proveedor de vuelos. El cliente TypeScript se genera desde OpenAPI cuando ADR-0007 sea aceptado.

## Backend a SQL Server

Infrastructure posee el `DbContext` y las configuraciones. Application solicita repositorios o puertos orientados al caso de uso; no compone SQL. La conexión entra mediante un secreto de ambiente y el usuario de la aplicación recibe solo permisos necesarios.

## Backend a FlightAware

Application define una consulta neutral mediante `IFlightInformationProvider`. Infrastructure mapeará a la API concreta después de confirmar documentación, plan y límites. Un fallo externo se traduce a un resultado controlado y nunca expone el cuerpo, credencial o URL interna del proveedor.

## Backend a clientes en tiempo real

Api publica hubs SignalR. Los mensajes tienen contratos versionados y autorización antes de transportar información real. REST sigue siendo canónico.

## Reglas comunes

- timeout obligatorio para red y cancelación propagada;
- reintentos únicamente para operaciones seguras o idempotentes;
- identificadores de correlación sin payload sensible;
- métricas por resultado y latencia, no por datos personales;
- pruebas con dobles o servidores simulados en CI;
- configuración separada por ambiente.

