# Protección de ramas

Estas reglas deben activarse manualmente cuando exista el remoto y se conozcan los equipos reales.

## `main`

- Requerir pull request y al menos una aprobación.
- Invalidar aprobaciones cuando cambie el código.
- Requerir que las conversaciones estén resueltas.
- Requerir el check `Restore, build and test` cuando el backend esté en alcance.
- Requerir rama actualizada antes de fusionar.
- Bloquear force-push y eliminación.
- Restringir excepciones a administradores designados y auditables.

## `Development`

- Requerir pull request y el check correspondiente al área modificada.
- Bloquear force-push y eliminación.
- Mantener revisión humana para migraciones, seguridad e infraestructura.

No se configuran nombres de usuarios ficticios ni reglas mediante API desde este scaffold.
