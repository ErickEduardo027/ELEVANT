# Ambientes backend

| Propiedad | Local | Development VPS | Production futura |
| --- | --- | --- | --- |
| Compose DB | `compose.local.yml` | database + release separados | diseño separado pendiente |
| Base | `ElevantDevelopmentDb` | `ElevantDevelopmentDb` | `ElevantProductionDb` |
| SQL host port | `127.0.0.1:1433` | ninguno | ninguno |
| ASP.NET | `Development` | `Development` | `Production` |
| Seed | sintético | sintético idempotente | inexistente |
| SQL edition | Developer | Developer | requiere decisión/licencia |
| Secretos | `.env` ignorado | store Dokploy | store/host independientes |

Los ambientes remotos comparten únicamente migraciones/artefactos revisados. No comparten VPS, base, login, volumen, backup, JWT/API key o datos. Production no copia el Compose Development y nunca ejecuta `seed-development`.

Guía canónica: `docs/deployment/environments.md`.
