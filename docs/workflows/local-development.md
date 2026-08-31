# Desarrollo local

## Requisitos

- SDK .NET indicado por `global.json`.
- Docker Desktop/Engine con Compose para el stack SQL local.
- PowerShell 5.1/7 y Git.
- Node.js compatible con cada frontend y npm.

Cada frontend conserva su propio `package-lock.json`; se instala desde su carpeta y no se asume pnpm/root workspace.

## Backend sin contenedores

```powershell
dotnet --info
dotnet tool restore
dotnet restore backend/Elevant.sln --locked-mode
dotnet build backend/Elevant.sln --configuration Release --no-restore
dotnet test backend/Elevant.sln --configuration Release --no-build
```

`backend/scripts/restore-build-test.ps1` encapsula la secuencia. `/health` comprueba proceso; `/health/ready` incluye dependencias y puede fallar sin SQL.

## Stack local completo

```powershell
Copy-Item database/DevelopmentDB/.env.example database/DevelopmentDB/.env
# Reemplazar todos los REPLACE_ME.
docker compose --env-file database/DevelopmentDB/.env -f database/DevelopmentDB/compose.local.yml up --build
```

El orden es SQL -> provisioner -> migrator -> seeder Development -> API. Las identidades SQL son distintas y `sa` queda deshabilitado después del bootstrap. Nunca reutilice esas contraseñas en el VPS o Production.

## Frontends

Entre a `frontend/private-web`, `frontend/public-web` o `frontend/mobile-agent`, lea su README y ejecute solo los scripts declarados en su `package.json`. Una tablet no puede alcanzar el `localhost` de la PC; use una URL de red autorizada/Tailscale según el ambiente.

## Cierre de sesión

- ejecutar pruebas/build enfocados;
- revisar `git diff` y `git status`;
- actualizar docs si cambió un contrato;
- no incluir `.env`, secrets, `bin`, `obj`, `.next`, `node_modules`, bases, backups, artefactos de firma o resultados runtime.
