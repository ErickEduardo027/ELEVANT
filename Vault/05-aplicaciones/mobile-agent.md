---
id: aplicaciones-mobile-agent
title: "Mobile Agent"
type: architecture
area: mobile
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-11-04"
verified_commit: "b175e2963dad77fe7a621bc1ccff6dd710830971"
sources:
  - frontend/AGENTS.md
  - frontend/mobile-agent/README.md
  - frontend/mobile-agent/package.json
  - frontend/mobile-agent/app.json
  - .github/workflows/mobile-ci.yml
  - frontend/mobile-agent/src/services/mobile-auth.ts
  - docs/adr/0031-flight-report-capture-on-the-tablet.md
  - frontend/mobile-agent/src/synchronization/flight-report-outbox.ts
  - frontend/mobile-agent/src/services/flight-report.ts
  - frontend/mobile-agent/src/components/flight-report/flight-report-panel.tsx
  - frontend/mobile-agent/src/app/sync.tsx
  - frontend/mobile-agent/tests/flight-report.test.js
  - docs/adr/0032-aviam-forms-signatures-and-walkaround.md
  - frontend/mobile-agent/src/components/documents/operation-documents.tsx
  - frontend/mobile-agent/src/components/documents/signature-pad.tsx
  - frontend/mobile-agent/src/storage/walkaround-photos.ts
  - frontend/mobile-agent/tests/operation-documents.test.js
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
| `src/hooks/use-automatic-sync.ts` | Intento de sincronización al iniciar, por intervalo y al volver a estado activo. |
| `src/config/elevant-api.ts` | Fábrica del cliente OpenAPI compartido, todavía separada de los servicios prototípicos. |
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

> [!note] Rama `feat/finance-refinement`
> El detalle de operación añade «Cargos aplicados»: el agente marca solo el tipo de cargo (nocturno, tiempo extra…) en servicios en curso, completados o en excepción, sin ver precios. Usa `GET/POST /api/v1/ramp/operations/{id}/…/charges` con clave idempotente estable por servicio, cargo y acción y conserva la última lista como caché sin conexión. Ver [Finanzas: tarifarios, cargos y cobros](../03-dominio/finanzas-tarifas-cargos-y-cobros.md).

## Mis turnos y documentos

Desde el inicio, «Mis turnos» abre una pantalla de solo lectura con los turnos de los
próximos 14 días que programó Gestión Humana y el vencimiento del carnet, la licencia
de rampa y las habilitaciones (vigente, vence pronto o vencido). Se lee de
`GET ramp/me/schedule` con la sesión actual y se actualiza con las señales de
turnos, carnets y habilitaciones. Fuente:
[pantalla](../../frontend/mobile-agent/src/app/my-schedule.tsx) y
[ADR-0026](../../docs/adr/0026-ramp-staff-readiness-and-hr-shifts.md).

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

## Fluidez y tablet

Inicio, manifiesto, chat, notificaciones e incidencias revalidan en segundo
plano tras la primera carga, en lugar de volver a mostrar un spinner a pantalla
completa. Los sondeos se pausan con la app en segundo plano
([utilidad](../../frontend/mobile-agent/src/utils/foreground-interval.ts)).
Chat y notificaciones usan `FlatList` y las fechas reutilizan formateadores
`Intl` en caché.

La app sigue la orientación del dispositivo. Según la
[clase de layout](../../frontend/mobile-agent/src/utils/layout-class.ts):

- desde 900 dp el inicio muestra la lista de operaciones junto al manifiesto
  seleccionado;
- entre 600 y 899 dp, la lista usa dos columnas.

Las escrituras siguen registrando el dispositivo antes de cada comando. Solo la
lectura periódica de asistencia reutiliza el registro confirmado de la sesión.

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
- Storage prototípico
- [Flujo Mobile](../../docs/workflows/mobile-workflow.md)
- [Fronteras de clientes](../02-producto/fronteras-de-clientes.md)
- [API compartida](api-compartida.md)
- [Mapa de aplicaciones](README.md)


## Ampliación local de presencia posterior a la fotografía histórica

El [emisor](../../frontend/mobile-agent/src/services/mobile-presence.ts) utiliza
la sesión canónica y el cliente compartido. Observa actividad táctil, AppState
y revisiones de identidad sin modificar el proceso de autenticación.
No persiste heartbeats ni los incorpora a la outbox; ante almacenamiento
incierto suspende actividad hasta comprobar la cuenta.

El [layout](../../frontend/mobile-agent/src/app/_layout.tsx) inicia y detiene
el servicio; los indicadores se muestran en el chat de OCC. La retención es
transitoria en la API, sin migraciones. La validación en un Android real
sigue pendiente.
No se afirma una publicación de APK ni se actualizan aquí los metadatos de
verificación de las secciones históricas anteriores.

## Fase 3, bloque 3: Reporte de Vuelo sin conexión

En la rama de la fase 3 ([ADR-0031](../../docs/adr/0031-flight-report-capture-on-the-tablet.md)), la pantalla de operación incluye el «Reporte de Vuelo» de AVIAM, con los hitos literales del formulario.

**Pantalla de operación**

- Cuatro fases con progreso: llegada, en posición, salida y retroempuje.
- Botones «Ahora» de al menos 72 dp, que vibran al confirmar.
- Ajuste de la hora por minutos.
- Tarjeta de datos del vuelo (pasajeros, MTOW y matrícula), que se escriben una sola vez.
- Acción rápida «Desviación», con código IATA de demora.

**Cola sin conexión**

- La [cola persistente](../../frontend/mobile-agent/src/synchronization/flight-report-outbox.ts) guarda cada toque en el dispositivo antes de enviarlo.
- El [servicio](../../frontend/mobile-agent/src/services/flight-report.ts) envía los elementos en orden, con su clave idempotente estable y el dispositivo registrado.
- El envío se repite en cuanto vuelve la señal.
- Lo que el servidor rechaza queda «por revisar» en la pantalla [Sincronización](../../frontend/mobile-agent/src/app/sync.tsx).
- Cada valor muestra si está en el dispositivo, confirmado o rechazado.

Las [pruebas](../../frontend/mobile-agent/tests/flight-report.test.js) cubren cuatro casos:

- la sustitución del toque que aún no se envió;
- la confirmación;
- la falta de señal;
- el rechazo del servidor.

Las fotos del walk-around no estaban en ese bloque; llegan en el bloque 4.

## Fase 3, bloque 4: formularios, firmas y walk-around

En la rama de la fase 3 ([ADR-0032](../../docs/adr/0032-aviam-forms-signatures-and-walkaround.md)), la pantalla de operación suma dos tarjetas.

**Walk-around 360°** ([componente](../../frontend/mobile-agent/src/components/documents/operation-documents.tsx))

- Silueta del avión vista desde arriba, dibujada con `react-native-svg`; se toca donde está la anomalía.
- Nota obligatoria y foto opcional con la cámara (`expo-image-picker`).
- La foto se copia a la carpeta de documentos de la app ([almacenamiento](../../frontend/mobile-agent/src/storage/walkaround-photos.ts), `expo-file-system`) y se borra solo cuando ELEVANT la confirma.
- Cada marca muestra si está en el dispositivo o confirmada.

**Formularios y firmas**

- Orden de Servicio, Reporte de Vuelo y, si la operación tiene puente, el Check-List del puente, generados en el servidor con lo ya capturado.
- Cada formulario muestra sus firmantes: firmado, en el dispositivo, rechazado o «firmar de nuevo» si cambió un dato facturable después de firmar.
- La hoja de firma enseña al firmante los datos del vuelo, los servicios con su monto, el total y la huella del documento.
- La firma se dibuja con el dedo en un [pad 3:1](../../frontend/mobile-agent/src/components/documents/signature-pad.tsx) y se guarda como trazos normalizados.
- Para los roles de AVIAM, el nombre del agente viene precargado.

**Sin conexión.** Firmas, marcas y fotos viajan en la misma cola persistente del Reporte de Vuelo, en orden; la foto siempre va detrás de su marca. Una firma rechazada porque el formulario cambió queda en «Sincronización».

Las [pruebas](../../frontend/mobile-agent/tests/operation-documents.test.js) cubren:

- la firma con su huella;
- el orden marca → foto y el borrado de la foto confirmada;
- el formulario que cambió, que queda retenido;
- el almacenamiento de fotos caído, que deja la foto pendiente;
- la última vista del servidor guardada por operación.

El formulario de charter sin contrato no está en este bloque: falta el formulario literal de AVIAM.
