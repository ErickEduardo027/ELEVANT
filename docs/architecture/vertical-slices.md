# Vertical slices

Una feature agrupa el comportamiento necesario para un caso de uso en vez de repartirlo primero por tipo técnico. Domain, contratos públicos e Infrastructure conservan sus fronteras de proyecto, pero dentro de Application y Api el cambio se navega por capacidad.

## Contenido esperado de un slice

- request o comando interno;
- validación de entrada y reglas de autorización cuando existan;
- handler o servicio de aplicación;
- resultado interno explícito;
- proyección a contrato HTTP;
- pruebas unitarias y, cuando cruza una frontera, de integración.

El nombre documental `CreateFlight` es solo un ejemplo de organización; no afirma que exista una entidad o endpoint de vuelos. No se crean tipos de negocio hasta disponer de requisitos.

## Reglas

- Un controller traduce HTTP y delega; no implementa reglas de negocio.
- El handler no conoce `HttpContext`, códigos HTTP ni detalles de EF Core.
- Una consulta no devuelve `IQueryable` fuera de Infrastructure.
- El slice depende de interfaces pequeñas definidas donde se consumen.
- Los tipos generados del cliente nunca entran a Domain o Application.
- La cancelación se propaga en toda operación asíncrona.

## Revisión de un slice

Antes de aprobar, verificar happy path, validaciones, permisos, idempotencia si hay reintentos, efectos secundarios, concurrencia, telemetría segura, estados vacíos y errores. Una feature que necesita muchas abstracciones genéricas antes de resolver un caso real se mantiene simple y se refactoriza cuando aparezca repetición demostrable.

