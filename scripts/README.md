# Scripts del repositorio

Todos los scripts son compatibles con Windows PowerShell 5.1 y PowerShell 7, se ejecutan desde cualquier directorio y detienen la operación ante un error.

- `setup/verify-prerequisites.ps1`: comprueba Git, .NET 10 y, opcionalmente, Docker o Node.js.
- `repository/show-tree.ps1`: muestra el árbol sin artefactos generados.
- `repository/check-secrets.ps1`: revisa archivos no ignorados, incluye self-tests para credenciales DB/Tailscale/Beszel/Telegram/Healthchecks y nunca imprime los valores detectados.
- `release/path-ownership.sh`: define una sola política de paths que producen
  una release API y que invalidan/publican los carriles web dependientes. Se
  importa desde workflows y guards; no despliega por sí solo.

El backend conserva `backend/scripts/restore-build-test.ps1`. Las operaciones de
esquema y certificación viven junto a DevelopmentDB en
`database/DevelopmentDB/scripts`. Ningún script aplica migraciones por sí solo;
una actualización de base sigue siendo una acción manual y deliberada.
