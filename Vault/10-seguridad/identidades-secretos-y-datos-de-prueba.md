---
id: seguridad-identidades-secretos-datos-prueba
title: "Identidades, secretos y datos de prueba"
type: policy
area: security
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "ca10cdb73e729622f0c1870e1c8762756a9138a4"
sources:
  - AGENTS.md
  - docs/security/database-access.md
  - docs/security/secrets-management.md
  - docs/adr/0013-development-ssms-data-access.md
  - database/DevelopmentDB/README.md
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Seed/README.md
  - backend/Elevant.Api/Extensions/ServiceCollectionExtensions.cs
tags:
  - seguridad
  - secretos
  - permisos
  - datos-sinteticos
---

# Identidades, secretos y datos de prueba

ELEVANT separa identidades por **ambiente** y por **función**. La API no usa una cuenta de administración o migración; las personas que usan SSMS en Development no comparten login ni reciben DDL. Ningún secreto debe entrar a un bundle público, imagen, ejemplo versionado, log o nota del Vault.

## Mapa de responsabilidades

| Identidad o material | Uso previsto | Límite |
| --- | --- | --- |
| Runtime API | Objetos necesarios para la aplicación | No aplicar migraciones ni administrar SQL |
| Migrator | Evolucionar esquema con EF/Database CD | No usar como login cotidiano |
| Seeder, health, backup y restore | Tareas técnicas separadas | No usar de forma interactiva |
| Editor humano Development | CRUD de datos sintéticos | Sin DDL, backup/restore o rol privilegiado |
| Operador DBA | Checkpoints expresos | No compartir credenciales con el equipo |
| Firma APK futura | Identidad de publicación móvil | No exponer keystore o valores en Git/cliente |

La [política SQL](../../docs/security/database-access.md) concede CRUD por esquema en áreas de negocio y sólo lectura en esquemas técnicos. Eso permite experimentar con filas sintéticas, pero **omite deliberadamente reglas de workflow de la API**. Las constraints SQL siguen vigentes. Cambiar tablas, índices, tipos o claves requiere migración revisada, no SSMS.

## Ciclo de secretos

1. Define propietario, ambiente, consumidor, duración y rotación antes de crear el valor.
2. Usa el almacén o variables protegidas del ambiente; los `.env.example` versionados sólo contienen nombres y marcadores.
3. Limita el secreto al proceso que lo necesita. Variables `VITE_*`, `NEXT_PUBLIC_*` y `EXPO_PUBLIC_*` forman parte de clientes públicos y nunca guardan credenciales.
4. Ante exposición, revoca o rota primero; luego limita el artefacto, investiga y sanea historia coordinadamente. Borrar el texto del commit sin revocar no restaura la seguridad.

La [guía de secretos](../../docs/security/secrets-management.md) contiene el procedimiento. Esta nota no reproduce valores, rutas del host, comandos de extracción ni instrucciones para distribuir credenciales.

## Datos de prueba y trazabilidad

- Local, Development y futura Production usan secretos y datos separados. Production no aporta muestras, backups ni credenciales para desarrollar.
- El seed Development debe ser sintético, determinista e idempotente; mocks, navegador y fixtures no son datos canónicos y no se copian si contienen PII.
- Cada acceso SQL humano usa identidad personal; Tailscale autoriza la ruta y SQL controla operaciones. Un TCP exitoso no prueba permiso de `INSERT`.
- Las cuentas individuales identifican al principal, pero el [contrato actual](../../docs/security/database-access.md) **no instala historial DML durable** con valor anterior y posterior de cada fila. Hacerlo requiere decisión y rollout propios.
- Al retirar a una persona, se retira su membresía de red y se deshabilita sólo su login SQL. No se necesita recrear SQL ni rotar cuentas ajenas por esa baja.

## Brecha de la API actual

El backend registra infraestructura de autorización, pero aún no implementa autenticación ni endpoints de negocio protegidos. La privacidad de red de Development no convierte un prototipo en un servicio multi-tenant seguro. Antes de exponer operaciones reales, la API debe derivar identidad/scope en servidor y probar accesos cruzados denegados; ver [fronteras de confianza](../04-arquitectura/sistema-y-fronteras-de-confianza.md).
