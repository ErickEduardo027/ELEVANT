# Auditoría Admin/OCC

Este inventario describe las acciones conservadas y la implementación local de
`feat/adminocc-redesignall`. Los resultados de ejecución se registran por separado:
la presencia de código o de pruebas no acredita un despliegue ni una integración
real con SQL o con cuentas operativas.

## Límites protegidos

Panorama queda fuera de la extensión de presentación mediante
[OccWorkspace](../../../src/features/admin-occ/ui/OccWorkspace.jsx). No se editan
sus archivos, mapas, hooks, datos, geometrías, filtros, cámara o estilos ni sus
dependencias cartográficas compartidas. Los cambios autorizados a autenticación,
componentes comunes y las dos lecturas de Chat del cliente compartido se revisan
por separado, conservando sus valores predeterminados y los contratos restantes.
El marco conserva cabecera de 56 px, sidebar de 248/72 px
y los breakpoints existentes. La apariencia autorizada del marco se revisa por
separado del contenido protegido.

Monitoreo y Posiciones conservan URLs y autorización en
[navigation.js](../../../src/features/admin-occ/navigation.js). Sus entradas están
fuera del sidebar. Las vistas conservadas muestran consultas y operaciones sin
montar cartografía; Panorama concentra los tres mapas.

## Inventario de controles y flujos

| Área | Acción / condición de autorización | Handler y fuente | Resultado y estados conservados |
| --- | --- | --- | --- |
| Navegación | Entrar a los módulos concedidos por el acceso del departamento | `navigation.js`, guard de navegación y acceso efectivo de la API | Acceso directo autorizado; denegación explícita; enlaces contextuales según su permiso independiente. |
| Entrada OCC | Abrir la ruta base o iniciar sesión; `operations.dashboard.read` para el contenido de Panorama | `getRoleHomePath`, redirección de `/admin-occ`, `useNavigationGuard` | Destino `/admin-occ/dashboard`; aviso de módulos concedidos cuando falta acceso, sin elegir Mis gastos automáticamente. |
| Sesión | Solicitar, cancelar o confirmar el cierre manual en cualquier rol | `useLogoutConfirmation.request/dismiss/confirm`, `AuthContext.logout`, `authService.logout` | Cancelar conserva estado y devuelve foco; confirmación única con bloqueo síncrono, error visible y limpieza comprobada de credenciales. Expiración y 401 no pasan por este modal. |
| Planificación | Consultar y filtrar con `operations.planning.read`; cambiar Timeline/Tabla/Calendario y abrir detalle | `usePlanningData`, `getPlanningSnapshot`, `onSelectFlight` | Mismo snapshot e ID de escala; tabla de 25 filas, calendario diario en zona de estación, registros sin hora/fuera del día y refresco sin vaciar contenido. Caché separada por cuenta/estación/fecha. |
| Planificación | Crear escala, asignar operación y programar turno con permisos/validaciones existentes | `createManualTurnaround`, `assignPlanningOperation`, `programPlanningShift` de `planningService` | Confirmación del servidor y relectura compartida; se conservan versiones, conflictos, elegibilidad y asistencia. Las acciones futuras sin handler se ocultan. |
| Revisión | Consultar cola y elegir operación de la estación autorizada | `loadOccReviewQueue`, `loadOccReviewDetail` en `occReviewService` | Cola de tarjetas y detalle contextual; carga, vacío, error recuperable y discrepancia de estación. |
| Revisión | Abrir revisión histórica | `loadOccReviewSubmissionHistory`, `loadOccReviewSubmissionDetail` | Evidencias y decisión de la revisión seleccionada; no se sustituye la revisión actual ni se fabrican evidencias. |
| Revisión | Aprobar/devolver en `PendingReview`; autorización final de la API | `confirmDecision`, `decideOccReview` | Confirmación explícita; devolución con motivo de 8–2000 caracteres; bloqueo pendiente, relectura y errores de conflicto. |
| Reportes | Elegir reporte/periodo y generar | `generate`, `getOccReport` | Consulta de la estación autorizada, páginas de 25, resultado vacío, carga y error recuperable. |
| Reportes | Reintentar catálogo y cambiar cuenta/estación | `listOccReports`, `catalogRevision` y ámbito de la consulta | Carga/vacío/error de catálogo traducidos y reintento; se retira el resultado anterior durante el nuevo alcance y se ignoran respuestas tardías. |
| Reportes | Páginas anterior/siguiente | Estado `page` y `getOccReport` | Se respeta `hasMore`; se conservan filtros de la consulta generada. |
| Reportes | Exportar con `operations.reports.export` | `exportAs`, `downloadOccReport` | Excel/PDF/CSV reales del servidor, deshabilitados mientras se exporta o sin filas; fallo visible. |
| Notificaciones | Abrir avisos, actualizar y cambiar lectura | Centro operativo compartido y `center.markRead` | Popover, historial y toasts sincronizados; estados inicial, vacío, error/denegación y escritura pendiente. Contadores de avisos recientes. |
| Notificaciones | Solicitudes de clausura de servicios | `ServiceClosurePanel mode="occ"` y servicio comercial existente | Oferta e historial reales; los grants y la API conservan la autoridad para solicitar/decidir. |
| Chat | Leer conversaciones/mensajes con `operations.chat.read` y cargar páginas anteriores | `useChatPages.refresh/loadMore`, `getOperationalConversations`, `getOperationalMessages` | Offset opcional, límites de 100/200 y `hasMore`; orden del servidor, deduplicación por ID, guardia de falta de progreso y ancla de scroll. |
| Chat | Enviar/reintentar con `operations.chat.create` | `submit`, `sendOperationalMessage` | Comando y borrador por conversación, clave idempotente conservada y navegación durante el envío; solo aparecen como mensajes confirmados los devueltos por la API. No se fabrica presencia ni lectura de terceros. |
| Usuarios | Buscar y filtrar tipo/estado/plantilla | `DepartmentUsersPage`, lectura del directorio | Lista y filtros existentes; carga, vacío, error y actualización. Presentación optativa dentro de OCC. |
| Usuarios | Solicitar acceso, administrar usuarios, contraseñas y activación | `AccountFormDrawer`, `act`, servicios existentes del departamento | Se conservan `canManage`, alcance, versiones, validaciones y relectura ante 409; no se conceden permisos nuevos. |
| Usuarios | Perfiles, solicitudes, puestos, requisiciones y actividad | Paneles existentes seleccionados por `Tabs` | Navegación contextual lateral en OCC; operaciones y permisos previos. |
| Mis gastos | Crear/editar borrador propio con `canCreateOwnExpense` | `DocumentEditor`, `saveEmployeeExpense` | Valores, dimensiones, tasa congelada y líneas reales; borrador conservado ante fallo. |
| Mis gastos | Adjuntar/descargar comprobantes | `PrivateAttachments`, servicios privados existentes | PDF/PNG/JPEG, máximo 8 MB, versión e intención existentes; error visible y descarga pendiente. |
| Mis gastos | Enviar, aprobar departamento/Finanzas, rechazar | `DecisionForm`, `decideEmployeeExpense` | Propietario/etapa/grants existentes; motivo obligatorio para rechazo, bloqueo pendiente y control de versión. |
| Mis gastos | Registrar reembolso con permiso de Finanzas | `PaymentForm`, `reimburseEmployeeExpense` | Misma aritmética, saldo, tasa y validaciones del contrato; no se amplía la disponibilidad de la acción. |
| Posiciones | Llegada con matrícula, liberar y asignar vuelo | Componentes operativos y servicio de posiciones existentes | `canAssign`, validaciones y conflictos de la API; se conserva detalle y consulta filtrable sin mapas. |
| Monitoreo | Filtrar, actualizar, abrir detalle | Vista operativa y servicio existentes | Horarios, procedencia, conexión y `flightId`; sin mapas ni solicitudes de teselas. |

## Hallazgos priorizados

| Prioridad | Hallazgo | Tratamiento local |
| --- | --- | --- |
| P0 | Cierre manual inmediato susceptible a pulsaciones accidentales | Confirmación global; validación funcional a cargo de la fase de autenticación. |
| P1 | Destinos iniciales OCC en competencia con el primer módulo autorizado | Separación de destino inicial y prefijos; aviso con módulos disponibles cuando Panorama no está autorizado. |
| P1 | Tabla y Calendario eran placeholders | Sustitución por vistas del mismo snapshot de escalas; revisión funcional en Planificación. |
| P1 | Historial de Chat acotado sin navegación de páginas | Extensión compatible con offset y conservación de comandos por conversación; revisión de API/cliente y UI específica. |
| P1 | Reportes podía conservar filas del alcance anterior o quedar sin reintento tras fallar el catálogo | Ámbito de cuenta/token/estación y consulta aplicada, cancelación de respuestas antiguas, catálogo recuperable y exportación con bloqueo síncrono. |
| P2 | Duplicación cartográfica en páginas independientes | Consultas sin mapas y retirada del sidebar; permisos y operaciones conservados. |
| P2 | Revisión exigía desplazarse entre una tabla ancha y el detalle inferior | Cola legible con estado y detalle contextual a la derecha en escritorio; apilado en móvil. |
| P2 | Reportes mezclaba selección y resultado sin separación clara | Configuración lateral y área central de resultados, exportaciones y paginación. |
| P2 | Historial de avisos sin jerarquía cronológica | Rail de secciones/conteo real y lista con marcadores de lectura; reutiliza el mismo proveedor. |
| P2 | Directorio y gastos sin composición contextual propia en OCC | Navegación local del directorio y columnas de listado/detalle de gastos; estilos optativos. |
| P3 | Acciones futuras sin handler en Planificación | Ocultar los controles sin implementación; conservar las acciones reales y motivos de deshabilitación. |

## Verificación y límites

Evidencia local confirmada del 29 de octubre de 2026. La implementación no acredita todavía todos los controles finales:

| Control | Resultado confirmado |
| --- | --- |
| Rama y protección | `feat/adminocc-redesignall`; diff protegido de Panorama y sus mapas: salida 0. Sin cambios en entidades, migraciones ni ProductionDB. `git diff --check`: salida 0 en la revisión central. |
| Backend | Restauración bloqueada de diez proyectos; build serial: 11,09 s, cero advertencias/errores. Pasaron 623 pruebas unitarias, 26 de arquitectura y nueve casos enfocados de API de Chat. Guarda de modelo: cero cambios pendientes. Estas selecciones no equivalen a la suite SQL completa. |
| Contrato compartido | OpenAPI recapturado desde host Testing local y cliente regenerado con Orval. Comparación con contrato vivo y comprobación de generado pasaron; typecheck y 276 pruebas en 44 archivos del cliente pasaron. |
| Frontend enfocado | La primera pasada ampliada obtuvo 227 de 230; se actualizaron tres expectativas heredadas. Otra selección de cinco archivos y veinte pruebas encontró siete fallos; se corrigieron conteos/semántica de avisos, duplicación del texto inicial de Reportes, un fixture de estación no admitida por el módulo y el aislamiento de mocks. La repetición posterior obtuvo 17 de 20: nueve pruebas de notificaciones y dos de autenticación pasaron; quedan dos tiempos agotados de Reportes y una prueba de Chat que heredaba la URL del caso anterior; este aislamiento se corrigió después y aún requiere repetición. Las guardas de cuenta/estación y el reintento de catálogo pasaron. La última repetición, limitada a Chat y Reportes con dos workers, terminó con salida 1 y un informe de cero casos ejecutados; no acredita una suite enfocada final completa. Los campos de fecha de la prueba de Reportes usan ahora su evento nativo, conservando las mismas comprobaciones. |
| Delivery | 22 comprobaciones pasaron. |
| Vault | Inventario regenerado con el comando del repositorio; validación final aprobada: 104 notas, 6 canvas y 4 bases. |
| Secretos y limpieza | Control del repositorio: no se detectaron secretos en 2904 archivos no ignorados. Se retiró el cambio automático de `next-env.d.ts`; el diff protegido de Panorama y `git diff --check` terminaron con salida 0. |
| Lint de cambios | ESLint con las reglas existentes sobre 99 archivos JavaScript/TypeScript modificados: cero errores y 21 advertencias. La ejecución de lint de todo el árbol se interrumpió y no se acredita. |
| Typecheck | `next typegen && tsc --noEmit`: salida 0. Después se corrigió la importación del aviso de acceso usando `AppLink`; el escaneo de 402 archivos de producción no encontró imports relativos inexistentes. |
| Navegador y producción | Sintaxis del runner comprobada y benchmark del build anterior: diez de diez recorridos. El recorrido actual detectó una importación inexistente en `OccAccessNotice`, ya corregida; el intento posterior agotó 120 segundos sin respuesta de Dashboard. Los builds oficial y de contingencia Webpack se interrumpieron sin completar; no se acredita build, matriz nueva ni comparación visual final. La referencia de bundles anterior está en `occ-bundle-before.json`; no se presenta como medición del código nuevo. |

Las primeras ejecuciones con Node 22 y unos 254 MB libres de 8 GB sufrieron
tiempos agotados y fallos al iniciar workers. La validación posterior usa el
runtime Node 24 instalado. La suite amplia posterior con forks tuvo problemas de
terminación de workers y se interrumpió; la contingencia local con dos workers
threads y timeout de 15 segundos también se interrumpió tras tiempos agotados en
pruebas de Contratos, Paquetes y Gestión Humana cuyos archivos no se modificaron.
Estas ejecuciones no acreditan la suite completa ni permiten afirmar que CI pasa.
Las opciones locales de paralelismo y timeout no modifican CI.

La ejecución amplia de integración SQL se interrumpió después de un timeout en
`AirlinePortalDuringMigrations`; otra selección sin Persistence también se
interrumpió sin resultado final. Ninguna acredita la suite de integración completa.
El typecheck de Mobile Agent queda pendiente: falta su enlace instalado a
`@elevant/api-client`. La comprobación de Public Web se coordina aparte.

Sin commits, pushes, merges ni despliegues.

La suite final y los recorridos de navegador deben validar las composiciones en
375, 768, 1024 y 1440 px, ambos temas e idiomas, teclado, overflow, consola y
solicitudes fallidas. Las pruebas con respuestas interceptadas acreditan el
cliente, no una escritura remota ni la integración SQL. La conversación real
entre dos cuentas requiere cuentas QA autorizadas; nunca se usa personal
operativo como destinatario de pruebas. No se han autorizado commits, pushes,
merges ni despliegues.


## Segunda iteración — referencia local del 30 de octubre de 2026

Se preserva el trabajo de la primera iteración. El marco horizontal se activa solamente fuera de Dashboard/Panorama mediante `frameProps`: navegación autorizada medida, Más, menú móvil, cápsula de idioma de 28 px con objetivo de 44 px y avatar/menú de cuenta. Los controles táctiles mantienen 44 px; los de puntero fino admiten 36 px. Los estilos nuevos están acotados a CSS Modules optativos.

Los archivos de mapas, Dashboard, meteorología, servicios y estilos protegidos no presentan diff contra HEAD. `OccSidebar.jsx` y `OccTopbar.jsx` conservan cambios preexistentes de la primera iteración; no se han reeditado en esta segunda iteración. La comprobación visual final debe compararlos con la referencia inicial de esta iteración, no con HEAD. No hay cambios de migraciones ni ProductionDB. `git diff --check` terminó con salida 0.

La campana filtra pendientes antes de limitar ocho filas. Abrir confirma la lectura antes de navegar; historial, campana y toasts comparten la escritura y el estado. Los IDs se deduplican, las escrituras concurrentes se agrupan y las respuestas iniciadas antes de una lectura confirmada no la revierten. Un destino no autorizado explica la restricción y permite la lectura. Los registros históricos se conservan. Esta retirada de pendientes es la única excepción funcional aprobada para Panorama.

La presencia incorpora PUT/GET compatibles, identidad desde JWT, participantes reales autorizados y estado transitorio de una instancia. Secuencias y cierre terminal protegen paquetes tardíos; se agregan sesiones/dispositivos. Heartbeat 30 s, consulta visible 15 s, actividad 5 min, expiración 90 s y retención 24 h. Sin información o con fallo de consulta se muestra No disponible. Web y Mobile Agent tienen emisores propios; no se utiliza la cola offline ni se cambian entidades, migraciones o permisos. Una futura publicación requiere API antes que clientes. El escalado requiere revisar estado compartido y el transporte conforme a la [guía oficial](https://learn.microsoft.com/en-us/aspnet/core/signalr/scale?view=aspnetcore-10.0).

### Capturas y métricas preliminares

Los recorridos antes/después de Planificación, Notificaciones, Chat y Panorama obtuvieron 4/4 cada uno, sin errores de página/consola, solicitudes locales fallidas o rutas API inesperadas. Las capturas están en los artefactos `occ-v2-before` y `occ-v2-after`. Son mediciones de desarrollo con cachés distintas; no acreditan una mejora de producción.

| Módulo | Listo antes/después (ms) | GET antes/después | JS antes/después (bytes, desarrollo) |
| --- | --- | --- | --- |
| Planificación | 8169 / 7228 | 10 / 10 | 6296440 / 6334195 |
| Notificaciones | 8491 / 9409 | 7 / 7 | 6096115 / 6137029 |
| Chat | 9742 / 5757 | 10 / 11 | 6062816 / 6110493 |
| Panorama | 9170 / 5037 | 13 / 13 | 7062663 / 6273915 |

El GET adicional de Chat corresponde a la presencia agrupada. Se inspeccionaron las capturas de Planificación antes/después; el contenido central gana espacio al retirar la barra lateral y la doble superficie exterior.

### Inventario de controles refinados

| Control | Handler / servicio | Autorización y resultado |
| --- | --- | --- |
| Navegación, Más y menú móvil | OccHorizontalHeader, frameProps y enlaces existentes | Mismos grants y rutas; Monitoreo y Posiciones conservan acceso contextual. Escape y retorno de foco. |
| Idioma y cuenta | LanguageScope, tema y onLogout existentes | Preferencia global; confirmación de salida reutilizada con avatar como destino de foco. |
| Leer y abrir pendientes | useOperationalNotifications.markRead y NotificationOpenAction | Una escritura por aviso; lectura confirmada antes de navegación autorizada; error recuperable conserva el pendiente. |
| Presencia agrupada | OperationalPresenceHandler y almacén de comunicaciones existente | Identidades reales después del filtro por operación/estación; máximo 100 operaciones. |
| Heartbeat propio | PUT de presencia, createPresenceLease y emisores Web/Native | Identidad del JWT; aislamiento por cuenta, secuencia, cierre terminal y actividad pendiente que caduca. Sin outbox ni estado de autorización nuevo. |

### Verificación de esta iteración

| Control | Evidencia confirmada |
| --- | --- |
| Cliente compartido | OpenAPI recapturado y Orval regenerado; hash sha256:4dd26eaaab2fecdc84490dea3c88b50d03c6398615e26e1890f1cc77f6cda37d. check:generated y 280 pruebas en 46 archivos con dos workers: salida 0. Tras añadir caducidad de actividad se repitieron los tres casos del motor y el typecheck: salida 0. No se presenta como una segunda suite completa. |
| Frontend enfocado | 20 pruebas en cinco archivos: salida 0. Incluyen navegación/menús/foco, filtrado previo al límite de ocho, deduplicación y escrituras concurrentes, error y lectura antes de abrir, historial, borradores/reintentos de Chat y emisor Web sin randomUUID/cambio de cuenta. Contingencia local: un worker threads y timeout de 15 s por falta de RAM. |
| Lint | Pasada completa: salida 0, cero errores y 146 advertencias. Tras corregir la ref durante render y el alt del mock se repitió lint sobre los seis archivos afectados: cero errores y una advertencia del mock de next/image. No se cambió CI ni se ocultaron advertencias del árbol. |
| Delivery | 22/22 comprobaciones: salida 0. |
| Backend compilado | API tras corregir el máximo entero seguro: cero errores y una advertencia existente de Finanzas. Las pruebas nuevas de backend están escritas; su ejecución final está pendiente por recursos. |
| Panorama | Sin edición de archivos de mapas, Dashboard, meteorología, servicios o estilos protegidos. Marco legacy de la primera iteración preservado. Capturas preliminares antes/después disponibles; comparación funcional completa de cámara, selección, expansión y errores pendiente. |
| Vault y secretos | Inventario regenerado con herramienta propietaria; validación de 104 notas, 6 canvas y 4 bases. Escaneo sin secretos en 2922 archivos no ignorados. |
| Limpieza | Locks sin diff; se retiraron únicamente las dos referencias automáticas a .next/dev de next-env.d.ts. Sin cambios de migraciones o ProductionDB. |

Las primeras selecciones de frontend detectaron una expectativa antigua de enlace y tres coincidencias de texto que no incluían la estación; se corrigieron para probar la semántica real. La ejecución con dos forks no pudo iniciar dos workers y la de dos threads encontró un timeout de cinco segundos de Chat. La repetición enfocada de veinte casos pasó con la contingencia indicada. Esto no acredita la suite final amplia con dos workers ni CI remoto.

### Bloqueos confirmados y cierre pendiente

El usuario confirmó que no dispone ahora del entorno SQL, dos cuentas QA autorizadas o Android, y que no puede liberar más memoria. La medición mostró aproximadamente 55 MB libres de 8 GB; una posterior mostró 172 MB. No había navegadores headless de esta tarea que cerrar. No se detuvieron aplicaciones ajenas ni procesos del sistema.

La restauración móvil desde el lockfile falló con ECONNRESET al descargar Webpack y avisos EPERM de limpieza de node_modules. No se añadieron dependencias ni se alteraron locks. Lint/typecheck/tests nativos y bundles Android quedan pendientes de restaurar dependencias y disponer de recursos.

No se iniciaron nuevas tareas pesadas de producción después de confirmar estos límites. Quedan pendientes: typecheck de Private Web, suite amplia con dos workers, build oficial, pruebas nuevas de backend y control de modelo, matriz visual de cuatro anchos/temas/idiomas, flujos Playwright finales de logout/notificaciones, comparación completa de Panorama y confirmación de ausencia de mapas/teselas en las rutas operativas. La integración SQL y mensajería/presencia real entre dos cuentas, incluida Android, requiere el entorno QA confirmado como no disponible.

La implementación local es revisable, pero la validación integral no está cerrada. No se presentan fixtures interceptados como integración real ni verificaciones pendientes como aprobadas.

Sin commits, pushes, merges ni despliegues.


## Unificación final de navegación — tercera iteración

### Causa y cambio autorizado

El layout seleccionaba OccSidebar/OccTopbar para Panorama mediante una condición de ruta y OccHorizontalHeader para el resto. Se sustituyó por una configuración estable compartida con barra flotante de 56 px, máximo 1328 px y sin sidebar. La autorización nueva permite ampliar el espacio exterior de Panorama; su contenedor de refinamiento continúa excluido y sus archivos internos permanecen protegidos.

Panorama es acceso directo; Operación contiene Planificación, Revisión, Reportes y Mis gastos; Comunicación contiene Notificaciones y Chat interno; Administración contiene Usuarios. Se filtra la navegación permitida existente, se omiten grupos vacíos y se conserva acceso contextual a Vuelos/Posiciones. Cuando no cabe el conjunto se utiliza un menú agrupado. Los estilos legacy sin consumidores se retiraron con sus componentes.

El logo reutiliza los dos PNG del login sin fondo añadido. ES/EN y tema permanecen juntos fuera del perfil; se reutilizan idioma, tema, notificaciones y confirmación de logout existentes. No se cambian API, Mobile Agent, permisos, autenticación ni transportes.

Chat distribuye el alto disponible y limita la lista de escritorio a 240–320 px. El compositor controlado crece entre 44 y 144 px, con scroll posterior, sin cambiar Enter ni el controlador de borradores/envíos. Solo se limpia tras confirmar el servidor. Los cuatro estados de presencia existentes se representan como verde, ámbar, rojo y neutral, sin datos inventados.

### Referencia y evidencia

La referencia registra hashes SHA-256 de 135 archivos protegidos, capturas y geometría sobre el árbol previo a la edición. La comparación posterior de los 135 hashes no encontró diferencias. Los artefactos se agrupan en occ-v3/before y occ-v3/after, fuera del árbol de código.

Antes y después pasaron 2/2 recorridos de referencia de Chat/Panorama, sin errores de página, consola, peticiones locales o rutas API inesperadas. El escenario conservó 801 px de alto y el mapa principal 730 px. El escenario pasó de 1120 a 1358 px de ancho y se desplazó horizontalmente al retirar el sidebar; su desplazamiento vertical de 24 px corresponde al espacio reservado para la barra flotante. Las mediciones de desarrollo usan cachés distintas y no se presentan como mejora de rendimiento de producción.

La regresión enfocada de cinco archivos obtuvo 21/21 pruebas con los dos workers y opciones del workflow: salida 0. Incluye grupos/permisos, ES/EN, foco y logout, crecimiento/reducción/cambio de ancho del campo, borradores, reintentos y notificaciones compartidas. Hubo advertencias de act() en pruebas existentes.

### Incidencias del entorno y controles en curso

El servidor existente de desarrollo no completaba la hidratación y registraba errores HMR. Se reiniciaron exclusivamente sus dos procesos Next identificados por la ruta de Private Web; el servidor QA Webpack en 3100 completó las referencias. No se alteraron credenciales ni configuración de Git.

El recorrido funcional nuevo de navegación, logo/controles y compositor/presencia avanzó sin fallos. Al compilar Mis gastos el disco C: llegó a cero bytes libres y Next registró ENOSPC, devolvió errores 500 y dejó navegaciones posteriores pendientes. La ejecución fue detenida; no acredita la regresión funcional completa. Se retiraron únicamente cachés y salida de desarrollo regenerables de Next dentro del workspace, con rutas verificadas y servidor detenido. Quedaron aproximadamente 1,1 GB libres. Una escritura de system.md fue interrumpida; el documento completo se recuperó de la copia en memoria.

Se solicitó espacio adicional para continuar build y navegador. Delivery y suite completa se ejecutan secuencialmente; lint, typecheck, build, matriz visual completa y comparación funcional final quedan pendientes hasta registrar sus resultados. El entorno real SQL/cuentas/Android sigue no disponible según confirmación previa del usuario. No se presenta QA interceptada como integración real.

Sin commits, pushes, merges ni despliegues. El cierre integral sigue pendiente.
