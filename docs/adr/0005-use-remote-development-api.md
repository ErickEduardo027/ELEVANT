# ADR-0005: API remota de Development

## Estado

Accepted — 2026-07-18; endpoint/topología amended by ADR-0008 — 2026-08-17.

## Contexto

Las dos webs y Mobile necesitan integrar contra un backend accesible desde navegadores y tablets. Solo mocks no valida HTTPS, CORS, serialización o deployment; usar Production sería inseguro.

## Decisión

Mantener una Elevant API remota Development aislada como destino común, además de mocks reemplazables. Development usa datos sintéticos, credenciales/volúmenes/backups propios y no comparte recursos con Production.

La URL original `api-dev.elevant.com` no está disponible todavía. ADR-0008 define temporalmente Tailscale Services/HTTPS (`elevant-dev-api.<tailnet>.ts.net`) y `ASPNETCORE_ENVIRONMENT=Development` hasta disponer de dominio real.

## Consecuencias

- clientes validan contrato/red sin ejecutar SQL local;
- el ambiente requiere operación, fixtures estables y compatibilidad;
- mocks siguen necesarios para estados deterministas/fallos;
- disponibilidad Development no convierte el VPS en dependencia de tests unitarios/CI.

Usar Production o exponer 1433 fueron rechazados.
