# Paquetes compartidos

Este directorio contiene fronteras reutilizables entre aplicaciones. Un paquete
solo existe cuando tiene varios consumidores reales o encapsula un contrato
técnico claro; no es un depósito genérico de utilidades.

## `@elevant/api-client`

`packages/api-client` es el único cliente TypeScript del backend para Private Web,
Public Web y Mobile Agent. Incluye:

- el snapshot OpenAPI v1 canónico, versionado y con procedencia verificable;
- la salida de Orval `8.27.0`;
- una capa `fetch` independiente de framework para URL base, token vigente,
  cancelación y Problem Details;
- checks deterministas que se ejecutan sin VPS ni Tailscale.

El paquete usa su propio `package-lock.json`. Desde su directorio, la instalación
reproducible se hace con `npm ci` y la validación completa con `npm run check`. La
URL y autenticación siempre las aporta el consumidor en runtime; nunca se guardan
URLs de Production, tokens ni secretos en este árbol.

Cada consumidor expone únicamente su URL pública de configuración:

- Private Web: `VITE_ELEVANT_API_URL`;
- Public Web: `NEXT_PUBLIC_ELEVANT_API_URL`;
- Mobile Agent: `EXPO_PUBLIC_ELEVANT_API_URL`.

Esas variables contienen una URL, nunca un token. La obtención y custodia de la
sesión siguen perteneciendo a cada aplicación.

Para comparar otro documento contra el snapshot sin modificar archivos se usa
`npm run check:openapi -- <archivo-o-URL>`. CI lo ejecuta contra el Swagger del
host construido localmente para el mismo commit.

Consulte [ADR-0007](../docs/adr/0007-api-client-generation.md) para la
decisión técnica y el [contrato OpenAPI](../docs/api/openapi-contract.md) para el
flujo de actualización y las reglas de compatibilidad.
