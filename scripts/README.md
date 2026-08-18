# Scripts del repositorio

Todos los scripts son compatibles con Windows PowerShell 5.1 y PowerShell 7, se ejecutan desde cualquier directorio y detienen la operación ante un error.

- `setup/verify-prerequisites.ps1`: comprueba Git, .NET 10 y, opcionalmente, Docker o Node.js.
- `repository/show-tree.ps1`: muestra el árbol sin artefactos generados.
- `repository/check-secrets.ps1`: revisa archivos no ignorados, incluye self-tests para credenciales DB/Tailscale/Beszel/Telegram/Healthchecks y nunca imprime los valores detectados.

Los scripts propios del servidor están en `backend/scripts`: allí se encuentran
`restore-build-test.ps1`, `add-migration.ps1` y `update-database.ps1`. Ningún script
aplica migraciones por sí solo. Ejecutar una actualización de base constituye una
acción manual y deliberada.
