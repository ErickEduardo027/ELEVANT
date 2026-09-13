# Fronteras de integración

## Cliente a backend

Web y móvil consumen contratos publicados por Api. No importan ensamblados
.NET, no conocen tablas y no llaman al proveedor de vuelos. Según ADR-0007, los
tres clientes incorporan `@elevant/api-client`, generado desde el snapshot
OpenAPI versionado y adaptado mediante una capa `fetch` común y sin estado global.
Hoy el snapshot sólo contiene `GetSystemPing`: depender del paquete no demuestra
que sus flujos de negocio estén integrados con la API.

## Backend a SQL Server

`database/DevelopmentDB/Elevant.Persistence` posee el `DbContext`, las
configuraciones, Identity y las migraciones. Application debe solicitar puertos
orientados al caso de uso cuando existan handlers; no compone SQL. La conexión
entra mediante configuración secreta del ambiente. La API no ejecuta migración
ni seed al arrancar.

## Backend a FlightAware

Application define una consulta neutral mediante `IFlightInformationProvider`.
Infrastructure sólo enlaza opciones y reserva una clase cliente vacía; no hay
implementación registrada, transporte ni llamada real. Cuando se apruebe el
proveedor, deberá mapear fallos a resultados controlados sin exponer cuerpo,
credencial o URL interna.

## Backend a clientes en tiempo real

Api mapea dos hubs SignalR vacíos. Todavía no existen mensajes de negocio,
contratos de eventos ni autorización del handshake. Esos controles son requisitos
previos a transportar datos reales; REST seguirá siendo canónico.

## Reglas comunes

- timeout obligatorio para red y cancelación propagada;
- reintentos únicamente para operaciones seguras o idempotentes;
- identificadores de correlación sin payload sensible;
- métricas por resultado y latencia, no por datos personales;
- pruebas con dobles o servidores simulados en CI;
- configuración separada por ambiente.
