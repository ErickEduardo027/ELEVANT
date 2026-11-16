# Estructura del repositorio

## Directorios principales

- `backend`: solución .NET plana con API, Domain, Application, Contracts,
  Infrastructure y tests.
- `database/DevelopmentDB`: EF Core, migraciones, DatabaseTool, Compose y
  operación SQL de Development.
- `database/ProductionDB`: límite futuro reservado; vacío salvo `.gitkeep`.
- `frontend/private-web`: aplicación AVIAM interna en Next.js/React.
- `frontend/public-web`: landing y portal de clientes en Next.js/React.
- `frontend/mobile-agent`: aplicación nativa Expo/React Native para agentes.
- `packages/api-client`: cliente TypeScript compartido y generado desde OpenAPI.
- `docs`: decisiones, arquitectura, workflows y operación.
- `scripts`: validaciones globales.
- `.github`: CI y colaboración.
- `backend-prototipo`: servidor y almacenamiento temporal de los prototipos; no se
  despliega como arquitectura final.

## Reglas de ubicación backend

Entidad/regla/evento puro → Domain. Caso de uso/puerto → Application. Contrato
HTTP → Contracts. Proveedores externos → Infrastructure. Controllers, middleware,
hubs y composición → Api. EF/SQL → `database/DevelopmentDB/Elevant.Persistence`.
Una tarea DB one-shot pertenece a `database/DevelopmentDB/Elevant.DatabaseTool` o
a sus scripts operativos.

## Reglas de ubicación frontend

Cada aplicación conserva componentes, features, adaptadores y configuración
propios. Los clientes no contienen SQL, secretos de servidor ni llamadas directas
a proveedores externos.

Los contratos HTTP comunes pertenecen a `packages/api-client`:

- `openapi/elevant-v1.json`: snapshot canónico del host API compilado, que CI
  exige reproducir en la imagen exacta certificada;
- `openapi/source.json`: descriptor cerrado con versión, ruta Swagger y huella
  SHA-256 canónica del snapshot, sin secretos ni identidad futura de CI;
- `generated`: salida reproducible de Orval; no se edita manualmente;
- `src`: API pública y adaptación manual del runtime `fetch` compartido;
- tests y configuración: validan generación, tipos, cancelación, autenticación y
  Problem Details sin depender de un frontend.

Private Web, Public Web y Mobile Agent consumen `@elevant/api-client`, pero cada
uno conserva su variable de URL base, sesión y adaptadores. No se copian DTOs de
endpoints entre aplicaciones ni se importa código .NET.

## Generados y privados

No versionar `bin`, `obj`, `node_modules`, `.next`, resultados de pruebas, `.env`,
backups, bases, uploads o firmas. `packages/api-client/generated` es la excepción
deliberada para código generado: se versiona junto con su snapshot y se comprueba
determinísticamente en CI. Otros `dist`, `build` y artefactos siguen excluidos.

El árbol resumido está en `generated-repository-tree.md`; el árbol real siempre se
consulta desde Git o el filesystem.
