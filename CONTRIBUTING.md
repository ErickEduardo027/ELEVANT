# Contribuir a Elevant

## Responsabilidades

- Erick: `backend` y `.github`. La solución, código, pruebas, SQL Server,
  infraestructura y scripts del servidor viven dentro de `backend`.
- Laisha: `frontend/web`, coordinando con Erick cuando cambie el contrato HTTP.
- Eliezer: `frontend/mobile-agent`, coordinando con Erick cuando cambie el contrato HTTP
  o SignalR.

## Flujo de ramas

- `main`: producción.
- `Development`: desarrollo remoto e integración.
- `feature/*`: funcionalidades.
- `fix/*`: correcciones.
- `hotfix/*`: correcciones urgentes originadas desde producción.

No se crean ramas permanentes por persona. Ejemplos válidos:
`feature/api-flight-sync`, `feature/web-occ-dashboard` y
`feature/mobile-flight-checklist`.

## Pull Requests

1. Partir de la rama adecuada y limitar el cambio a una responsabilidad clara.
2. Actualizar OpenAPI y documentación si cambia un contrato.
3. Incluir migración revisable cuando cambie la base de datos; nunca migrar
   Production automáticamente durante el arranque.
4. Completar la plantilla de PR, adjuntar evidencia y ejecutar las pruebas
   aplicables.
5. Obtener las revisiones de CODEOWNERS y esperar CI antes de hacer merge.

Web y móvil consumen normalmente la API remota de Development y no necesitan levantar
el backend ni SQL Server. Los cambios que requieren endpoints se acuerdan primero
con Erick y se validan en Swagger o con un cliente HTTP.
