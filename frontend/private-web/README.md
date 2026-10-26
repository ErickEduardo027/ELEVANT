# ELEVANT AVIAM Web

## Firma contractual (rama local)

Contratos permite revisar la solicitud de origen, los servicios y paquetes,
asignar al firmante AVIAM, previsualizar y emitir el PDF individual de una
versión aprobada. La cuenta asignada confirma su aceptación sobre el hash del
PDF; el módulo muestra después la aceptación de la aerolínea, el PDF final y
la evidencia. Cada lectura y acción vuelve a autorizarse en la API. El modo
local requiere configuración explícita de Development/Test y archivo privado;
Adobe conserva sus requisitos externos. Esta rama no está desplegada.

## Introducción y carrusel del acceso

El acceso conserva la marca ELEVANT en ambas paletas. La introducción se
reproduce una vez por carga completa de página (también al recargar), cuando
sus dos imágenes están listas; no utiliza un indicador persistido en la
sesión. Mientras carga el logo el formulario sigue disponible: un clic,
tecla o foco cancela la introducción pendiente. Una imagen fallida o una
espera de 20 segundos la omite; nunca demora el inicio de sesión.

El carrusel conserva los seis logos originales en una franja horizontal, con
desplazamiento automático de 38 segundos por vuelta, pausa/reanudación explícita
y dos grupos de igual ancho para unir el bucle sin saltos. Por decisión de
producto, la introducción ELEVANT y el carrusel arrancan también cuando el
sistema declara `prefers-reduced-motion: reduce`: esa preferencia no los
oculta ni convierte la franja en cuadrícula. La pausa es voluntaria y su
control permanece visible; una recarga inicia el carrusel de nuevo.

La certificación de la imagen de producción comprueba los bytes de los
logos/fotografías y ejecuta `scripts/verify-auth-motion.mjs` con Chromium
contra el contenedor exacto, antes de publicarlo. Se prueba una carga lenta,
recarga, interacción con el formulario y unión del bucle. La matriz de escritorio,
tablet y móvil exige desplazamiento real en ambos temas e idiomas, con movimiento
reducido, sin él y sin emular la preferencia del sistema. También comprueba que
pausar realmente detenga los logos y conserve la pausa al cambiar idioma o tema.
Para repetirla con un servidor de producción local:

```powershell
npx playwright install chromium
node scripts/verify-auth-motion.mjs http://127.0.0.1:3022
```

La prueba no requiere credenciales ni acceso a la API. El servidor debe
haber sido compilado con las variables documentadas más abajo. La presencia
de estos checks en un PR no acredita que su imagen ya esté promovida al VPS.

## Alertas preliminares de turnos (rama local)

En **Gestión Humana → Turnos de rampa**, el panel «Alertas de programación»
consulta `GET /api/v1/human-resources/schedule-warnings` por estación
autorizada y hasta 30 fechas locales inclusivas. Pagina de 20 en 20 y muestra
superposición, descanso corto, carga programada de siete días o un intervalo
no evaluable. La API calcula las reglas y devuelve evidencia visible, fecha,
versión y hora de consulta; la web no deduce cumplimiento legal, horas
trabajadas ni pago. Si otra estación influye en el cálculo sin estar concedida
al usuario, solo se muestra «Evidencia restringida», nunca sus datos. El
selector de estación, la revalidación y el cambio de sesión retiran de
inmediato las filas antiguas. La vista mensual de 31 días inicia con 30 para
respetar el contrato; el día restante se consulta cambiando las fechas. Esta
ruta de lectura aún requiere CI, promoción y aceptación en Development antes
de considerarse disponible en el VPS.

## Revisión de asistencia de Gestión Humana (rama local)

La ruta `/gestion-humana/attendance` consulta una página de asignaciones por
estación autorizada y fechas locales. Presenta por separado los aportes
inmutables de OCC y agente, con autor, revisión, horas observadas y nota.
G.H. elige de qué aporte tomar inicio y fin; una discrepancia exige motivo.
La validación conserva ambas revisiones y muestra si sigue vigente. Ante 409,
relee el estado sin perder el motivo y exige confirmar las versiones nuevas;
un resultado incierto solo se reintenta con el mismo UUID y cuerpo. Ante 401/403
retira los datos anteriores. El feed `attendance_draft` y
`attendance_validation`, foco, reconexión y sondeo visible de 25 segundos
invalidan la vista, pero la API REST sigue siendo la autoridad. No hay horas
extra automáticas ni captura biométrica. Aún falta aceptación de tres sesiones
contra Development después de promocionar DB, API y web.

**Reportes de personal** en esta rama consulta cuatro informes de la API versionada por estación autorizada: vigencias, movimientos de cuenta con auditoría atribuible, distribución de turnos y cobertura de habilitaciones. Cada página muestra hasta 20 filas, `asOf` y filtros de hasta 30 fechas; no se presenta la página como un total global. La cobertura usa perfiles y ciclos activos actuales y comprueba sus fechas al día final seleccionado; no reconstruye altas o bajas históricas. PDF y XLSX provienen de una exportación completa del servidor (máximo 5 000 filas), no de la tabla visible. La API reautoriza la estación y el rol antes de servir el archivo y audita la exportación. La vista retira datos al perder acceso y reconsulta con pistas durables, foco, reconexión y sondeo visible de 25 segundos. Los movimientos históricos sin estación verificable no se atribuyen retrospectivamente; los comandos de gobierno nuevos asocian la estación verificada al evento de cuentas de rampa. Este cambio aún necesita CI, navegador y promoción antes de considerarse disponible en el VPS.

El informe de vigencias también filtra habilitaciones o permisos y estado de
vigencia calculado con la fecha local de la estación. PDF y XLSX conservan
exactamente esos filtros, no solo las filas de la página visible.

## Medios del flujo comercial

Contratos edita cada servicio en un panel lateral con foto y video subidos por
archivo o arrastre. Superadministración sube los logos de aerolíneas y fotos
de usuarios; Gestión Humana puede subir fotos de perfiles de rampa. Los
archivos viajan al endpoint autorizado de la API y las imágenes predefinidas
de servicios se incluyen como recursos estáticos. Las confirmaciones de
retirada, archivo y descarte se presentan dentro de la aplicación. La carga
remota exige preparar el [almacén privado](../../ops/dokploy/media-storage/README.md).

En **Contratos → Servicios → Catálogo**, la lista interna muestra diez servicios
por página, incluidos los ocultos. Indica el rango y el total, conserva la
página durante las recargas y la ajusta si desaparecen filas. Al guardar, abre
la página donde queda el servicio según el orden devuelto por la API. Esta
paginación se aplica en la vista: el endpoint sigue entregando la lista completa.

Aplicación interna para OCC, administración, contratos, finanzas, gestión humana y departamentos operativos. El cliente usa Next.js App Router, React 19 y Tailwind CSS. El enrutamiento y los guards viven en `app/`; las pantallas funcionales existentes permanecen en `src/features/`.

En OCC, **Operación → Mis gastos** abre `/admin-occ/expenses`. El enlace se muestra en el riel lateral y su versión móvil; la API determina qué gastos y acciones puede ver cada cuenta.

## Ejecutar y validar

Desde `frontend/private-web`:

Si `.env.local` todavía contiene claves `VITE_*`, cambia sus nombres a `NEXT_PUBLIC_*` antes de ejecutar la aplicación. Las variables de Vite ya no configuran el build de Next.js.

```powershell
npm ci
npm test
npm run test:delivery
npm run lint
npm run typecheck
$env:NEXT_PUBLIC_ELEVANT_API_URL = "https://api.elevant.test"
$env:NEXT_PUBLIC_PROTOTYPE_API_URL = $env:NEXT_PUBLIC_ELEVANT_API_URL
$env:NEXT_PUBLIC_HR_DEMO_MODE = "dashboard-read-only"
npm run dev
npm run build
```

Next sirve localmente en `http://localhost:3000`. Las rutas canónicas son `/admin-occ/*`, `/gestion-humana/*`, `/contratos`, `/finanzas`, `/superadmin` y `/admin-occ/users`. El servidor Next redirige las URL históricas `index.html`, `dashboard.html`, `contracts.html` y `finance.html` a sus rutas equivalentes.

`npm run build` usa Webpack para compilar el CSS/PostCSS de esta aplicación y después comprueba los recursos de MapLibre. El comando sigue validando el entorno de Development antes de compilar.

Las variables del navegador llevan el prefijo `NEXT_PUBLIC_` y nunca deben contener tokens, contraseñas ni cadenas SQL. Las dos URL de API y el modo de demostración son obligatorios para el build de Development. El build valida HTTPS, orígenes idénticos y `NEXT_PUBLIC_HR_DEMO_MODE=dashboard-read-only`. `NEXT_PUBLIC_ELEVANT_API_URL` configura el cliente OpenAPI compartido; `NEXT_PUBLIC_PROTOTYPE_API_URL` mantiene los adaptadores heredados conectados al mismo origen real de Development.

CI y Docker pasan `NEXT_PUBLIC_ELEVANT_API_URL`, `NEXT_PUBLIC_PROTOTYPE_API_URL` y `NEXT_PUBLIC_HR_DEMO_MODE` durante el build. El origen API también permanece fijado como variable pública en el runtime standalone para generar la CSP por solicitud. El cambio de runtime requiere revisar y aplicar el Compose del repositorio antes de promover una imagen nueva; una imagen Next no es compatible con el antiguo contenedor Nginx.

`/healthz` pertenece al Route Handler de Next y devuelve exactamente los dos bytes `ok`. No agregues un archivo `public/healthz`: al copiar los recursos públicos a la imagen puede responder ese archivo en lugar del handler. La certificación compara el cuerpo HTTP byte a byte, como exige el healthcheck del contenedor.

El dashboard de Gestión Humana deriva el total de agentes activos y perfiles sin cuenta vinculada de `GET /api/v1/human-resources/ramp-profiles`; ya no muestra las cifras sintéticas de turnos, habilitaciones o cobertura. Revalida al recibir un cambio durable, al recuperar foco/conexión y cada 25 segundos. **Agentes de rampa** usa perfiles, estaciones y terminales reales de la API; el formulario limita terminales a las estaciones seleccionadas, permite elegir un supervisor activo y distingue perfil sin cuenta de una cuenta IAM activa o deshabilitada. El estado IAM no confirma acceso móvil efectivo. Guardar un perfil no concede acceso ni envía invitaciones. En esta rama local, una acción separada solicita acceso móvil con UUID de intención estable; el estado se relee por `GET /api/v1/human-resources/ramp-profiles/access-requests`. **Habilitaciones y certificaciones** consulta `GET /api/v1/human-resources/qualifications` en páginas de 20, obtiene un ciclo puntual por agente y equipo, y permite registrar o renovar mediante `PUT /api/v1/human-resources/qualifications/{id}`. Conserva la clave de intención para un reintento incierto y relee el ciclo al recibir 409; no inventa adjuntos.

**Carnets y permisos aeroportuarios** consulta `GET /api/v1/human-resources/permits` en páginas de 20 y permite registrar el primer ciclo o renovarlo con `PUT /api/v1/human-resources/permits/{id}`. Consulta antes el par exacto agente/tipo; una respuesta incierta reutiliza el UUID y un 409 exige relectura. No simula archivos adjuntos. Ambas vistas calculan vigencia por fecha. **Turnos de rampa** consulta `GET /api/v1/human-resources/shifts` por semana local, ventana móvil de 15 días o mes calendario, siempre en páginas de 20; presenta turnos registrados con estación, terminal, horario y posición. No atribuye totales del período a la página visible. Gestión Humana los consulta, pero OCC es el único rol autorizado para registrarlos. El `PUT` heredado se conserva temporalmente con autorización OCC mientras se prepara su calendario general. Las seis opciones del formulario de cobertura por vuelo son sugerencias editables, no plantillas globales persistidas. En la misma ruta, **Ausencias y solicitudes** conserva su consulta semanal sobre la semana que contiene la fecha seleccionada, aunque se vean turnos de 15 días o de un mes. Lista solicitudes reales por ventana y página, registra una intención `Pending` con UUID estable y permite aprobar o rechazar con relectura ante 409 o resultado incierto. Un `ShiftChange` aprobado no reprograma el turno. El feed `hr_absences`, el foco, la reconexión y el sondeo de 25 segundos revalidan la lista; una pérdida de acceso oculta solicitudes y turnos. No calcula disponibilidad ficticia. Las otras rutas profundas aún no conectadas continúan ocultas en este modo.

La lista activa de **Agentes de rampa** revalida perfiles autorizados ante cambios durables, foco, reconexión y cada 25 segundos. Una lectura fallida oculta los perfiles y la edición anteriores, muestra un error recuperable y evita renderizar detalles internos del servidor; una respuesta tardía no reemplaza una lectura más reciente. Si falla guardar, conserva el formulario sin exponer trazas internas.

El formulario de acceso usa `POST /api/v1/auth/session` mediante el cliente OpenAPI compartido. Acepta los roles internos, `SUPERADMIN` y los roles personalizados heredados del portal `back_office`, que abren `/contratos`. Tras iniciar sesión carga `GET /api/v1/governance/me/access` y cada shell muestra sólo los módulos y acciones que concede el acceso por departamento (ver ADR-0015); el servidor sigue siendo la autoridad. Conserva el Bearer de corta duración en el almacenamiento elegido por el usuario y elimina la sesión al vencer o cuando la API responde `401`. Las credenciales mock existen únicamente durante las pruebas automatizadas.

`/superadmin` ofrece **Inicio**, **Usuarios**, **Aerolíneas** y **Configuración**. Inicio permite crear manualmente la cuenta de una aerolínea después de la aprobación por Contratos. En esta rama local, Inicio también muestra solicitudes móviles pendientes de Gestión Humana y permite aprobar creando la cuenta vinculada o rechazar con motivo; no envía invitaciones. Usuarios administra cuentas y roles personalizados con acciones Ver/Crear/Editar/Acceso completo para los módulos comerciales. La creación genérica de cuenta nueva ya no ofrece `RAMP_AGENT` en la interfaz: la bandeja hace visible su solicitud y decisión, aunque la API conserva la ruta genérica compatible cuando no hay petición pendiente. Aerolíneas administra las fichas públicas y ofrece una acción supervisada para completar registros históricos sin sobrescribir ediciones manuales. Configuración muestra auditoría paginada con cambios permitidos, sin contraseñas ni correos en el detalle. Contratos dispone de **Inicio**, **Solicitudes**, **Servicios** y **Borradores** conectados a la API. El borrador exige confirmación explícita de cada tarifa, incluso cuando es cero por cortesía. Inicio resume hasta 200 solicitudes y consulta una proyección de hasta 100 borradores con cinco recientes; no descarga comentarios, tarifas, términos ni el catálogo completo para calcular sus KPI. El detalle está en [el flujo comercial](../../docs/workflows/commercial-intake-and-governance.md) y la [guía de rampa](../../docs/workflows/ramp-agent-readiness.md).

**Contratos**, **Servicios pactados** y **Reportes contractuales** leen páginas de acuerdos con versiones publicadas mediante `GET /api/v1/contracts/agreements`. Comparten datos autorizados por `commercial.requests.read`; la tabla distingue tarifas de versiones aprobadas y reemplazadas, muestra sus estaciones y conserva cuatro decimales del precio pactado. El reporte indica que sus indicadores son de la página visible, no del historial completo. Los antiguos formularios de alta/edición y la auditoría ficticia de exportación ya no están montados: se mantienen fuera de la sesión hasta disponer de comandos reales. Las seis vistas visibles de Contratos se recorrieron contra el VPS sin 404/405/5xx observados; eso no equivale a probar sus escrituras comerciales de punta a punta.

«Comunicaciones» de Contratos y Finanzas permanece fuera de la navegación y del montaje activo. Su adaptador heredado usa `/api/internal-chat/messages`, ausente de OpenAPI y sin persistencia en la base compartida; no debe presentarse como chat funcional. El chat operativo OCC–agente sí conserva su contrato `/api/v1` independiente. El chat departamental se retomará en otra entrega.

Estas vistas comerciales y la gobernanza releen HTTP al recuperar foco o conexión y cada 25 segundos mientras están visibles. Es un respaldo del feed de cambios cuando falla una recarga puntual; el socket no reemplaza la API como fuente de verdad.

Si la API devuelve `409 password_change_required`, la web muestra una activación
sin sesión y llama `POST /api/v1/auth/password-change`; después exige iniciar
sesión con la nueva contraseña. Los cambios de contraseña revocan JWT anteriores.

Para pruebas locales, `.env.local` (ignorado por Git) puede apuntar ambas URLs
de API al origen HTTPS privado de Development. Monitoreo y Mapa de posiciones
usan MapLibre en local y en la imagen publicada; no requieren una clave de
Google. `predev` y `prebuild` copian el worker y su módulo compartido desde la
versión instalada de MapLibre a `public/assets/maplibre/`. La verificación del
build y la certificación de la imagen comprueban esos dos archivos. Si cambias
de versión de MapLibre, vuelve a ejecutar `npm ci` y el build; no edites los
archivos generados. Los estilos públicos se cargan desde los orígenes permitidos
por la CSP y necesitan conectividad del navegador a esos proveedores.

El mapa base de PUJ aparece en Monitoreo aun sin coordenadas de aeronaves y lo
indica explícitamente. Otras estaciones no usan el centro de PUJ. La selección
de una clave local de Google quedó desactivada; cualquier experimento futuro
con ese proveedor requiere una decisión y una CSP revisadas por separado.

## Layout responsive

Todas las áreas se renderizan dentro de `src/features/shell/ShellFrame.jsx`, con
sidebar y topbar fijos y scroll solo en el contenido. Los breakpoints salen de
`src/config/breakpoints.js` (los mismos para Tailwind y para los hooks, más `3xl`
a 1920 px). Para pantallas nuevas:

- envuelve la cabecera en `PageHeader`, los filtros en `FilterBar` y las vistas
  lista + panel en `SplitLayout`, que se separa a partir de `lg`;
- añade la clase `table-stack` a las tablas anchas: se apilan como tarjetas
  etiquetadas cuando su contenedor mide menos de 40 rem;
- da a los grids de varias columnas un `grid-cols-1` base y evita anchos fijos.

Comprueba las pantallas a 360, 768, 1024 y 1920 px antes de entregar. Ejecuta
la app en el puerto 5173 (`npm run dev -- -p 5173`) para no chocar con Public Web.

## Espacio OCC (PUJ)

`AdminOccLayout` monta un marco propio sobre `ShellFrame`: riel navy agrupado (`OccSidebar`), barra contextual (`OccTopbar`) y tokens `occ-*` definidos en `src/styles/occ.css` bajo `[data-department="occ"]`. Los demás departamentos siguen usando `Sidebar`/`Topbar`. Todas las rutas OCC leen el alcance `PUJ` con `useOccStation()`; sin él no consultan la API. El idioma (es/en) comparte el store del login (`src/i18n/languageStore.js`) y solo se aplica dentro de `LanguageScope`, que envuelve OCC; fuera de él la interfaz sigue en español.

El dashboard (`src/features/dashboard`) deriva resumen, escalas y atención de planificación, revisión y avisos. Su superficie NOC integra una plataforma PUJ dominante, dos mapas auxiliares y una franja de cifras. La plataforma incorpora geometría OSM de pistas, rodajes y plataforma; las siluetas representan **asignaciones planificadas**, no ocupación confirmada. La vista nocturna inclina el mapa y extruye edificios solo si las teselas incluyen altura. `dashboardPositions.js` usa las 42 ubicaciones del catálogo **interno original**: 41 se muestran en el mapa y B33 se conserva como registro histórico retirado de la vista operativa por la [enmienda AIP de 2026](https://aip.sna.gob.do/Datos/AMDT_AIRAC/AMDT_AIRAC_3-26/AMDT_AIRAC_03-26.pdf). B34–B37 siguen en el catálogo y B20–B32 mantienen sus 13 coordenadas internas originales. La [carta AIP de 2024](https://aip.sna.gob.do/Datos/AMDT_AIRAC/AMDT_AIRAC_03-24.pdf) sirve para conciliación, pero sus coordenadas no se transcriben en la aplicación: no consta permiso de IDAC para procesarlas y la [política AIP](https://aip.sna.gob.do/Aip/CircularSerA) exige revisar ese uso. Las ubicaciones internas no están verificadas como oficiales; hay discrepancias de códigos y coordenadas, especialmente B20–B32. Los códigos planificados ausentes del catálogo activo, incluido B33, aparecen sin ubicación; no se equiparan A1 y 1 ni otros códigos parecidos. El mapa general de posiciones conserva el catálogo interno y requiere conciliación independiente.

Los mapas auxiliares ampliables muestran meteorología y la región de República Dominicana. El METAR MDPC de Iowa Environmental Mesonet es una réplica no oficial: distingue hora de observación y recepción, fallos de actualización y valores derivados. GOES-East infrarrojo e [IMERG de 30 minutos](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/IMERG_Precipitation_Rate_30min.json) usan NASA GIBS; las teselas se fijan al tiempo comunicado por GIBS. Cuando solo se conoce la fecha, se muestra el día sin inventar una hora ni calcular antigüedad horaria. IMERG estima precipitación y puede retrasarse varias horas; no es radar ni observación local. La vista muestra fuente, opacidad y error. `src/config/securityHeaders.mjs` permite los orígenes cartográficos y meteorológicos existentes. Manrope e IBM Plex Mono se sirven como archivos propios mediante `next/font`.

El mapa regional consume `GET /api/v1/occ/traffic/aircraft?stationId=<uuid>` mediante el cliente OpenAPI compartido. Dibuja una marca por ICAO24 con posición disponible y rumbo si existe; la ficha muestra solo telemetría recibida. La API exige personal AVIAM con `operations.planning.read` y alcance PUJ. Sin configuración privada, el panel informa que la telemetría no está disponible. Las escalas y stands de planificación siguen separados: callsign y proximidad no crean una relación verificable. El navegador nunca envía secretos ni llama directamente a OpenSky. La conexión real requiere credenciales OAuth privadas y el acuerdo escrito. La caché es por proceso, con una consulta como máximo cada 120 segundos y copia desactualizada hasta 10 minutos durante fallos. Esta rama local no ha sido desplegada.

## Planificación OCC remota

Guardar o desactivar un perfil de rampa invalida la planificación OCC de sus
estaciones anteriores y solicitadas, sin identidad del agente en la pista
durable. Una desactivación también avisa a la estación cuyo scope se retira.

La ruta `/admin-occ/planning` es el primer módulo de negocio conectado de extremo a extremo con la API de Development. Consume exclusivamente el cliente compartido para consultar:

- `GET /api/v1/occ/planning`, con la estación PUJ tomada de los scopes de la sesión (OCC no ofrece selector de estación) y fecha operativa controlada por el usuario;
- `GET /api/v1/occ/planning/options?turnaroundId={turnaroundId}`, al abrir el detalle de una escala autorizada;
- `GET /api/v1/occ/planning/manual-options?stationId={stationId}&date={date}`, para elegir aerolínea con contrato vigente, aeropuertos y posición activa en la estación autorizada;
- `POST /api/v1/occ/planning/turnarounds`, para crear una escala manual con llegada, salida y posición, usando un UUID estable para reintentos ambiguos;
- `POST /api/v1/occ/planning/turnarounds/{turnaroundId}/shift`, para programar un turno local de un agente cuyo único impedimento es la cobertura;
- `POST /api/v1/occ/planning/turnarounds/{turnaroundId}/assignment`, para confirmar la asignación inicial de un único agente elegible con el `ETag` fuerte devuelto por la consulta de opciones.

La pantalla representa una escala completa, conserva sus tramos de llegada y salida y muestra solo los recursos devueltos por el servidor. El manifiesto de despacho permite escoger exclusivamente un agente marcado como elegible; contrato, posición y servicios son decisiones del backend y se muestran como datos bloqueados. La web no reintenta automáticamente el comando. Un `409`, `412`, `404` o resultado de red ambiguo obliga a refrescar opciones y planificación antes de una nueva confirmación.

El alta manual verifica nuevamente en la API el scope OCC, contrato único aprobado y vigente, fecha local, ruta y disponibilidad de la posición. Una respuesta ambigua conserva el mismo UUID para reintentar sin duplicar; editar el formulario inicia una intención nueva. El alta deja la operación en `Planned` y no despacha automáticamente. El panel de cobertura muestra solo agentes cuyo único impedimento es el turno; la API revalida permisos, terminal, jornada de hasta 16 horas y cobertura completa. Tras programar, la web obtiene opciones y ETag nuevos antes de permitir asignar. El módulo incluye estados de carga, vacío, error recuperable, sesión expirada, permiso denegado y ausencia de scopes. Un `403` no se presenta como fallo de conexión ni ofrece reintentos infinitos. Editar escalas existentes, importar vuelos y generar Work Orders permanecen deshabilitados. Los fixtures del módulo se usan solo en pruebas.

El formulario OCC de cobertura de rampa ofrece seis horarios precargados por vuelo y permite editar inicio y fin antes de confirmar. No guarda plantillas globales: la API valida la cobertura local, la elegibilidad y los conflictos. Fuera de las escalas manuales todavía no existe un editor general del calendario OCC.

En esta rama, el detalle de una operación con agente asignado muestra un panel
de **asistencia observada**. OCC puede guardar su propio inicio, fin y nota
manuales; ve el aporte del agente en solo lectura. El panel consulta la API
compartida por operación y asignación, y relee ante `attendance_draft`, foco,
reconexión y cada 25 segundos mientras está visible. Un `409` conserva los
campos intentados junto a la nueva revisión para decisión explícita. Tras un
PUT de resultado incierto, el reintento reutiliza el UUID y el mismo cuerpo.
La hora editada se interpreta en la zona del dispositivo indicada en el panel,
no como fichaje biométrico ni como hora de estación. La API revalida rol y
estación; ocultar o mostrar el panel no concede permisos. Esta interfaz aún
requiere aceptación de dos sesiones contra Development tras la promoción.

Una ausencia o restricción aprobada para un agente con alcance en la estación
emite `occ_planning` sin detalles laborales. Registrar un turno, carnet o
habilitación de rampa también la emite sin datos personales. Planificación reconsulta la
estación y sus opciones de asignación ante la pista durable, foco o conexión
recuperada y cada 25 segundos si la pestaña está visible. El backend sigue
revalidando elegibilidad y ETag al confirmar una asignación.

Durante una revalidación de la misma estación y fecha, la ruta conserva el
último snapshot de planificación para que el panel de una escala abierta no se
cierre antes de recibir la respuesta. Al cambiar estación o fecha, o si la
lectura falla, retira el snapshot anterior; una respuesta nueva sin esa escala
cierra el panel. Este ajuste de la rama de integración aún requiere aceptación
en navegador tras su promoción.

## Frontera de seguridad

Las rutas canónicas `/admin-occ/chat` y `/admin-occ/notifications` recuperan
mensajes y avisos persistentes desde la API. En la rama de integración de
Development también escuchan `ChangedV1` en los hubs autorizados: el aviso
solo dispara `GET /api/v1/changes`, y el recurso se vuelve a consultar por REST.
El cursor está en memoria por pantalla, sin reemplazar la autorización del
servidor. Al reconectar, volver a enfocar la pestaña o recuperar la red se
reconcilia el feed; una consulta cada 25 segundos respalda WebSocket y los
sondeos existentes de las pantallas permanecen. No implica entrega con la
pestaña cerrada ni garantiza la latencia hasta la prueba real del VPS.
La corrección pendiente de esta rama desactiva los logs internos del transporte
SignalR en el navegador para que un WebSocket autenticado no registre su URL
con token; la reconciliación HTTP y el sondeo de respaldo siguen activos.
Esta corrección no forma parte de la imagen #118 ya promovida.

En esta rama, una asignación OCC agrega en la misma transacción una invalidación
`occ_planning` limitada a las cuentas OCC vigentes de su estación. Planificación,
Monitoreo y Mapa de posiciones releen sus snapshots autorizados cuando reciben
esa señal; foco, reconexión y sondeo visible conservan una ruta de recuperación.
El aviso no transporta identidad del agente ni estado del vuelo. Esto todavía
no demuestra latencia en el VPS ni despliegue de esta rama.

La ruta `/admin-occ/review` consume exclusivamente la API canónica de revisión:
cola limitada por la estación del actor, detalle de la última entrega y decisión
individual. Muestra checklist, servicios, incidencias y nota del agente sin
convertir los fixtures históricos en datos reales. Aprobar o devolver requiere
confirmación; devolver exige un motivo. Cada decisión usa `If-Match` con la
versión fuerte del detalle. Ante `409`, `412` o un resultado de red ambiguo, la
web refresca la cola y el detalle y no reenvía el comando automáticamente.
No ofrece aprobación masiva ni simula firmas, adjuntos o envío a Finanzas. Las
devoluciones aún no tienen un flujo de corrección y reentrega en Mobile Agent.

La pantalla ofrece carga, cola vacía, error recuperable, sesión caducada,
permiso denegado y ausencia de scopes. El backend sigue siendo quien impone
rol, membresía y estación; el selector del navegador solo organiza la vista.

Los roles, tenants y scopes de estación se validan en el servidor. Filtros, menús ocultos y sesiones del prototipo no autorizan datos. La web solo consume la API HTTPS versionada; no accede directamente a SQL Server, proveedores de aviación ni almacenamiento de objetos.

## Módulos observados

- panel OCC y monitoreo de vuelos/turnarounds;
- planificación, posiciones, agentes, equipos y cobertura;
- checklists, incidencias, evidencias y revisión;
- contratos, solicitudes, servicios y tarifas;
- gestión humana, turnos, disponibilidad, habilitaciones y permisos;
- finanzas, reportes, notificaciones y chat sujetos a contratos API definitivos.

Los mocks describen flujos de producto, no contratos persistentes ni una frontera de autorización.

En esta rama, **Finanzas → Tarifas** usa `GET /api/v1/finance/tariffs` con
estación autorizada y páginas de 20 tarifas publicadas. Distingue versiones
aprobadas e históricas, moneda y cuatro decimales, sin recalcular precios de
operaciones o facturas ya congeladas. La activación contractual escribe una
invalidación durable `finance_tariffs`; el cliente también reconsulta al
recuperar foco/conectividad y cada 25 segundos mientras está visible. Se
retiró «Programar cambio» porque solo modificaba memoria local. Crear una
nueva versión contractual con precios futuros todavía requiere un comando
canónico; esta vista es de solo lectura. La lectura remota carga sin 404, pero
no se ha probado un cambio futuro de tarifa de punta a punta.

El resumen de Contratos consulta solicitudes y borradores autorizados.
**Finanzas → Inicio** consulta servicios aprobados de los
últimos 30 días y la primera página de prefacturas de la estación autorizada
mediante la API versionada. Los contadores son del conjunto consultado (máximo
200 servicios y 50 prefacturas), no totales históricos. Expone los límites de
paginación, estados vacíos o de error, y revalida con cambios durables, foco y
polling. No consulta `/api/finance/summary` ni inventa saldos o conciliaciones.
Los dos departamentos mantienen oculto el antiguo buzón `/api/notifications`,
ausente del OpenAPI canónico.
El icono de notificaciones de esos dos departamentos permanece oculto hasta
que exista un feed autorizado para sus roles. Los módulos que aún dependan de
endpoints heredados no deben montarse ni interpretarse como parte del circuito.

**Finanzas → Servicios aprobados** consulta la API versionada con estación
y período explícitos, muestra evidencia aprobada y razones de bloqueo reales,
escucha el feed durable y reconsulta al recuperar foco o como máximo cada 25
segundos. La antigua acción local «Marcar revisado» se retiró porque no
persistía ni auditaba. Desde esta misma vista, Finanzas puede elegir hasta
100 servicios facturables de una sola aerolínea y moneda y crear una
prefactura de prueba persistente y auditada. La selección se reconcilia con
las reservas de otros usuarios; un intento incierto conserva su clave para
reintentar sin duplicar. El detalle se lee de nuevo de la API, no del estado
del navegador. La prefactura no es una factura ni un recibo: emisión, pago
manual y documentos son transiciones posteriores y separadas.

**Finanzas → Pre-facturación** consulta `GET /api/v1/finance/preinvoices`
por estación autorizada y página. Muestra importes, estado y número de líneas
persistidos, y abre el detalle canónico; revalida por feed durable, foco y
polling de 25 segundos. Retira el servicio simulado `/api/finance/preinvoices`
y sus botones ficticios. Un borrador puede enviarse a la aerolínea tras
confirmación explícita con `POST /api/v1/finance/preinvoices/{draftId}/submit`;
un reintento de red usa la misma clave y el estado se relee desde la API. La
creación real permanece en Servicios aprobados. Seguimiento financiero consulta
`GET /api/v1/finance/reconciliation` por estación autorizada y página, y
presenta prefacturas aceptadas, facturas no fiscales y pagos manuales
persistidos sin simular una conciliación bancaria. Tarifas y Reportes también
tienen lecturas acotadas de la API.

El detalle de Pre-facturación también lee las disputas de la aerolínea con
asunto, descripción y líneas cuestionadas desde
`GET /api/v1/finance/preinvoices/{draftId}/disputes`, separado del detalle
v1 existente para conservar compatibilidad durante una promoción API-primero;
no inventa casos ni saldos. Finanzas puede resolver la
disputa más reciente con motivo y confirmación explícita: mantener devuelve
`Submitted` para otra respuesta de la aerolínea; anular deja `Voided` y libera
los servicios para una prefactura nueva. El intento conserva su UUID al
reintentar una respuesta incierta y la vista relee el resultado persistido.
No se modifica una línea ni su importe histórico. Desde una prefactura
`Accepted`, Finanzas puede confirmar una emisión **no fiscal** mediante
`POST /api/v1/finance/invoices`. El reintento conserva el mismo UUID de intención;
la tabla se relee al recibir el aviso durable o al recuperar foco/conectividad.
Una prefactura `Invoiced` consulta el snapshot emitido por
`GET /api/v1/finance/invoices/by-preinvoice/{preinvoiceId}`. Se ofrece
un registro manual de pago completo sobre la factura no fiscal. La pantalla
exige referencia y confirmación; envía una clave de intención estable, relee
el pago por la API y no lo presenta como conciliación bancaria verificada.
El aviso durable `finance_preinvoices` provoca revalidación. Todavía no hay
PDF fiscal, impuesto ni conciliación. El detalle permite
descargar la factura no fiscal y, si existe un pago registrado, su recibo PDF
privado. Ambos se obtienen por la API con la sesión de Finanzas y alcance de
estación vigente; no se generan en el navegador. Una transferencia bancaria
no queda verificada por registrar su referencia. La release #118 está
promovida en Development; todavía falta recorrer en el VPS una operación nueva
hasta factura, pago y recibo.

### Finanzas: tarifarios, cargos y cobros (ADR-0016)

La navegación de Finanzas se arma con los permisos `finance.*` del acceso
departamental (`src/features/finance/shell/modules.js`). «Tarifarios» agrupa
tarifario de servicios (tarifa base versionada por moneda), tarifario de cargos
(catálogo CRUD e importes por versión) y tasas de cambio USD→DOP. «Aprobación de
contratos» compara cada precio con la base y aprueba o devuelve con motivo;
Contratos envía a Finanzas en lugar de activar. Pre-facturación muestra los
cargos marcados por los agentes y los ajustes bajo su servicio y permite editar,
excluir o ajustar en borrador con motivo y versión esperada. «Facturas y cobros»
sustituye a Seguimiento: saldo, vencimiento, pagos parciales con método y fecha,
y notas de crédito. Reportes lee ocho reportes calculados por la API y exporta
CSV o PDF no fiscal con `finance.reports.export`. Los adaptadores están en
`src/services/financeBookService.js`. Nada de esto es facturación fiscal.

### Empleados, puestos y accesos (ADR-0017)

Gestión Humana registra a los empleados (`/gestion-humana/employees`), los
puestos y las requisiciones. Los administradores de departamento solicitan el
acceso eligiendo un empleado de su departamento en **Usuarios del departamento**
y tienen las pestañas Puestos, Requisiciones y Actividad. Las contraseñas
temporales se generan en el navegador (`temporaryPassword.js`) y no se guardan.
Los adaptadores están en `src/services/humanResourcesEmployeesService.js`.

## Imagen de Development

La imagen se construye desde la raíz del monorepo porque consume `packages/api-client`:

```powershell
docker build --file frontend/private-web/Dockerfile `
  --build-arg ELEVANT_DEPLOYMENT_ID=1111111111111111111111111111111111111111 `
  --build-arg NEXT_PUBLIC_ELEVANT_API_URL=https://api.elevant.test `
  --build-arg NEXT_PUBLIC_PROTOTYPE_API_URL=https://api.elevant.test `
  --build-arg NEXT_PUBLIC_HR_DEMO_MODE=dashboard-read-only `
  --tag elevant-private-web:local .
```

El runtime usa Node 24 sin privilegios, UID `101`, puerto `8080` y raíz de solo lectura con caché Next en tmpfs. `/healthz` responde `ok`, las rutas profundas se renderizan en Next y los recursos versionados `/_next/static/` usan caché inmutable. La CSP se genera con nonce por solicitud y limita conexiones al origen API certificado, su equivalente WebSocket, los proveedores cartográficos revisados, IEM y NASA GIBS.

`compose.development.aviam-web.yml` exige `ELEVANT_AVIAM_WEB_IMAGE` por digest, publica únicamente `127.0.0.1:18081` y conecta solo la red externa `elevant-dev-aviam-web-runtime`. Tailscale termina HTTPS fuera del contenedor. La aplicación no comparte la red de SQL Server.

CI renderiza ese Compose y valida un modelo cerrado antes de permitir su publicación. La certificación de imagen también interpreta la CSP, rechaza directivas duplicadas y exige que `connect-src` contenga exactamente `'self'`, la API HTTPS certificada, su equivalente `wss://` para el hub SignalR, los dos proveedores de mapas revisados, IEM y NASA GIBS. No se permite un comodín `wss:` ni otro host de WebSocket.
El certifier exige además la pantalla conectada de Gestión Humana y rechaza el antiguo rótulo permanente de datos sintéticos. El identificador histórico `dashboard-read-only` sigue delimitando las rutas HR no conectadas; no convierte el dashboard actual en un fixture.

## Promoción en Development

Los cambios de esta aplicación llegan al VPS solo después de fusionarse en
`Development`, superar el carril AVIAM de CI y producir una imagen y un bundle
inmutables. El tag `development-certified` sirve únicamente para descubrir el
bundle; el controlador despliega siempre las referencias `@sha256` validadas.

Antes de habilitar el schedule de una instalación nueva, el operador adopta
primero la baseline A sana, luego pausa el perfil y lo mantiene pausado mientras
ejecuta y verifica la promoción con rollback drill documentada por
`ops/dokploy/web-cd`. El drill comprueba candidato, restauración de la baseline y
repromoción final sin publicar puertos nuevos ni conectar la web a SQL Server.

Esta entrega es un **preview técnico de Development**. Autenticación, Planificación OCC, monitoreo, mapa de posiciones, revisión, reportes operativos, notificaciones y chat consumen la API versionada donde existe el contrato correspondiente. El Dashboard OCC combina la planificación de la fecha local y estación seleccionadas, la cola de revisión de esa estación y los avisos persistidos de la cuenta filtrados por estación. Sus conteos son de consultas acotadas, no totales históricos; revalida ante cambios durables de notificaciones, foco, reconexión y cada 25 segundos. Monitoreo usa la estación OCC seleccionada tanto en la lectura inicial como en el refresco de 30 segundos; reemplaza el conjunto de vuelos completo y oculta resultados anteriores si el refresco falla. Solo PUJ dispone de coordenadas cartográficas revisadas: otra estación muestra horarios de la API sin un mapa centrado artificialmente en PUJ. Nada de esto demuestra telemetría, disponibilidad, certificación ISO ni conexión FlightAware. El resumen de Gestión Humana usa los perfiles reales descritos arriba; sus rutas de habilitaciones, permisos, turnos y ausencias tienen contratos canónicos acotados, mientras otras rutas profundas permanecen pendientes. Reportes financieros agrupa estados reales de la primera página de hasta 50 prefacturas de la estación autorizada, separadas por aerolínea y moneda. Ya no solicita `/api/finance/reports` ni ofrece exportaciones simuladas; no es un reporte histórico completo. Seguimiento y Tarifas son lecturas reales paginadas por estación, pero aún no constituyen conciliación bancaria ni cambios futuros de tarifa. La imagen no incluye ni inicia `backend-prototipo`. La rama de integración anterior se promocionó al VPS mediante #118; las correcciones de esta rama todavía no.

El Mapa de posiciones mantiene la cartografía PUJ revisada con estados derivados de planificación, nunca ocupación física confirmada. Para otra estación autorizada muestra únicamente las posiciones asignadas que devuelve planificación, en una lista sin coordenadas ni mapa de PUJ. El refresco de 30 segundos reemplaza el snapshot completo y retira datos anteriores ante una falla; el enlace a Monitoreo conserva la estación. Sigue pendiente un contrato canónico de coordenadas y ocupación física para las demás estaciones.

En esta rama, OCC puede solicitar una clausura motivada desde **Notificaciones → Servicios**, viendo la oferta publicada y el historial interno. Contratos decide y puede republicar desde **Servicios → Solicitudes de clausura**; su contador lateral refleja pendientes. Los roles personalizados reciben grants separados para ver, solicitar, decidir y republicar. El feed y el sondeo de respaldo refrescan ambas vistas; la API conserva la autoridad sobre permisos y estados. [Recorrido y límites](../../docs/workflows/commercial-intake-and-governance.md#clausura-comercial-solicitada-por-occ-rama-de-implementación).
