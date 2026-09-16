---
id: aplicaciones-mobile-agent
title: "Mobile Agent"
type: architecture
area: mobile
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-16"
verified_commit: "0ce3355ded1251cebdbe8050f33218c3e27416ae"
sources:
  - frontend/AGENTS.md
  - frontend/mobile-agent/README.md
  - frontend/mobile-agent/package.json
  - frontend/mobile-agent/app.json
  - .github/workflows/mobile-ci.yml
  - frontend/mobile-agent/src/services/mobile-auth.ts
  - frontend/mobile-agent/src/services/assigned-flights.ts
  - frontend/mobile-agent/src/services/automatic-sync.ts
  - frontend/mobile-agent/src/storage/prototype-storage.ts
tags:
  - aplicaciones
  - mobile-agent
  - expo
  - offline
  - prototipo
---

# Mobile Agent

Mobile Agent es la aplicación nativa para agentes de rampa en tablets Android/iOS. Su destino inicial es una APK Development firmada, no un servicio web del VPS. El repositorio contiene una app Expo ejecutable y un prototipo de trabajo intermitente, pero todavía no una integración de negocio con `Elevant.Api` ni una cadena de distribución firmada.

## Ficha de frontera

| Dimensión | Estado verificado |
| --- | --- |
| Usuario | Agente de rampa operando en tablet. |
| Contexto | Atención de vuelos/turnarounds, checklist, incidencias, sincronización y coordinación con OCC. |
| Responsabilidad local | UI nativa, caché temporal, outbox y captura controlada cuando no hay conectividad. |
| Autoridad real | API para identidad, perfil de agente, estaciones, asignaciones, comandos y resultado canónico. |
| Distribución | APK Development firmada es objetivo; no existe script/configuración de build firmado en el commit verificado. |
| Madurez | Prototipo nativo ejecutable, con servicios heredados y almacenamiento local no apto aún para credenciales reales. |

## Stack actual

- Expo SDK 54 con Expo Router 6 y typed routes experimentales.
- React 19.1 y React Native 0.81.
- TypeScript 5.9.
- React Navigation y componentes Expo para imagen, picker, red, assets, haptics, linking y sistema.
- AsyncStorage para sesión/caché/outbox del prototipo.
- `@elevant/api-client` observado por Metro como dependencia fuente externa del subproyecto.
- Identificadores nativos declarados en `app.json` para Android e iOS; esto no prueba firma ni publicación.

## Estructura útil para desarrollar

| Ruta | Responsabilidad observada |
| --- | --- |
| `src/app/` | Pantallas y navegación file-based de Expo Router. |
| `src/services/` | Autenticación, vuelos asignados, sincronización y chat contra endpoints prototípicos. |
| `src/storage/prototype-storage.ts` | Estado local de operaciones/checklists, outbox y chat. |
| `src/hooks/use-automatic-sync.ts` | Intento de sincronización al iniciar, por intervalo y al volver a estado activo. |
| `src/config/elevant-api.ts` | Fábrica del cliente OpenAPI compartido, todavía separada de los servicios prototípicos. |
| `src/data/mock.ts` | Vocabulario, checklist y tipos de UI del prototipo; no contrato. |
| `tests/api-client.metro-smoke.ts` | Smoke de bundle del cliente compartido en Android. |

## Pantallas y recorrido prototípico

| Ruta Expo | Comportamiento observable |
| --- | --- |
| `/` | Inicio de sesión contra el endpoint heredado del Mobile prototype. |
| `/home` | Perfil, vuelos asignados, conteo de pendientes y acceso a chat. |
| `/flight/[id]` | Detalle, servicios e inicio/cierre local de atención. |
| `/checklist/[id]` | Respuestas y cierre de checklist asociado a la operación local. |
| `/incident/[id]` | Registro de incidencia y selección de imagen dentro del prototipo. |
| `/sync` | Consulta e intento de envío de elementos de outbox. |
| `/chat` | Mensajes con OCC y conciliación básica de mensajes pendientes. |

El cierre de atención exige un checklist completo en el estado local. Esa regla de interfaz no es todavía una invariante del servidor ni un contrato público.

## Estado offline actual

La implementación guarda con AsyncStorage:

- sesión prototípica;
- caché de vuelos asignados;
- inicio/fin de atención y checklist por vuelo;
- incidencias/comandos pendientes en una outbox;
- mensajes de chat.

Cada elemento de outbox obtiene una clave local que permanece estable mientras el elemento siga almacenado, y el cliente elimina únicamente claves que el endpoint de sync declara aceptadas. Sin embargo:

- no existe un identificador de dispositivo registrado incluido sistemáticamente en cada comando;
- la clave se genera con reloj y aleatoriedad de JavaScript, no mediante un contrato de idempotencia aprobado;
- no están documentadas/implementadas migraciones de storage, cifrado, retención ni limpieza para datos reales;
- la API .NET no expone `/api/mobile/sync`, así que la reconciliación canónica no está integrada.

Por tanto, la outbox demuestra el recorrido de UX, no garantías de entrega exactly-once ni seguridad offline.

## Estado de integración

| Capa | Actual | Objetivo |
| --- | --- | --- |
| Autenticación | Servicio prototípico y token en AsyncStorage. | Autenticación real; tokens en almacenamiento seguro de plataforma. |
| Vuelos | Endpoint heredado con fallback a caché. | Contrato OpenAPI y scope derivado por cuenta/agente/estación. |
| Comandos offline | Outbox local y endpoint heredado de sync. | Device ID registrado + idempotency key estable + recibo almacenado por servidor. |
| Chat | Poll/merge contra ruta prototípica. | Contrato autorizado; REST confirma estado y tiempo real solo avisa. |
| Cliente compartido | La fábrica y el smoke Metro existen. | Sustituir gradualmente servicios heredados por operaciones generadas. |
| Evidencias | Selección de foto prototípica. | Upload seguro a object storage con metadatos, permisos y retención. |

Las peticiones nativas no usan CORS del navegador, pero sí requieren autenticación, autorización y transporte HTTPS. Acceso de red privado no sustituye esos controles.

## Desarrollo local

Desde `frontend/mobile-agent`:

```powershell
npm install
npm run start
npm run lint
npm run typecheck
npm run test:api-client-bundle
npm run test:app-bundle
```

También existen `npm run android`, `npm run ios` y `npm run web` para exploración. Una tablet interpreta `localhost` como la propia tablet: configura una URL alcanzable y autorizada. Expo Go sirve para exploración temprana; permisos y capacidades finales deben validarse en un development build o aplicación firmada.

## Cobertura de pruebas actual

El `package.json` no declara una suite unitaria/E2E general. Sí declara lint,
typecheck, un smoke que empaqueta el cliente API compartido y un export Android
completo mediante Metro/Expo. `Mobile Agent CI` ejecuta esos cuatro gates desde
el lockfile para cambios Mobile o del cliente compartido. No produce una APK ni
prueba comportamiento nativo. Antes de distribuir una APK faltan pruebas
verificables de:

- reconexión, reintentos, duplicados y orden fuera de secuencia;
- permisos de cámara/fotos rechazados y falta de espacio;
- cierre/reinicio de la app y migración de storage;
- expiración/revocación de sesión y acceso fuera del scope;
- comportamiento en una tablet representativa, no solo web/emulador.

## Configuración segura

- `EXPO_PUBLIC_ELEVANT_API_URL` alimenta la fábrica del cliente OpenAPI.
- `EXPO_PUBLIC_API_URL` y `EXPO_PUBLIC_SIGNALR_URL` pertenecen a adaptadores heredados durante la migración.
- Todo `EXPO_PUBLIC_*` queda visible en el binario y nunca contiene secretos ni tokens.
- El archivo local de entorno no se versiona; usa `.env.example` solo como forma.
- Claves de firma, credenciales de tienda y tokens permanecen fuera de Git.
- Development y Production necesitarán identificadores, firma, endpoint y almacenamiento separados.

## Brechas y desconocidos

- **Brecha actual:** endpoints de autenticación, asignaciones, sync y chat no existen en OpenAPI.
- **Brecha actual:** token prototípico en AsyncStorage; falta almacenamiento seguro de credenciales.
- **Brecha actual:** protocolo servidor de dispositivo/idempotencia/reconciliación no está implementado de extremo a extremo.
- **Brecha actual:** no hay configuración EAS ni comando para producir la APK firmada.
- **Brecha actual:** uploads reales están deshabilitados hasta diseñar object storage.
- **Desconocido:** tablets objetivo, versión mínima de OS, MDM/distribución interna, custodia de firma y política de actualización.
- **Desconocido:** contrato final de checklist, incidencia, chat y evidencia.

## Fuentes y relaciones

- [README del cliente](../../frontend/mobile-agent/README.md)
- [Storage prototípico](../../frontend/mobile-agent/src/storage/prototype-storage.ts)
- [Flujo Mobile](../../docs/workflows/mobile-workflow.md)
- [Fronteras de clientes](../02-producto/fronteras-de-clientes.md)
- [API compartida](api-compartida.md)
- [Mapa de aplicaciones](README.md)
