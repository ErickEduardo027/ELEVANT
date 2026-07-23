# Estructura del repositorio

## Directorios principales

- `backend/Elevant.sln`: solución exclusiva del backend.
- `backend/src`: proyectos productivos de Clean Architecture.
- `backend/tests`: pruebas unitarias, de integración y de arquitectura.
- `backend/database`: documentación, seeds y utilidades de SQL Server.
- `backend/infrastructure`: Docker, Dokploy, proxy, monitoreo y backups.
- `backend/scripts`: automatización de build, migraciones y despliegue del servidor.
- `frontend/web`: esqueleto y guía de la aplicación web.
- `frontend/mobile-agent`: esqueleto y guía de la aplicación móvil.
- `packages/api-client`: entrada OpenAPI y salida del cliente generado.
- `packages/eslint-config`: configuración compartida futura.
- `packages/typescript-config`: configuración TypeScript futura.
- `docs`: arquitectura, decisiones y procedimientos.
- `scripts`: comprobaciones globales del monorepositorio.
- `.github`: CI y plantillas de colaboración.

La raíz física del monorepositorio se denomina `ELEVANT`. La división superior
`backend`/`frontend` hace visible el límite entre servicios del servidor y
aplicaciones cliente. `backend` es autónomo: contiene incluso la solución,
configuración central .NET, base de datos, infraestructura y scripts que solo
corresponden al servidor.

## Criterios de ubicación

Una entidad, regla o evento puro pertenece a Domain. Un caso de uso y los puertos que requiere pertenecen a Application. Un contrato HTTP público pertenece a Contracts. EF Core, SQL Server y proveedores pertenecen a Infrastructure. Controllers, middleware, hubs y composición pertenecen a Api. Las dependencias apuntan hacia el núcleo y se verifican con pruebas de arquitectura.

Una prueba se ubica por el alcance que observa: UnitTests para comportamiento aislado, IntegrationTests para el host y sus fronteras, ArchitectureTests para dependencias estructurales.

Los documentos de requisitos e entrevistas solo pueden contener material aprobado y sanitizado. No se importa contenido desde carpetas personales, grabaciones o documentos privados. Los diagramas no deben revelar infraestructura real.

## Archivos generados

`bin`, `obj`, `node_modules`, resultados de pruebas, backups y secretos no se versionan. `packages/api-client/generated` solo contendrá salida reproducible después de seleccionar un generador. El árbol real del repositorio se genera durante la validación final, no se mantiene manualmente en este documento.
