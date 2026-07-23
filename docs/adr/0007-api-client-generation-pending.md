# ADR-0007: Seleccionar la generación del cliente API

## Estado

Proposed — 2026-07-18.

## Contexto

Web y Mobile Agent deben consumir el mismo contrato OpenAPI sin mantener DTO y llamadas HTTP duplicados. El repositorio reserva `packages/api-client/openapi` como entrada y `generated` como salida, pero todavía no existe una aplicación TypeScript ni una prueba representativa que permita elegir con evidencia.

Kiota, NSwag y Orval pueden generar clientes, pero difieren en runtime, ergonomía, tratamiento de Problem Details, React integration, tamaño, soporte de OpenAPI y reproducibilidad.

## Decisión

Pendiente. Antes de aceptar esta ADR se construirá el mismo slice pequeño con cada candidato viable y se evaluará:

- compatibilidad con el documento de Swashbuckle;
- uso compartido en Next/Astro y Expo sin APIs exclusivas de Node;
- manejo de URL, cancelación, autenticación futura y Problem Details;
- salida determinista con versión fijada;
- tamaño y facilidad de depuración;
- mantenimiento activo y licencia;
- integración con pnpm y CI.

Mientras esté `Proposed`, no se añade código generado ni se construye un cliente manual que se convierta accidentalmente en estándar.

## Consecuencias

- Se retrasa deliberadamente una dependencia hasta contar con consumidores reales.
- Los contratos se preparan para generación y se evita editar `generated`.
- La primera feature de cliente deberá incluir el spike y la actualización de esta ADR.
- Una vez aceptada, el generador y su runtime se fijarán en lockfile y CI verificará que la salida esté actualizada.

## Alternativas consideradas

- Kiota: candidato por generación fuertemente tipada y enfoque en OpenAPI.
- NSwag: candidato por cercanía al ecosistema .NET y TypeScript.
- Orval: candidato por ergonomía TypeScript y opciones de cliente.
- Cliente HTTP completamente manual: simple al inicio, pero propenso a deriva entre dos aplicaciones.
- Compartir directamente tipos de C#: rechazado porque no representa el contrato HTTP ni el runtime TypeScript.

