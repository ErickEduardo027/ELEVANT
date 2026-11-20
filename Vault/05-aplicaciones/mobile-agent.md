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
| `/` | Inicio de sesión contra `POST /api/v1/auth/session` y vínculo de la tableta; *posterior al commit verificado,* también el cambio de la contraseña temporal del primer ingreso y el aviso de cómo terminó la sesión anterior (N7, sección «Fase 2»). |
| `/home` | Perfil, vuelos asignados, conteo de pendientes y acceso a chat. |
| `/flight/[id]` | Detalle, servicios e inicio/cierre local de atención. |
| `/checklist/[id]` | Respuestas y cierre de checklist asociado a la operación local. |
| `/incident/[id]` | Registro de incidencia y selección de imagen dentro del prototipo. |
| `/sync` | Consulta e intento de envío de elementos de outbox. |
| `/chat` | Mensajes con OCC y conciliación básica de mensajes pendientes. |

*Posterior al commit verificado de esta nota:* una cuenta que Gestión Humana creó con contraseña temporal recibe `409` con el código `password_change_required` al iniciar sesión. La misma pantalla `/` pasa a «Cambia tu contraseña temporal»: la temporal viene oculta y precargada, la nueva se escribe dos veces y una lista muestra en vivo la política de la API (14 caracteres o más, mayúscula, minúscula, número y símbolo, y distinta de la temporal). Al enviar, la app llama a `POST /api/v1/auth/password-change` sin sesión. Con `204` inicia sesión sola con la nueva contraseña y sigue el flujo normal, incluido el registro de la tablet. Con `400` explica la política, con `401` que la temporal no es válida y con `429` que espere un minuto. Ninguna contraseña se guarda ni se registra ([pantalla](../../frontend/mobile-agent/src/app/index.tsx), [formulario](../../frontend/mobile-agent/src/components/temporary-password-change.tsx), [servicio](../../frontend/mobile-agent/src/services/mobile-auth.ts)).

*Corregido posterior al commit verificado de esta nota (hallazgo N1 de la corrida del VPS del 16 de noviembre):* esta línea decía que exigir el checklist completo para cerrar era solo una regla de la interfaz. Es una regla del servidor: la entrega a OCC (`POST …/submit`) responde `409` si el último checklist de ejecución de la operación no está enviado (`Submitted`) o si queda un servicio sin terminar ([política](../../backend/Elevant.Application/Operations/RampOperationSubmissionPolicy.cs), [almacenamiento](../../database/DevelopmentDB/Elevant.Persistence/Operations/EfRampOperationSubmissionStore.cs)). La tablet lo comprueba antes, junto con lo que el servidor no exige (viñeta «Entrega» de la sección «Fase 3»).

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
| Autenticación | Servicio prototípico y token en AsyncStorage. | Sesión de la API con refresh rotativo, que la tablet guarda y usa desde S3 ([ADR-0046](../../docs/adr/0046-renewable-sessions-on-shared-tablets.md)); credencial en almacenamiento seguro. |
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

`android/` no se versiona: se regenera desde `app.json` con
`npx expo prebuild --clean`
([README del cliente](../../frontend/mobile-agent/README.md)). Una copia generada
antes de `fce328ca`, cuando `app.json` fijaba el vertical, deja la app bloqueada
en vertical. En la corrida del VPS del 16 de noviembre, el letterbox en
horizontal salió de una copia así, no de las pantallas.

Las escrituras siguen registrando el dispositivo antes de cada comando. Solo la
lectura periódica de asistencia reutiliza el registro confirmado de la sesión.

**Un solo formato de fecha y hora.** Posterior al commit verificado de esta nota
(hallazgo N11 de la corrida del VPS del 16 de noviembre), las pantallas que usan
los formateadores de la
[utilidad de fechas](../../frontend/mobile-agent/src/utils/date-format.ts)
escriben «lun, 16 nov» y «16 nov, 19:46», siempre con reloj de 24 horas: la
tarjeta y el detalle de la operación, «Sincronización», el inicio y «Mis
posiciones de hoy», las incidencias, el chat y las notificaciones.

- Las horas de la operación, de la cola de «Sincronización», de la última
  actualización del inicio y de «Mis posiciones de hoy» están en la hora local
  de la estación. El inicio toma la zona de las operaciones asignadas.
- Si la tablet no conoce la zona (un comando guardado por una versión anterior,
  una estación sin operaciones en la tablet), usa `America/Santo_Domingo`, como
  private-web y el servidor, y nunca la zona del equipo.
- Chat y notificaciones usan el mismo formato en la hora del equipo. Las
  incidencias pasaron a la hora de la estación con el hallazgo S6 (abajo).
- La tarjeta de la operación escribe «Inicio planificado» y el día sin
  mayúsculas forzadas, en hasta dos líneas que se reducen para caber, y el
  nombre del aeropuerto del detalle ya no se corta.
- Pendiente: [«Mis turnos y documentos»](../../frontend/mobile-agent/src/app/my-schedule.tsx)
  aún escribe el día con su propio formato largo y cada palabra en mayúscula
  («Lunes, 16 De Noviembre»), y el vencimiento de los documentos como
  «vence el 16/11/2026».
- La APK instalada conserva el formato anterior hasta que se instale la nueva.

**Unidades de cobro en español.** Posterior al commit verificado de esta nota
(hallazgo S5 de la corrida del VPS del 16 de noviembre, decisión D-S5), la
tarjeta de cada servicio nombra su unidad como Finanzas y nunca con el código
de `ref.billing_units`: «0 / 1 hora», «1 / 1 operación» y «Cantidad ejecutada
(horas)», con la
[utilidad de unidades](../../frontend/mobile-agent/src/utils/billing-units.ts).

- El plural está escrito para cada unidad sembrada, y solo una cantidad igual a
  1 va en singular.
- Un nombre heredado («Operación», «Hora», con o sin tilde) se lee como su
  código, igual que en private-web. Una unidad desconocida sale tal cual.
- Operación, servicio, aeronave y pasajero son unidades de conteo: la tablet
  pide números enteros, salvo la cantidad contratada que propone la tarjeta.
  Las demás admiten hasta cuatro decimales. Es una regla solo del cliente: el
  servidor sigue aceptando cuatro decimales.
- La Orden de Servicio conserva las abreviaturas de su PDF («1 h», «1 serv.»).
- La APK instalada sigue mostrando el código hasta que se instale la nueva.

**Ruta y asignación legibles.** Posterior al commit verificado de esta nota
(hallazgos N10 y N9 de la corrida del VPS del 16 de noviembre, decisiones D-N10
y D-N9), la tarjeta de una operación muestra todas las paradas de la escala en
orden, BWI → PUJ → BWI, con un avión entre cada una, y resalta la estación donde
trabaja el agente. Antes mostraba «BWI ✈ BWI» y ocultaba la estación. Las
funciones están en la
[presentación de operaciones](../../frontend/mobile-agent/src/features/assigned-operations/presentation.ts).

- Si falta un tramo, la tarjeta no pone la estación en su lugar: una llegada
  sola se lee BWI → PUJ y una salida sola, PUJ → MIA. Sin vuelos, nombra la
  estación junto a «Ruta por confirmar».
- El lector de pantalla dice «llega de BWI a PUJ y sale hacia BWI».
- El riel de la hora ya no repite el código de la estación.
- En una tarjeta angosta, la ruta pasa a una segunda línea entre dos paradas,
  nunca dentro de una.
- La asignación del detalle dice «Agente principal» en lugar de `primary`. No
  muestra un rol que la tablet no conoce.
- La posición operativa se nombra solo por su nombre: «Ramp agent» en lugar de
  «RAMP-AGENT · Ramp agent». El nombre sembrado en Development sigue en inglés.
- La APK instalada conserva la ruta y la asignación anteriores hasta que se
  instale la nueva.

**Códigos internos en segundo plano y una sola numeración.** Posterior al
commit verificado de esta nota (hallazgo N12 de la corrida del VPS del 16 de
noviembre, decisión D-N12), los códigos internos quedan como texto secundario
mientras AVIAM no decida retirarlos, y cada control del checklist lleva un solo
número.

- La tarjeta de un servicio tiene el nombre como título y el código
  («RAMP-AC») debajo, pequeño y sin negrita.
- «Cargos aplicados» pone el número de línea delante del nombre,
  «1 · Aire acondicionado», como las tarjetas de servicio, y el código debajo.
  Antes decía «RAMP-AC · Aire acondicionado», y dos líneas del mismo servicio
  no se distinguían.
- El checklist dice «Versión 1» bajo el nombre del formulario y deja el código
  de la plantilla debajo, en pequeño, en lugar de «FLIGHT-REPORT · versión 1».
- Cada control lleva el número que imprime el PDF, con la
  [presentación del checklist](../../frontend/mobile-agent/src/features/checklist/presentation.ts):
  el número en que termina su código, así que el Reporte de Vuelo va de 1 a 21
  en sus dos secciones. Si el código no termina en un número, como en el
  Check-List del puente, es su posición dentro de la sección. Antes cada
  sección empezaba en 1 y el control mostraba además su código («1» junto a
  «PUSH-11»).
- La APK instalada conserva los textos anteriores hasta que se instale la
  nueva.

**Asistencia e incidencias en la hora de la estación.** Posterior al commit
verificado de esta nota (hallazgo S6 de la corrida del VPS del 16 de noviembre,
decisión D-S6): la
[tarjeta de asistencia](../../frontend/mobile-agent/src/components/attendance-draft-card.tsx)
ya no edita en la zona del equipo. En la corrida mostró «Fin observado ·
America/La_Paz», y esa zona cambió a mitad de la operación. D-S6 deja sin
efecto la regla del plan del 2026-10-05, que pedía editar en la zona del
equipo
([ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).

- La tarjeta dice «Las horas están en hora local de PUJ». El detalle titula los
  vuelos «Hora local de PUJ» en lugar del identificador IANA de la zona.
- Los campos y «Registrar inicio ahora» usan la hora de la estación. Lo escrito
  viaja como instante UTC, igual que antes, con las funciones de la
  [utilidad de fechas](../../frontend/mobile-agent/src/utils/date-format.ts).
- Una hora que el reloj de la estación salta en un cambio de horario no se
  guarda, y nunca se pasa a otra hora. Una hora que se repite toma su primera
  vez.
- El aporte de OCC y el conflicto muestran las horas en el formato de la
  tablet, «5 oct, 10:00». En el conflicto, la versión guardada y el intento
  tienen el mismo formato. Desde el hallazgo N8, el aporte de OCC omite la
  fecha de las horas del día de la operación, «Inicio 10:00 · Fin —»
  ([asistencia compartida](asistencia-compartida-occ-agente.md)).
- Un reintento envía el comando reservado tal cual.
- Las incidencias de la operación muestran su hora en la zona de la estación.
- Si la tablet no conoce la zona, usa `America/Santo_Domingo`.
- OCC y Gestión Humana no cambian: el panel de OCC edita en la zona del
  navegador y la revisión de Gestión Humana muestra UTC. Alinearlos queda para
  otra entrega.
- La APK instalada sigue en la zona del equipo hasta que se instale la nueva.

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
- **La sesión se renueva.** Posterior a la fase 2 (hallazgo S3 de la corrida
  del VPS del 16 de noviembre;
  [ADR-0046](../../docs/adr/0046-renewable-sessions-on-shared-tablets.md)):
  - el inicio de sesión guarda el refresh token en el almacenamiento seguro
    (sobre v2; el v1 de la APK anterior se sigue leyendo) y la siguiente
    solicitud renueva el access token en su último minuto o ya vencido, una
    sola vez para todas las que la esperan y comparando con el reloj de
    ELEVANT ([servicio](../../frontend/mobile-agent/src/services/mobile-auth.ts));
  - la renovación conserva la revisión de la sesión: cachés, borradores,
    reservas, el vínculo de la tablet y la versión de su liberación siguen
    igual, y la presencia conserva su lease;
  - «Liberar» de OCC cierra el vínculo de la tablet, no la sesión: la lectura
    de la asistencia que ELEVANT rechaza (`403`) con el registro ya confirmado
    vuelve a registrar la tablet, como una escritura, y solo un `403` tras ese
    registro nuevo termina la sesión;
  - solo renueva si el JWT trae `auth_time`; frente a una API anterior la
    sesión termina a los 15 minutos, como antes;
  - sin señal, con `429` o `5xx` la sesión sigue y la siguiente renovación
    espera 30 segundos; encolar un toque, guardar un borrador o reservar la
    asistencia solo usan la identidad de la sesión guardada en la tablet;
  - un `401` de una renovación termina la sesión y conserva lo registrado; un
    `401` de una solicitud fuerza una renovación y la solicitud se repite una
    vez;
  - si se pierde la respuesta de una renovación (D-S3b), la sesión sigue con su
    access token hasta que ELEVANT trata el refresh token viejo como reuso;
    entonces termina y el agente vuelve a entrar;
  - cerrar sesión libera la tablet y termina la familia en ELEVANT, cada uno con
    un límite de 5 segundos; si el access token ya venció o está en su último
    minuto, antes lo renueva una vez, aunque sea durante la pausa de 30
    segundos, para que ELEVANT acepte la liberación. Un inicio de sesión que la
    tablet no conserva también termina su familia. No hay tope de horas, por
    decisión de Erick del 2026-11-19. La APK ya instalada no renueva: el cambio
    llega con la APK nueva.
- **La pantalla de acceso.** Posterior a la fase 2 (hallazgo N7 de la corrida
  del VPS del 16 de noviembre;
  [pantalla](../../frontend/mobile-agent/src/app/index.tsx)):
  - el aviso de cómo terminó la sesión anterior está en pasado y nombra la
    causa del marcador de fin (venció, ELEVANT la cerró o la cuenta perdió el
    acceso); dura hasta el siguiente intento y vuelve con un aviso nuevo. Sale
    también cuando el acceso encuentra él mismo la sesión vencida;
  - con `device_in_use_by_active_agent` ya no pide al otro agente que cierre
    sesión, porque el vínculo sigue mientras su operación esté en curso aunque
    su sesión haya vencido: pide a OCC que la libere en «Tablets» y volver a
    intentarlo. No muestra quién tiene la tablet ni precarga el correo (D-N7);
  - tras el fin de una sesión, el aviso de pendientes cuenta solo los registros
    de la cuenta que terminó, nunca los de otra;
  - el correo ya no muestra una dirección de prueba como ejemplo, y el logo y
    el formulario quedan centrados, también en vertical, con el pie al final;
  - la APK instalada conserva los textos anteriores hasta que se instale la
    nueva.

## Fase 3: una sola cola, el reloj de ELEVANT y la evidencia que se conserva

Posterior al commit verificado de esta nota: esta sección describe el código de
la fase 3 del ciclo (`f2d5c52c`) y las correcciones de la revisión de sus
bloques A, B y C (`34e90aad`), que esa verificación no cubre
([ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).

- **Una sola cola.** La [cola persistente](../../frontend/mobile-agent/src/synchronization/flight-report-outbox.ts)
  lleva también el inicio, las transiciones de servicio, los cargos, el envío
  del checklist y el chat, en orden FIFO por operación. Sin red o con la sesión
  revocada se detiene todo; una foto que ELEVANT no puede guardar ahora no
  detiene nada, se sigue reintentando y el agente puede descartarla en
  «Sincronización» para entregar sin ella; cualquier otro fallo temporal retiene
  solo su operación. Se vacía al abrir la app, al recuperar la señal, al volver a
  primer plano y cada minuto. Una foto que la tablet no puede leer, o la de una
  marca que ELEVANT rechazó, no se envía y queda como «No se puede enviar» hasta
  que el agente la descarta, y al reintentar la marca su foto la sigue. Los
  comandos que reservó la versión anterior se importan una vez con su misma
  clave.
- **La hora del toque.** El inicio y los servicios viajan con la hora en que el
  agente tocó, y ELEVANT la conserva aunque el comando llegue horas después: el
  inicio, si no es anterior a la asignación ni de hace más de 24 horas; un
  servicio, si no es anterior a la apertura de la ventana de la operación ni a
  su transición previa. Los hitos se ajustan dentro de la ventana de la
  operación; en una corrección, un hito vacío abre el ajuste en lugar de grabar
  «AHORA», y el ajuste indica que la hora vale hasta la primera entrega a OCC.
  Los daños, las incidencias y las desviaciones de la corrección llevan la hora
  actual y ELEVANT los acepta.
- **El reloj de ELEVANT.** El
  [reloj del servidor](../../frontend/mobile-agent/src/synchronization/server-clock.ts)
  toma el desfase de la cabecera `Date` y lo guarda en el dispositivo. Toda hora
  que captura la tablet sale de ahí, y la insignia de conexión avisa cuando el
  desfase pasa de 2 minutos.
- **La evidencia sobrevive a la sesión.** Un `401`, un `403`, la sesión vencida o
  el cierre de sesión ya no borran lo que ELEVANT no confirmó: queda ligado a la
  cuenta, solo esa cuenta lo envía al volver a entrar y «Sincronización» indica
  los registros de otra cuenta, sin mostrarlos.
- **Lo marcado después del fin de la sesión.** Posterior a la fase 3 (hallazgo N5
  de la corrida del VPS del 16 de noviembre): lo que el agente marca en el
  checklist después de que su sesión venció o fue rechazada ya no se pierde.
  - Al terminar la sesión, la tablet deja un marcador no secreto con la cuenta,
    la causa y la hora del fin
    ([almacenamiento](../../frontend/mobile-agent/src/storage/mobile-session.ts)).
  - La pantalla del checklist guarda para la cuenta con la que se abrió: con su
    sesión activa o, sin sesión, durante 2 horas desde el fin (D-N5). Las
    respuestas vuelven cuando esa cuenta inicia sesión de nuevo.
  - Otra cuenta activa, el cierre de sesión a propósito o el plazo vencido lo
    impiden. El cierre de sesión y un inicio de sesión confirmado borran el
    marcador; un intento fallido no.
  - Los comandos de la cola siguen exigiendo una sesión: el checklist se envía
    después de volver a entrar.
- **La app dice que la sesión terminó.** Posterior a la fase 3 (hallazgo N6 de
  la corrida del VPS del 16 de noviembre): la tablet ya no culpa al dispositivo
  cuando la sesión termina.
  - Al borrar una sesión que el agente no cerró (vencida, rechazada o de una
    cuenta que perdió el acceso), el
    [layout raíz](../../frontend/mobile-agent/src/app/_layout.tsx) muestra en
    todas las pantallas, salvo la de acceso, el aviso persistente «Tu sesión
    terminó» con ENTRAR DE NUEVO (D-N6). El cierre de sesión a propósito no lo
    muestra.
  - El checklist (`/checklist/[id]`) ya no salta solo al acceso: muestra la
    insignia roja «Sesión terminada», dice «Tu sesión terminó · Tus respuestas
    quedaron guardadas…», apaga ENVIAR y ofrece ENTRAR DE NUEVO. Con una cuenta
    sin acceso nombra la causa y abre el acceso con `access_revoked`. Mientras
    muestra ese aviso propio, el layout no repite el suyo: un solo aviso, un
    solo ENTRAR DE NUEVO y un solo anuncio, sin decir que guardó respuestas que
    no pudo guardar.
  - ENVIAR vuelve a guardar el borrador y espera ese guardado antes de decidir.
    Un fallo del almacenamiento ofrece REINTENTAR GUARDADO, un intento por
    toque, y si vuelve a fallar pide cerrar la app y avisar a OCC.
  - Los hitos y los datos del vuelo distinguen la sesión terminada de un fallo
    del almacenamiento. Ningún texto pide desbloquear el dispositivo ni habla
    de «payload».
  - La APK instalada conserva los textos anteriores hasta que se instale la
    nueva.
- **Entrega.** La APK nueva vacía la cola antes de entregar y no entrega con
  registros pendientes o rechazados de la operación, ni con la Orden de Servicio
  sin las firmas de la aerolínea y de AVIAM sobre su contenido actual.
- **El cierre comprueba todos los requisitos.** Posterior a la fase 3 (hallazgo N1
  de la corrida del VPS del 16 de noviembre): con el checklist en 0/21, el cierre
  solo pedía la firma, y un diálogo nativo pedía al agente confirmar lo que la
  tablet puede comprobar.
  - La tarjeta de entrega lista, en orden, «Servicios terminados», «Checklist
    enviado», «Incidencias enviadas», «Datos del vuelo completos», «Orden de
    Servicio firmada» y «Registros enviados a ELEVANT», cada uno con su estado
    ([requisitos](../../frontend/mobile-agent/src/features/assigned-operations/handoff.ts),
    [lista y hoja](../../frontend/mobile-agent/src/components/handoff-requirements.tsx)).
    Lo que falta apaga ENTREGAR A OCC y ofrece su salida: ABRIR CHECKLIST, ABRIR
    INCIDENCIAS o ABRIR SINCRONIZACIÓN.
  - Lo que la tablet no puede comprobar (sin señal, la copia guardada de un
    checklist no enviado, los formularios aún sin leer) queda «por confirmar» y
    no bloquea: el servicio lo vuelve a comprobar antes de enviar. Un envío del
    checklist que espera en la cola lo cubre el requisito de la cola.
  - «Datos del vuelo completos» (hallazgo S1, D-S1) solo avisa y nunca bloquea:
    lee el resumen de la Orden de Servicio y dice si le faltan los pasajeros o
    el MTOW. Con la Orden firmada, añade que se puede entregar sin ellos y que
    guardarlos ahora obliga a firmarla de nuevo; con los datos en la cola, que
    llegan a la Orden al enviarse. El servicio de entrega no lo comprueba.
  - La pantalla lee el checklist al enfocarse, cuando la cola cambia, al
    actualizar a mano y tras abrir la corrección, nunca con cada recarga del
    feed, y cuenta las incidencias que siguen en la tablet en cada carga.
  - El servicio vacía la cola antes de leer los servicios y el checklist, así
    que lo recién enviado cuenta, y no se fía de la copia guardada del
    checklist: sin señal, la entrega espera. Rechaza con los códigos de la
    tablet `checklist_not_submitted` y `pending_incidents`, que la tarjeta
    explica como «Entrega en espera».
  - ENTREGAR A OCC abre una hoja propia, con el
    [marco de hoja](../../frontend/mobile-agent/src/components/sheet-frame.tsx):
    lista lo que la tablet comprobó, avisa que la ejecución queda cerrada y
    ofrece SEGUIR REVISANDO y ENTREGAR A OCC. REINTENTAR ENTREGA sigue sin hoja.
  - Después de la entrega, VER CHECKLIST abre el checklist enviado en solo
    lectura; antes, el botón se apagaba. La tarjeta del checklist dice «Sin
    enviar», «Envío guardado en el dispositivo» o «Enviado a ELEVANT».
  - «Cargos aplicados» dice en una sola nota que la ejecución está cerrada o, en
    una operación devuelta, que hay que abrir la corrección. Antes culpaba al
    estado de cada servicio.
  - La regla del servidor no cambia, y la APK instalada conserva el diálogo y la
    regla anteriores hasta que se instale la nueva.
- **Lista y alcance.** La lista trae las operaciones activas y las que OCC aprobó
  en las últimas 48 horas, contadas desde la aprobación y no desde el fin de la
  operación, con las activas primero. Una operación iniciada sigue en
  manos de su agente aunque cambien su posición o su terminal.
- **Datos del vuelo y charter.** «Datos del vuelo» captura el tipo de avión de
  la lista de ELEVANT, fijo desde la primera entrega. En un charter con el
  prepago confirmado, la tarjeta oculta «AGREGAR» y lo explica.
  - Posterior a la fase 3 (hallazgo S1 de la corrida del VPS del 16 de
    noviembre): la Orden de Servicio se firmó con «Pasajeros —» y «MTOW —». Un
    error genérico no decía qué campo fallaba ni su rango, «1.5» se leía como 15
    y la tarjeta se sembraba una sola vez, antes de que llegara la cola.
  - Cada campo se lee tal como se escribió
    ([datos del vuelo](../../frontend/mobile-agent/src/utils/flight-data.ts)):
    números enteros con miles separados por coma o espacio, nunca un punto, un
    signo ni decimales, y un campo vacío no es 0. Cada campo con error dice su
    rango y se marca en rojo, el primero recibe el foco y no se guarda nada; un
    MTOW de 1 a 999 pregunta «¿Toneladas?».
  - La tarjeta muestra lo que espera en la cola aunque llegue después de
    abrirla, sin pisar lo que el agente escribió. Dice «Faltan: …» y «Sin
    guardar», y la insignia sigue diciendo dónde está lo guardado.
  - Faltar pasajeros o el MTOW solo avisa (D-S1): 0 pasajeros es un valor, la
    Orden se firma y se entrega igual, también después del push-back, y el
    servidor no cambia. La fila de la Orden y el principio de su hoja de firma
    lo dicen antes de firmar.
  - La APK instalada conserva la tarjeta anterior hasta que se instale la nueva.
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
- **Brecha actual:** protocolo servidor de dispositivo/idempotencia/reconciliación no está implementado de extremo a extremo. *Posterior al commit verificado: desde la fase 3 del ciclo, el inicio, los hitos, los datos del vuelo, las firmas, el walk-around, el charter, los servicios, los cargos, el checklist y el chat viajan por la misma cola con la instalación registrada y, salvo la foto del walk-around, una clave estable. En esa cola el recibo repite el mismo resultado o el mismo código, salvo en tres casos: el `contract_not_in_force` del inicio, que no se guarda y la misma clave vuelve a evaluar; el chat, que se deduplica por la clave del mensaje, y la foto, un `PUT` por marca en el que los mismos bytes cuentan como reintento. Las incidencias, la entrega a OCC, la corrección y la observación de asistencia conservan su propia clave reservada fuera de esa cola ([ADR-0039](../../docs/adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)).*
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

**El push-back con el vuelo a medio registrar se confirma.** Posterior al commit
verificado de esta nota (hallazgo N2 de la corrida del VPS del 16 de noviembre,
D-N2): un push-back registrado con un toque, con «En posición» en 0/13, «Salida»
en 0/4 y los servicios planificados, liberó la posición en OCC, cerró el tiempo
en tierra y fijó la hora de salida de la Orden.

- El primer toque del push-back, fuera de una ronda de corrección y sin otro
  push-back en la cola, abre la hoja «¿Registrar el push-back ahora?» cuando hay
  algún motivo ([motivos](../../frontend/mobile-agent/src/features/assigned-operations/pushback.ts),
  [hoja](../../frontend/mobile-agent/src/components/flight-report/pushback-sheet.tsx),
  sobre el [marco de hoja](../../frontend/mobile-agent/src/components/sheet-frame.tsx)):
  - falta el bloqueo;
  - «En posición» o «Salida» no tienen ningún hito;
  - ningún servicio salió de planificado, solo si la operación tiene servicios;
  - la Orden de Servicio ya tiene una firma, en ELEVANT o en la cola, y el
    push-back obliga a repetirla.
- La hoja dice el efecto: libera la posición en OCC, cierra el tiempo en tierra
  y fija la hora de salida de la Orden, y corregir la hora después no vuelve a
  ocupar la posición. REGISTRAR PUSH-BACK lo graba con la hora de ELEVANT del
  momento en que el agente confirma; VOLVER, el botón de la cabecera y el botón
  atrás cierran sin grabar.
- Sin motivos sigue siendo un toque. Un push-back ya registrado o en la cola
  abre el ajuste, y en una corrección el hito vacío abre el ajuste como antes.
- Solo avisa: el servidor no cambia, y la APK instalada sigue grabándolo con un
  toque hasta que se instale la nueva. La revisión de OCC señala esa secuencia
  ([nota de AVIAM Web](private-web-aviam.md)).

**Hitos del vuelo, la ayuda de JB y los avisos de servicio.** Posterior al
commit verificado de esta nota (hallazgo N13 de la corrida del VPS del 16 de
noviembre, D-N13): «Reporte de vuelo» nombraba tres cosas distintas, «JB» salía
sin explicar y el aviso «Servicio actualizado…» quedaba bajo el formulario y se
acumulaba, uno por servicio
([panel](../../frontend/mobile-agent/src/components/flight-report/flight-report-panel.tsx),
[tarjeta de servicio](../../frontend/mobile-agent/src/components/ramp-service-execution-card.tsx)).

- El panel de los hitos se llama «Hitos del vuelo». «Reporte de Vuelo» queda
  para el formulario de AVIAM que se firma, y la pantalla del checklist se
  encabeza «CHECKLIST OPERATIVO», como su tarjeta en el detalle.
- Los hitos conservan las palabras del formulario: el catálogo compartido no
  cambia. En la fase que muestra «Retiro escalera / JB», el panel dice «JB:
  pasarela de abordaje (jet bridge).».
- Un cambio de servicio que ELEVANT confirmó se dice en una frase con la hora
  del toque en la estación: «Aire acondicionado en ejecución desde las 19:59.»
  o «Aire acondicionado: completado a las 19:59.». Reabrir un servicio en una
  corrección dice «…: corrección abierta a las 19:59. Registra el nuevo
  resultado.»
  ([frases](../../frontend/mobile-agent/src/features/assigned-operations/presentation.ts)).
  La transición confirmada devuelve esa hora (`occurredAt`).
- Una confirmación nueva borra las de los demás servicios y la siguiente acción
  la quita, sin temporizador; con el formulario del resultado abierto no se
  muestra. Las advertencias y los rechazos se quedan.
- Los avisos del checklist, del detalle, de la tarjeta de servicio y de la de
  asistencia ya no dicen «comando», «canónico», «fuente de verdad» ni
  «payload». Con el envío del checklist sin confirmar, su botón es ACTUALIZAR.
- La APK instalada conserva los textos anteriores hasta que se instale la nueva.

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

**La hoja de firma con los botones al alcance.** Posterior al commit verificado
de esta nota (hallazgo S2 de la corrida del VPS del 16 de noviembre, decisión
D-S2). En horizontal, FIRMAR y CANCELAR quedaban bajo el pliegue y la hoja no
tenía cabecera. Ahora la hoja usa el
[marco de hoja](../../frontend/mobile-agent/src/components/sheet-frame.tsx):

- una cabecera fija con el formulario y «Cerrar sin firmar»; el botón atrás de
  Android también cierra sin firmar;
- un cuerpo que se desplaza, con el nombre y la cédula al principio, donde el
  pie no los tapa, después los datos y al final el pad;
- un pie fijo con la huella, CANCELAR y FIRMAR, en fila desde 600 dp y apilado
  en compact;
- el área segura, que deja la cabecera y el pie fuera de las barras del
  sistema, y las cuatro orientaciones también en iOS.

Un desplazamiento que empezaba sobre el pad dejaba un trazo suelto y bloqueaba
el desplazamiento de la hoja.

- Solo un dedo levantado guarda un trazo. Si la hoja se queda con el gesto, el
  trazo en curso se descarta y la hoja vuelve a desplazarse; los trazos ya
  hechos se conservan.
- «Borrar firma» borra también el trazo en curso.
- El pad mide como máximo 720 dp de ancho, centrado y en 3:1.
- Sin dos columnas en pantallas anchas (D-S2).
- Lo cubren las
  [pruebas de la hoja](../../frontend/mobile-agent/tests/operation-documents-sheet.test.js).
- La APK instalada conserva la hoja anterior hasta que se instale la nueva.

**El monto y las firmas que la entrega no espera.** Posterior al commit
verificado de esta nota (hallazgos N4 y N3 de la corrida del VPS del 16 de
noviembre, decisiones D-N4 y D-N3). El total de la Orden no decía que era
antes del ITBIS, y la firma del Reporte de Vuelo tenía el mismo FIRMAR naranja
que las firmas que la entrega exige.

- Bajo el total de la Orden de Servicio, la hoja de firma dice «Subtotal a
  precio de contrato, sin ITBIS. El importe final lo calcula Finanzas al
  facturar.». Si la Orden lista recargos, añade «Los recargos listados se
  valoran al facturar.».
- Un total que todavía no se valora dice «Pendiente de valoración», sin la
  nota.
- La nota no sale en el Reporte de Vuelo ni en los formularios de un charter,
  que se cobra a la tarifa base y no a un precio de contrato. El PDF no cambia.
- Entre las firmas, la entrega a OCC solo espera las de la Orden de Servicio
  ([`handoff.ts`](../../frontend/mobile-agent/src/features/assigned-operations/handoff.ts):
  `HANDOFF_REQUIRED_FORM` e `isOptionalForHandoff`).
- Mientras la operación está en curso y queda una firma por dar, el Reporte de
  Vuelo y el Check-List del puente dicen «No hace falta para entregar a OCC»,
  con un icono. El aviso se va con la firma hecha o guardada en el
  dispositivo, y después de la entrega.
- Su FIRMAR es un botón secundario, con borde y texto azul marino sobre blanco
  (contraste 13,5:1). El de la Orden y el de la Solicitud del charter siguen
  en naranja.
- Cada FIRMAR se anuncia como «Firmar: {rol}». Mientras se ve el aviso, el
  botón lo repite como sugerencia para el lector de pantalla.
- Lo cubren las mismas pruebas de la hoja.
- La APK instalada conserva el total sin nota y el FIRMAR naranja hasta que se
  instale la nueva.

**Tuteo y conteos en palabras.** Posterior al commit verificado de esta nota
(hallazgo N13 de la corrida del VPS del 16 de noviembre, D-N13): la tablet
mezclaba usted y tú y escribía «daño(s)».

- El walk-around, su hoja, el panel de formularios y el
  [charter](../../frontend/mobile-agent/src/components/documents/charter-card.tsx)
  le hablan de tú al agente: «Toca el avión donde encontraste una anomalía.
  Agrega una nota y una foto.», «Qué encontraste», «Lo que agregues aquí».
- Lo que lee el firmante es neutro: «Solo letras, números o guiones (4 a 40).»
  y «Los datos cambiaron después de la firma: hay que firmar de nuevo.». El pad
  conserva «Firme aquí con el dedo» (D-N13).
- Los daños se cuentan en palabras, «Sin daños», «1 daño» y «2 daños», y el
  resumen del Reporte de Vuelo y del Check-List del puente dice «4 hitos ·
  21/21 puntos del checklist · Sin daños».
- La APK instalada conserva los textos anteriores hasta que se instale la nueva.

## Fase 3, bloque 5: recargos automáticos

Desde el cierre OCC → Finanzas ([ADR-0034](../../docs/adr/0034-operational-close-occ-to-finance.md)), la [tarjeta de cargos](../../frontend/mobile-agent/src/components/ramp-operation-charges-card.tsx) muestra con su origen («automático» u «OCC») los recargos que marcó ELEVANT al entregar o que agregó OCC en la revisión.

El agente no puede quitarlos: solo quita los que marcó él. El servidor rechaza también ese intento.

## Fase 3, bloque 4b: charter sin contrato

En un charter ([ADR-0033](../../docs/adr/0033-charter-flights-without-contract.md)) la pantalla de operación suma la [tarjeta «Charter sin contrato»](../../frontend/mobile-agent/src/components/documents/charter-card.tsx). La tarjeta aparece cuando los formularios incluyen la Solicitud de Servicio y contiene:

- la dirección del transportista y quién paga los cargos;
- el catálogo de servicios con la tarifa base y su mínimo, con la cantidad y «Agregar»;
- el estado del prepago que confirma Finanzas.

Los servicios y los datos viajan en la misma cola persistente, sin señal. La hoja de firma de la Solicitud de Servicio pide además la cédula o el pasaporte. Ese dato queda en el dispositivo solo hasta que se envía.
