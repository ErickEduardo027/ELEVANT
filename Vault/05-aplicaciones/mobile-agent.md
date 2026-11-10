---
id: aplicaciones-mobile-agent
title: "Mobile Agent"
type: architecture
area: mobile
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-11-05"
verified_commit: "b506e91b33570d387ceb70f7fda5b7c1b0c5381c"
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
  - docs/adr/0033-charter-flights-without-contract.md
  - docs/adr/0034-operational-close-occ-to-finance.md
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

Mobile Agent es la aplicación nativa para agentes de rampa en tablets Android/iOS. Su destino inicial es una APK Development firmada, no un servicio web del VPS. La fotografía original de esta nota describía una app Expo con un prototipo de trabajo intermitente, sin integración de negocio con `Elevant.Api`. *Posterior al commit verificado de esta nota (código de `39a85a46`):* los servicios de `src/services` usan el cliente compartido de [`src/config/elevant-api.ts`](../../frontend/mobile-agent/src/config/elevant-api.ts) para la sesión, la tableta, las operaciones asignadas, la ejecución, el chat y el feed de cambios; la sesión vive en el almacenamiento seguro del dispositivo y los comandos sin conexión pasan por una sola cola con clave de idempotencia ([sincronización](../../frontend/mobile-agent/src/synchronization/README.md)). La cadena de distribución firmada sigue pendiente.

## Ficha de frontera

| Dimensión | Estado verificado |
| --- | --- |
| Usuario | Agente de rampa operando en tablet. |
| Contexto | Atención de vuelos/turnarounds, checklist, incidencias, sincronización y coordinación con OCC. |
| Responsabilidad local | UI nativa, caché temporal, outbox y captura controlada cuando no hay conectividad. |
| Autoridad real | API para identidad, perfil de agente, estaciones, asignaciones, comandos y resultado canónico. |
| Distribución | APK Development firmada es objetivo; no existe script/configuración de build firmado en el commit verificado. |
| Madurez | En la fotografía original, prototipo con servicios heredados; posterior al commit verificado, app integrada con la API y credencial en almacenamiento seguro. |

## Stack actual

- Expo SDK 54 con Expo Router 6 y typed routes experimentales.
- React 19.1 y React Native 0.81.
- TypeScript 5.9.
- React Navigation y componentes Expo para imagen, picker, red, assets, haptics, linking y sistema.
- AsyncStorage para cachés y cola local; *posterior al commit verificado,* la credencial de sesión vive en `expo-secure-store` ([sesión](../../frontend/mobile-agent/src/storage/mobile-session.ts)).
- `@elevant/api-client` observado por Metro como dependencia fuente externa del subproyecto.
- Identificadores nativos declarados en `app.json` para Android e iOS; esto no prueba firma ni publicación.

## Estructura útil para desarrollar

| Ruta | Responsabilidad observada |
| --- | --- |
| `src/app/` | Pantallas y navegación file-based de Expo Router. |
| `src/services/` | Sesión, tableta, operaciones asignadas, ejecución, incidencias, chat y feed de cambios; *posterior al commit verificado,* todos sobre el cliente compartido. |
| `src/synchronization/` | *Posterior al commit verificado:* la cola persistente por cuenta, su proyección sobre la vista y el desfase del reloj frente a ELEVANT. |
| `src/config/elevant-api.ts` | Fábrica del cliente OpenAPI compartido que usan los servicios. |
| `tests/api-client.metro-smoke.ts` | Smoke de bundle del cliente compartido en Android. |

## Pantallas y recorrido

*Posterior al commit verificado de esta nota (código de `39a85a46`):* cada
pantalla lee y escribe por la API; la tabla conserva el recorrido original y
la sección «Fase 3» describe la cola actual.

| Ruta Expo | Comportamiento observable |
| --- | --- |
| `/` | Inicio de sesión contra `POST /api/v1/auth/session` y vínculo de la tableta. |
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

## Estado offline

En la fotografía original, la app guardaba con AsyncStorage una sesión
prototípica, la caché de vuelos, la atención, el checklist, una outbox con
claves de reloj y aleatoriedad y los mensajes de chat, contra un endpoint de
sync que la API .NET no exponía.

*Posterior al commit verificado de esta nota (código de `39a85a46`):* la
credencial vive en el almacenamiento seguro del dispositivo y AsyncStorage solo
guarda cachés y la cola. Cada comando lleva la instalación registrada y una
clave de idempotencia estable, y el servidor guarda su recibo; la sección
«Fase 3» describe el orden, los reintentos y las excepciones. La retención y
el cifrado de las cachés para datos reales siguen sin una política aprobada.

## Estado de integración

| Capa | Fotografía original | Posterior al commit verificado (código de `39a85a46`) |
| --- | --- | --- |
| Autenticación | Servicio prototípico y token en AsyncStorage. | Sesión de la API con refresh rotativo; credencial en almacenamiento seguro. |
| Vuelos | Endpoint heredado con fallback a caché. | `GetRampAssignedOperations`, con alcance derivado por cuenta, agente y estación, y caché sin conexión. |
| Comandos offline | Outbox local y endpoint heredado de sync. | Instalación registrada, clave estable y recibo del servidor. |
| Chat | Poll/merge contra ruta prototípica. | Conversaciones de la operación por la API; el aviso `ChangedV1` solo invita a releer. |
| Cliente compartido | La fábrica y el smoke Metro existen. | Los servicios usan el cliente compartido. |
| Evidencias | Selección de foto prototípica. | Fotos del walk-around en el almacenamiento S3 privado por la API. |

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

## Fase 2: tablets compartidas

Posterior al commit verificado de esta nota: esta sección describe el código de
la fase 2 del ciclo (`50e7778f`), que esa verificación no cubre
([ADR-0038](../../docs/adr/0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md)).

- **Una tablet pasa entre agentes.** Iniciar sesión vincula la instalación a la
  cuenta y la toma del agente anterior, con auditoría, salvo que ese agente
  trabaje una operación en curso (`device_in_use_by_active_agent`).
- **Cerrar sesión la libera.** La app llama a `POST mobile/device/release` con
  una clave de la instalación y un tiempo límite; sin conexión, la sesión se
  cierra igual y el siguiente inicio de sesión toma la tablet
  ([servicio](../../frontend/mobile-agent/src/services/mobile-device.ts)).
- **Revocada.** Una tablet que OCC revocó no vuelve a registrarse
  (`device_revoked`), y la app lo explica al iniciar sesión.
- **Fin del servicio en rampa.** La baja, el traslado fuera de rampa, el paso a
  oficina y la desactivación del perfil cierran las tablets del agente.
- **APK desplegada.** La respuesta de éxito del registro no cambió. La APK
  anterior no libera la tablet al cerrar sesión, pero el siguiente agente la
  toma igual.

## Fase 3: una sola cola, el reloj de ELEVANT y la evidencia que se conserva

Posterior al commit verificado de esta nota: esta sección describe el código de
la fase 3 del ciclo (`f2d5c52c`), que esa verificación no cubre
([ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).

- **Una sola cola.** La [cola persistente](../../frontend/mobile-agent/src/synchronization/flight-report-outbox.ts)
  lleva también el inicio, las transiciones de servicio, los cargos, el envío
  del checklist y el chat, en orden FIFO por operación. Sin red o con la sesión
  revocada se detiene todo; una foto que ELEVANT no puede guardar ahora no
  detiene nada; cualquier otro fallo temporal retiene solo su operación. Se
  vacía al abrir la app, al recuperar la señal, al volver a primer plano y cada
  minuto. Los comandos que reservó la versión anterior se importan una vez con
  su misma clave.
- **La hora del toque.** El inicio y los servicios viajan con la hora en que el
  agente tocó, y ELEVANT la conserva aunque el comando llegue horas después: el
  inicio, si no es anterior a la asignación ni de hace más de 24 horas; un
  servicio, si no es anterior a la apertura de la ventana de la operación ni a
  su transición previa. Los hitos se ajustan dentro de la ventana de la
  operación; en una corrección, un hito vacío abre el ajuste en lugar de grabar
  «AHORA».
- **El reloj de ELEVANT.** El
  [reloj del servidor](../../frontend/mobile-agent/src/synchronization/server-clock.ts)
  toma el desfase de la cabecera `Date` y lo guarda en el dispositivo. Toda hora
  que captura la tablet sale de ahí, y la insignia de conexión avisa cuando el
  desfase pasa de 2 minutos.
- **La evidencia sobrevive a la sesión.** Un `401`, un `403`, la sesión vencida o
  el cierre de sesión ya no borran lo que ELEVANT no confirmó: queda ligado a la
  cuenta, solo esa cuenta lo envía al volver a entrar y «Sincronización» indica
  los registros de otra cuenta, sin mostrarlos.
- **Entrega.** La APK nueva vacía la cola antes de entregar y no entrega con
  registros pendientes o rechazados de la operación, ni con la Orden de Servicio
  sin las firmas de la aerolínea y de AVIAM sobre su contenido actual.
- **Lista y alcance.** La lista trae las operaciones activas y las aprobadas de
  las últimas 48 horas, con las activas primero. Una operación iniciada sigue en
  manos de su agente aunque cambien su posición o su terminal.
- **Datos del vuelo y charter.** «Datos del vuelo» captura el tipo de avión de
  la lista de ELEVANT, fijo desde la primera entrega. En un charter con el
  prepago confirmado, la tarjeta oculta «AGREGAR» y lo explica.
- **Códigos en español.** Los rechazos se explican por su código, como
  «Contrato no vigente», y cada estado de incidencia sale en español.
- **APK desplegada.** Sigue funcionando: ninguna respuesta que lee ganó claves y
  sus peticiones conservan el hash del recibo. Muestra como un rechazo genérico
  los códigos nuevos (`time_outside_operation_window`, `milestone_out_of_order`,
  `contract_not_in_force` y `charter_prepayment_confirmed`), y como código los
  estados de incidencia que OCC ahora asigna, hasta que se instale la APK nueva.

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

- **Brecha cerrada:** posterior al commit verificado, autenticación, asignaciones, ejecución y chat están en OpenAPI y la credencial vive en almacenamiento seguro.
- **Brecha actual:** protocolo servidor de dispositivo/idempotencia/reconciliación no está implementado de extremo a extremo. *Posterior al commit verificado: desde la fase 3 del ciclo, el inicio, los hitos, los datos del vuelo, las firmas, el walk-around, el charter, los servicios, los cargos, el checklist y el chat viajan por la misma cola con la instalación registrada y, salvo la foto del walk-around, una clave estable. En esa cola el recibo repite el mismo resultado o el mismo código, salvo en el chat, que se deduplica por la clave del mensaje, y en la foto, un `PUT` por marca en el que los mismos bytes cuentan como reintento. Las incidencias, la entrega a OCC, la corrección y la observación de asistencia conservan su propia clave reservada fuera de esa cola ([ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).*
- **Brecha actual:** no hay configuración EAS ni comando para producir la APK firmada.
- **Brecha cerrada:** posterior al commit verificado, las fotos del walk-around se suben por la API al almacenamiento S3 privado; las incidencias siguen sin adjuntos.
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

## Fase 3, bloque 5: recargos automáticos

Desde el cierre OCC → Finanzas ([ADR-0034](../../docs/adr/0034-operational-close-occ-to-finance.md)), la [tarjeta de cargos](../../frontend/mobile-agent/src/components/ramp-operation-charges-card.tsx) muestra con su origen («automático» u «OCC») los recargos que marcó ELEVANT al entregar o que agregó OCC en la revisión.

El agente no puede quitarlos: solo quita los que marcó él. El servidor rechaza también ese intento.

## Fase 3, bloque 4b: charter sin contrato

En un charter ([ADR-0033](../../docs/adr/0033-charter-flights-without-contract.md)) la pantalla de operación suma la [tarjeta «Charter sin contrato»](../../frontend/mobile-agent/src/components/documents/charter-card.tsx). La tarjeta aparece cuando los formularios incluyen la Solicitud de Servicio y contiene:

- la dirección del transportista y quién paga los cargos;
- el catálogo de servicios con la tarifa base y su mínimo, con la cantidad y «Agregar»;
- el estado del prepago que confirma Finanzas.

Los servicios y los datos viajan en la misma cola persistente, sin señal. La hoja de firma de la Solicitud de Servicio pide además la cédula o el pasaporte. Ese dato queda en el dispositivo solo hasta que se envía.
