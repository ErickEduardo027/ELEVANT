---
id: aplicaciones-mobile-agent
title: "Mobile Agent"
type: architecture
area: mobile
status: draft
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-10-15"
verified_commit: "pending"
sources:
  - frontend/AGENTS.md
  - frontend/mobile-agent/README.md
  - frontend/mobile-agent/package.json
  - frontend/mobile-agent/app.json
  - .github/workflows/mobile-ci.yml
  - frontend/mobile-agent/src/services/mobile-auth.ts
  - frontend/mobile-agent/src/services/mobile-sync-center.ts
tags:
  - aplicaciones
  - mobile-agent
  - expo
  - offline
---

# Mobile Agent

Mobile Agent es la aplicación nativa para agentes de rampa en tablets
Android/iOS. Consume exclusivamente `Elevant.Api`; no se conecta a SQL Server
ni se despliega como servicio web en el VPS. Su primer artefacto distribuible
seguirá siendo una APK Development firmada.

## Estado verificado

| Dimensión | Estado |
| --- | --- |
| Runtime | Expo SDK 57, Expo Router, React 19.2 y React Native 0.86. |
| Identidad | Sesión canónica con bearer en SecureStore, metadata no secreta en AsyncStorage, rol `RAMP_AGENT`, membresía AVIAM y scopes de estación. |
| Activación | Mobile maneja `409 password_change_required`, cambia la contraseña temporal y crea una sesión nueva. |
| OCC → agente | Operaciones, asignaciones, servicios, estados y correcciones mediante contratos del cliente OpenAPI compartido. |
| Agente → OCC | Inicio, checklist, servicios, cargos, incidencias, asistencia, chat y cierre mediante comandos idempotentes. |
| Offline | Cachés, borradores y comandos por sesión/cuenta/operación. `/sync` reintenta automáticamente al reconectar, abrir o volver al primer plano. |
| Tiempo real | Feed REST en primer plano; no existe push nativo con la app cerrada. |
| Evidencias | Captura local de fotos, firma manuscrita, responsable, llave y observaciones; el upload espera object storage y contrato autorizado. |
| Distribución | El export Android pasa; firma, `eas.json` y canal interno aún están pendientes. |

## Rutas principales

| Ruta | Responsabilidad |
| --- | --- |
| `/` | Acceso y activación de contraseña temporal. |
| `/home` | Perfil autorizado y operaciones asignadas. |
| `/flight/[id]` | Manifiesto, servicios, asistencia, cargos y cierre. |
| `/checklist/[id]` | Checklist canónico con borrador local y envío idempotente. |
| `/incident/[id]` | Incidencias estructuradas con cola FIFO. |
| `/chat` | Mensajería operacional por operación. |
| `/notifications` | Notificaciones operativas de la cuenta. |
| `/sync` | Conectividad, pendientes, bloqueados y reintento seguro. |

## Cuenta local de desarrollo

`EXPO_PUBLIC_ENABLE_LOCAL_AUTH=true` habilita una cuenta temporal únicamente
cuando `__DEV__` es verdadero. Sirve para revisar la activación y la navegación
mientras la API Development no está accesible. No crea autoridad, operaciones
ni datos canónicos, no envía la cola y queda inhabilitada en builds de
producción. La contraseña nueva se conserva como hash en SecureStore.

## Frontera offline

Cada escritura incierta conserva la sesión, cuenta, operación, payload y clave
de idempotencia originales. Incidencias y mensajes pueden reintentarse desde el
centro de sincronización. Checklist, transiciones de servicio, cargos, cierre,
corrección y asistencia vuelven a su pantalla para consultar el estado canónico
antes de decidir el siguiente envío. La presencia de un comando local nunca se
presenta como confirmación del servidor.

Logout, revocación y expiración eliminan credenciales, cachés y comandos de la
sesión. SignalR o push podrán acelerar avisos, pero no reemplazarán REST,
idempotencia ni conciliación.

## Validación y distribución

Desde `frontend/mobile-agent`:

```powershell
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:api-client-bundle
npm run test:app-bundle
```

El CI verifica fuente y bundles; todavía no firma ni publica una APK. Antes de
distribuir deben definirse custodia de claves, perfiles Development/Preview/
Production, `android.versionCode`, endpoint por ambiente y pruebas en tablet.

## Brechas vigentes

- endpoint autorizado y almacenamiento S3-compatible para cargar evidencias;
- push nativo, deep links desde notificación y presencia;
- configuración EAS y APK firmada reproducible;
- pruebas integrales contra la API y DevelopmentDB vivas.

## Fuentes y relaciones

- [README del cliente](../../frontend/mobile-agent/README.md)
- [Flujo Mobile](../../docs/workflows/mobile-workflow.md)
- [Fronteras de clientes](../02-producto/fronteras-de-clientes.md)
- [API compartida](api-compartida.md)
- [Mapa de aplicaciones](README.md)
