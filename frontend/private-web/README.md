# ELEVANT AVIAM Web

## Medios del flujo comercial

Contratos edita cada servicio en un panel lateral con foto y video subidos por
archivo o arrastre. Superadministración sube los logos de aerolíneas y fotos
de usuarios; Gestión Humana puede subir fotos de perfiles de rampa. Los
archivos viajan al endpoint autorizado de la API y las imágenes predefinidas
de servicios se incluyen como recursos estáticos. Las confirmaciones de
retirada, archivo y descarte se presentan dentro de la aplicación. La carga
remota exige preparar el [almacén privado](../../ops/dokploy/media-storage/README.md).

Aplicación interna para OCC, administración, contratos, finanzas, gestión humana y departamentos operativos. El cliente actual usa Vite 6, React 18, React Router y Tailwind.

## Ejecutar y validar

Desde `frontend/private-web`:

```powershell
npm ci
npm test
npm run test:delivery
$env:VITE_ELEVANT_API_URL = "https://api.elevant.test"
$env:VITE_PROTOTYPE_API_URL = $env:VITE_ELEVANT_API_URL
$env:VITE_HR_DEMO_MODE = "dashboard-read-only"
npm run dev
npm run build
```

Vite sirve localmente en `http://localhost:5173`. Abre ese origen exacto, no `http://127.0.0.1:5173`: la política CORS de Development autoriza `localhost` y rechaza el origen alternativo. Las entradas históricas `dashboard.html`, `contracts.html` y `finance.html` se conservan junto con las rutas del router.

Las variables `VITE_*` son públicas y nunca deben contener tokens, contraseñas ni cadenas SQL. Las tres primeras son obligatorias; la clave de Google Maps es opcional y visible en el navegador cuando se configura. El build falla si falta un origen, si no usa HTTPS, si apunta a localhost, si contiene una ruta, si los dos orígenes no coinciden o si `VITE_HR_DEMO_MODE` no vale exactamente `dashboard-read-only`. `VITE_ELEVANT_API_URL` configura el cliente OpenAPI compartido y `VITE_PROTOTYPE_API_URL` mantiene temporalmente los adaptadores anteriores apuntando a la misma API real de Development. En esta rama local, el dashboard de Gestión Humana deriva el total de agentes activos y perfiles sin cuenta vinculada de `GET /api/v1/human-resources/ramp-profiles`; ya no muestra las cifras sintéticas de turnos, habilitaciones o cobertura. Revalida al recibir un cambio durable, al recuperar foco/conexión y cada 25 segundos. **Agentes de rampa** sigue usando perfiles y estaciones reales del API. **Habilitaciones y certificaciones** consulta `GET /api/v1/human-resources/qualifications` con páginas de 20 y muestra ciclos actuales de solo lectura; calcula la vigencia por fecha y no ofrece altas ni renovaciones ficticias. Revalida con señales de cambios, foco, reconexión y sondeo de 25 segundos; una lectura fallida oculta los datos anteriores. Permisos, turnos y otras rutas profundas aún no conectadas continúan ocultas en este modo. No se ha promocionado este cambio.

La lista activa de **Agentes de rampa** revalida perfiles autorizados ante cambios durables, foco, reconexión y cada 25 segundos. Una lectura fallida oculta los perfiles y la edición anteriores, muestra un error recuperable y evita renderizar detalles internos del servidor; una respuesta tardía no reemplaza una lectura más reciente. Si falla guardar, conserva el formulario sin exponer trazas internas. Este ajuste permanece solo en la rama local.

El formulario de acceso usa `POST /api/v1/auth/session` mediante el cliente OpenAPI compartido. Acepta los roles internos, `SUPERADMIN` y roles personalizados del portal `back_office`; estos últimos consultan sus permisos vigentes y abren `/espacio-de-trabajo`. Conserva el Bearer de corta duración en el almacenamiento elegido por el usuario y elimina la sesión al vencer o cuando la API responde `401`. Las credenciales mock existen únicamente durante las pruebas automatizadas.

`/superadmin` ofrece **Inicio**, **Usuarios**, **Aerolíneas** y **Configuración**. Inicio permite crear manualmente la cuenta de una aerolínea después de la aprobación por Contratos. Usuarios administra cuentas y roles personalizados con acciones Ver/Crear/Editar/Acceso completo para los módulos comerciales; vincula cuentas `RAMP_AGENT` a perfiles creados por Gestión Humana. Aerolíneas administra las fichas públicas y ofrece una acción supervisada para completar registros históricos sin sobrescribir ediciones manuales. Configuración muestra auditoría paginada con cambios permitidos, sin contraseñas ni correos en el detalle. Contratos dispone de **Inicio**, **Solicitudes**, **Servicios** y **Borradores** conectados a la API. El borrador exige confirmación explícita de cada tarifa, incluso cuando es cero por cortesía. Inicio resume hasta 200 solicitudes y consulta una proyección de hasta 100 borradores con cinco recientes; no descarga comentarios, tarifas, términos ni el catálogo completo para calcular sus KPI. El detalle está en [el flujo comercial](../../docs/workflows/commercial-intake-and-governance.md) y la [guía de rampa](../../docs/workflows/ramp-agent-readiness.md).

En esta rama, **Contratos**, **Servicios pactados** y **Reportes contractuales** leen páginas de acuerdos con versiones publicadas mediante `GET /api/v1/contracts/agreements`. Comparten datos autorizados por `commercial.requests.read`; la tabla distingue tarifas de versiones aprobadas y reemplazadas, muestra sus estaciones y conserva cuatro decimales del precio pactado. El reporte indica que sus indicadores son de la página visible, no del historial completo. Los antiguos formularios de alta/edición y la auditoría ficticia de exportación ya no están montados: se mantienen fuera de la sesión hasta disponer de comandos reales. Los demás módulos no descritos aquí aún requieren revisión de integración y pruebas remotas.

Estas vistas comerciales y la gobernanza releen HTTP al recuperar foco o conexión y cada 25 segundos mientras están visibles. Es un respaldo del feed de cambios cuando falla una recarga puntual; el socket no reemplaza la API como fuente de verdad.

Si la API devuelve `409 password_change_required`, la web muestra una activación
sin sesión y llama `POST /api/v1/auth/password-change`; después exige iniciar
sesión con la nueva contraseña. Los cambios de contraseña revocan JWT anteriores.

Para pruebas locales, `.env.local` (ignorado por Git) puede apuntar ambas URLs
de API al origen HTTPS privado de Development. `VITE_GOOGLE_MAPS_API_KEY` es
opcional: cuando está presente, el mapa de posiciones y el de vuelos usan Maps
JavaScript API; sin ella mantienen MapLibre. La clave del navegador es visible
para quien carga la página: restríngela en Google Cloud por los orígenes web
autorizados y limita sus permisos a Maps JavaScript API. El modo oscuro se
selecciona al crear el mapa y cambiar de tema recrea esa instancia, no los datos.
Esta integración es de prueba local: la CSP actual de Nginx no permite cargar
Maps JavaScript API en la imagen publicada. No promociones un build con la clave
hasta certificar una política CSP compatible y revisar los dominios cargados.

## Planificación OCC remota

La ruta `/admin-occ/planning` es el primer módulo de negocio conectado de extremo a extremo con la API de Development. Consume exclusivamente el cliente compartido para consultar:

- `GET /api/v1/occ/planning`, con estación tomada de los scopes de la sesión y fecha operativa controlada por el usuario;
- `GET /api/v1/occ/planning/options?turnaroundId={turnaroundId}`, al abrir el detalle de una escala autorizada;
- `GET /api/v1/occ/planning/manual-options?stationId={stationId}&date={date}`, para elegir aerolínea con contrato vigente, aeropuertos y posición activa en la estación autorizada;
- `POST /api/v1/occ/planning/turnarounds`, para crear una escala manual con llegada, salida y posición, usando un UUID estable para reintentos ambiguos;
- `POST /api/v1/occ/planning/turnarounds/{turnaroundId}/shift`, para programar un turno local de un agente cuyo único impedimento es la cobertura;
- `POST /api/v1/occ/planning/turnarounds/{turnaroundId}/assignment`, para confirmar la asignación inicial de un único agente elegible con el `ETag` fuerte devuelto por la consulta de opciones.

La pantalla representa una escala completa, conserva sus tramos de llegada y salida y muestra solo los recursos devueltos por el servidor. El manifiesto de despacho permite escoger exclusivamente un agente marcado como elegible; contrato, posición y servicios son decisiones del backend y se muestran como datos bloqueados. La web no reintenta automáticamente el comando. Un `409`, `412`, `404` o resultado de red ambiguo obliga a refrescar opciones y planificación antes de una nueva confirmación.

El alta manual verifica nuevamente en la API el scope OCC, contrato único aprobado y vigente, fecha local, ruta y disponibilidad de la posición. Una respuesta ambigua conserva el mismo UUID para reintentar sin duplicar; editar el formulario inicia una intención nueva. El alta deja la operación en `Planned` y no despacha automáticamente. El panel de cobertura muestra solo agentes cuyo único impedimento es el turno; la API revalida permisos, terminal, jornada de hasta 16 horas y cobertura completa. Tras programar, la web obtiene opciones y ETag nuevos antes de permitir asignar. El módulo incluye estados de carga, vacío, error recuperable, sesión expirada, permiso denegado y ausencia de scopes. Un `403` no se presenta como fallo de conexión ni ofrece reintentos infinitos. Editar escalas existentes, importar vuelos y generar Work Orders permanecen deshabilitados. Los fixtures del módulo se usan solo en pruebas.

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
canónico; esta vista es de solo lectura. Aún no hay prueba remota del corte.

El resumen de Contratos permanece sintético y se señala en la interfaz. En
esta rama local, **Finanzas → Inicio** consulta servicios aprobados de los
últimos 30 días y la primera página de prefacturas de la estación autorizada
mediante la API versionada. Los contadores son del conjunto consultado (máximo
200 servicios y 50 prefacturas), no totales históricos. Expone los límites de
paginación, estados vacíos o de error, y revalida con cambios durables, foco y
polling. No consulta `/api/finance/summary` ni inventa saldos o conciliaciones.
Los dos departamentos mantienen oculto el antiguo buzón `/api/notifications`,
ausente del OpenAPI canónico.
El icono de notificaciones de esos dos departamentos permanece oculto hasta
que exista un feed autorizado para sus roles. Los módulos profundos no
enumerados como integrados abajo siguen siendo prototipos y no deben
interpretarse como un circuito completo sin endpoints heredados.

En la rama de integración, **Finanzas → Servicios aprobados** es una excepción
concreta a esa descripción histórica: consulta la API versionada con estación
y período explícitos, muestra evidencia aprobada y razones de bloqueo reales,
escucha el feed durable y reconsulta al recuperar foco o como máximo cada 25
segundos. La antigua acción local «Marcar revisado» se retiró porque no
persistía ni auditaba. Desde esta misma vista, Finanzas puede elegir hasta
100 servicios facturables de una sola aerolínea y moneda y crear una
prefactura de prueba persistente y auditada. La selección se reconcilia con
las reservas de otros usuarios; un intento incierto conserva su clave para
reintentar sin duplicar. El detalle se lee de nuevo de la API, no del estado
del navegador. La prefactura no es una factura ni un recibo: conciliación,
emisión y cobro siguen pendientes. No se ha promovido al VPS.

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
no inventa casos ni saldos. En esta rama local, Finanzas puede resolver la
disputa más reciente con motivo y confirmación explícita: mantener devuelve
`Submitted` para otra respuesta de la aerolínea; anular deja `Voided` y libera
los servicios para una prefactura nueva. El intento conserva su UUID al
reintentar una respuesta incierta y la vista relee el resultado persistido.
No se modifica una línea ni su importe histórico. Desde una prefactura
`Accepted`, Finanzas puede confirmar una emisión **no fiscal** mediante
`POST /api/v1/finance/invoices`. El reintento conserva el mismo UUID de intención;
la tabla se relee al recibir el aviso durable o al recuperar foco/conectividad.
Una prefactura `Invoiced` consulta el snapshot emitido por
`GET /api/v1/finance/invoices/by-preinvoice/{preinvoiceId}`. Esta rama añade
un registro manual de pago completo sobre la factura no fiscal. La pantalla
exige referencia y confirmación; envía una clave de intención estable, relee
el pago por la API y no lo presenta como conciliación bancaria verificada.
El aviso durable `finance_preinvoices` provoca revalidación. Todavía no hay
PDF fiscal, impuesto ni conciliación. En este tramo local, el detalle permite
descargar la factura no fiscal y, si existe un pago registrado, su recibo PDF
privado. Ambos se obtienen por la API con la sesión de Finanzas y alcance de
estación vigente; no se generan en el navegador. Una transferencia bancaria
no queda verificada por registrar su referencia. El flujo sigue en la rama
local, sin promoción al VPS.

## Imagen de Development

La imagen se construye desde la raíz del monorepo porque consume `packages/api-client`:

```powershell
docker build --file frontend/private-web/Dockerfile `
  --build-arg VITE_ELEVANT_API_URL=https://api.elevant.test `
  --build-arg VITE_PROTOTYPE_API_URL=https://api.elevant.test `
  --build-arg VITE_HR_DEMO_MODE=dashboard-read-only `
  --tag elevant-private-web:local .
```

El runtime usa Nginx sin privilegios, UID `101`, puerto `8080`, raíz de solo lectura y un archivo físico `/healthz`. Las rutas profundas del SPA vuelven a `index.html`; los recursos inexistentes bajo `/assets/` responden `404` y los recursos versionados usan caché inmutable.

`compose.development.aviam-web.yml` exige `ELEVANT_AVIAM_WEB_IMAGE` por digest, publica únicamente `127.0.0.1:18081` y conecta solo la red externa `elevant-dev-aviam-web-runtime`. Tailscale termina HTTPS fuera del contenedor. La aplicación no comparte la red de SQL Server.

CI renderiza ese Compose y valida un modelo cerrado antes de permitir su publicación. La certificación de imagen también interpreta la CSP, rechaza directivas duplicadas y exige que `connect-src` contenga exactamente `'self'`, la API certificada y los dos proveedores de mapas revisados.

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

Esta entrega es un **preview técnico de Development**. Autenticación, Planificación OCC, monitoreo, mapa de posiciones, revisión, reportes operativos, notificaciones y chat consumen la API versionada donde existe el contrato correspondiente. El Dashboard OCC combina la planificación de la fecha UTC y estación seleccionadas, la cola de revisión de esa estación y los avisos persistidos de la cuenta filtrados por estación. Sus conteos son de consultas acotadas, no totales históricos; revalida ante cambios durables de notificaciones, foco, reconexión y cada 25 segundos. Monitoreo usa la estación OCC seleccionada tanto en la lectura inicial como en el refresco de 30 segundos; reemplaza el conjunto de vuelos completo y oculta resultados anteriores si el refresco falla. Solo PUJ dispone de coordenadas cartográficas revisadas: otra estación muestra horarios de la API sin un mapa centrado artificialmente en PUJ. Nada de esto demuestra telemetría, disponibilidad, certificación ISO ni conexión FlightAware. El resumen de Gestión Humana usa los perfiles reales descritos arriba, pero sus módulos profundos todavía no constituyen circuitos canónicos. Reportes financieros agrupa estados reales de la primera página de hasta 50 prefacturas de la estación autorizada, separadas por aerolínea y moneda. Ya no solicita `/api/finance/reports` ni ofrece exportaciones simuladas; no es un reporte histórico completo. Seguimiento y Tarifas son lecturas reales paginadas por estación, pero aún no constituyen conciliación bancaria ni cambios futuros de tarifa. La imagen no incluye ni inicia `backend-prototipo`. Estos cambios de OCC están solo en esta rama local; no se han promocionado al VPS.

El Mapa de posiciones mantiene la cartografía PUJ revisada con estados derivados de planificación, nunca ocupación física confirmada. Para otra estación autorizada muestra únicamente las posiciones asignadas que devuelve planificación, en una lista sin coordenadas ni mapa de PUJ. El refresco de 30 segundos reemplaza el snapshot completo y retira datos anteriores ante una falla; el enlace a Monitoreo conserva la estación. Sigue pendiente un contrato canónico de coordenadas y ocupación física para las demás estaciones.
