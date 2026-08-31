# Estructura del repositorio

## Directorios principales

- `backend`: solución .NET plana con API, Domain, Application, Contracts, Infrastructure y tests.
- `database/DevelopmentDB`: EF Core, migraciones, DatabaseTool, Compose y operación SQL de Development.
- `database/ProductionDB`: límite futuro reservado; vacío salvo `.gitkeep`.
- `frontend/private-web`: AVIAM Web interno en Vite/React.
- `frontend/public-web`: landing/portal de clientes en Next/React.
- `frontend/mobile-agent`: app nativa Expo/React Native para agentes.
- `packages/api-client`: entrada OpenAPI/salida generada cuando se habilite.
- `docs`: decisiones, arquitectura, workflows y operación.
- `scripts`: validaciones globales.
- `.github`: CI y colaboración.
- `backend-prototipo`: servidor/almacenamiento local temporal usado por los prototipos; no se despliega como arquitectura final.

## Reglas de ubicación backend

Entidad/regla/evento puro -> Domain. Caso de uso/puerto -> Application. Contrato HTTP -> Contracts. Proveedores externos -> Infrastructure. Controllers/middleware/hubs/composición -> Api. EF/SQL -> `database/DevelopmentDB/Elevant.Persistence`. Tarea DB one-shot -> `database/DevelopmentDB/Elevant.DatabaseTool` o sus scripts operativos.

## Reglas de ubicación frontend

Cada aplicación conserva componentes/features/adaptadores/configuración propios. Contratos generados comunes pertenecen a `packages/api-client`; no se copian tipos de endpoints entre aplicaciones. Los clientes no contienen SQL, secretos de servidor o llamadas directas a proveedores.

## Generados y privados

No versionar `bin`, `obj`, `node_modules`, `.next`, `dist`, resultados de pruebas, `.env`, backups, bases, uploads o firmas. El árbol resumido está en `generated-repository-tree.md`; el árbol real siempre se consulta desde Git/filesystem.
