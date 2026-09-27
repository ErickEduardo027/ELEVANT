# ELEVANT AVIAM Web

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

Las variables `VITE_*` son públicas y nunca deben contener tokens, contraseñas ni cadenas SQL. Las tres primeras son obligatorias; la clave de Google Maps es opcional y visible en el navegador cuando se configura. El build falla si falta un origen, si no usa HTTPS, si apunta a localhost, si contiene una ruta, si los dos orígenes no coinciden o si `VITE_HR_DEMO_MODE` no vale exactamente `dashboard-read-only`. `VITE_ELEVANT_API_URL` configura el cliente OpenAPI compartido y `VITE_PROTOTYPE_API_URL` mantiene temporalmente los adaptadores anteriores apuntando a la misma API real de Development. El modo de Gestión Humana conserva la autenticación real, pero limita ese módulo a un dashboard de datos sintéticos y solo lectura: no llama endpoints `/api/hr`, no expone rutas profundas ni ofrece acciones de escritura o exportación.

El formulario de acceso usa `POST /api/v1/auth/session` mediante el cliente OpenAPI compartido. Acepta los roles internos, `SUPERADMIN` y roles personalizados del portal `back_office`; estos últimos consultan sus permisos vigentes y abren `/espacio-de-trabajo`. Conserva el Bearer de corta duración en el almacenamiento elegido por el usuario y elimina la sesión al vencer o cuando la API responde `401`. Las credenciales mock existen únicamente durante las pruebas automatizadas.

`/superadmin` ofrece **Inicio**, **Usuarios** y **Configuración**. La bandeja de Inicio permite crear manualmente la cuenta de una aerolínea después de la aprobación por Contratos; Usuarios administra cuentas, roles y permisos comerciales de lectura/escritura. Contratos dispone de **Inicio**, **Solicitudes**, **Servicios** y **Borradores** conectados a la API. Inicio resume los listados reales de solicitudes (hasta 200) y borradores (hasta 100); no presenta cifras globales fuera de ese alcance ni descarga todo el catálogo para calcular un KPI. El detalle está en [el flujo comercial](../../docs/workflows/commercial-intake-and-governance.md). Las demás vistas históricas de Contratos que aún usan prototipos siguen separadas.

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

Los resúmenes de Contratos y Finanzas son vistas sintéticas de solo lectura,
señalizadas en la interfaz. No consultan los antiguos endpoints
`/api/notifications` ni `/api/finance/summary`, ausentes del OpenAPI canónico.
El icono de notificaciones de esos dos departamentos permanece oculto hasta
que exista un feed autorizado para sus roles. Los módulos profundos de ambos
departamentos siguen siendo prototipos y no deben interpretarse como consultas
persistentes ni como un circuito completo sin endpoints heredados.

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

Esta entrega es un **preview técnico de Development**. Autenticación, Planificación OCC, monitoreo, mapa de posiciones, revisión, reportes operativos, notificaciones y chat consumen la API versionada donde existe el contrato correspondiente. El Dashboard sigue siendo una vista sintética y se marca como tal; no demuestra disponibilidad, certificación ISO ni conexión FlyAware. Otros adaptadores heredados de Contratos, Finanzas y Gestión Humana todavía no son circuitos canónicos y pueden mostrar errores controlados. La imagen no incluye ni inicia `backend-prototipo`.
