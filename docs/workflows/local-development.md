# Desarrollo local

## Requisitos backend

- SDK .NET compatible con `backend/global.json`.
- Git.
- Docker con Compose para levantar SQL Server local cuando el caso lo requiera.
- PowerShell 5.1 o 7 para scripts del repositorio.

Node y pnpm se exigirán cuando web o móvil hayan sido inicializados. La presencia de Corepack no equivale a que pnpm ya esté habilitado.

## Inicio rápido del backend

Desde la raíz del monorepositorio, entrar a la unidad autónoma del backend antes
de invocar .NET. Así el CLI resuelve `backend/global.json`, la solución y las
herramientas locales correctas:

```powershell
Push-Location backend
dotnet --info
dotnet tool restore
dotnet restore Elevant.sln --locked-mode
dotnet build Elevant.sln --configuration Release --no-restore
dotnet test Elevant.sln --configuration Release --no-build
Pop-Location
```

El mismo flujo está encapsulado en `backend/scripts/restore-build-test.ps1` y puede
ejecutarse desde cualquier directorio.

La API puede arrancar sin migrar la base. El endpoint `/health` comprueba vida del proceso; `/health/ready` comprueba dependencias y puede fallar si SQL Server no está disponible.

Para infraestructura local, copiar `backend/.env.example` a `backend/.env`,
establecer una contraseña local fuerte y levantar los servicios con
`backend/infrastructure/docker/compose.local.yml`. Nunca reutilizar credenciales
de Development o Production.

## Antes de terminar una sesión

- no dejar secretos ni archivos locales preparados para commit;
- ejecutar las pruebas relacionadas;
- actualizar documentación si cambió un contrato u operación;
- revisar `git diff` y `git status`;
- no incluir `bin`, `obj`, `node_modules`, bases, backups o resultados de pruebas.
