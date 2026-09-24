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

Vite sirve localmente en `http://localhost:5173`. Las entradas históricas `dashboard.html`, `contracts.html` y `finance.html` se conservan junto con las rutas del router.

Las tres variables `VITE_*` son públicas y nunca deben contener tokens, contraseñas ni cadenas SQL. El build falla si falta un origen, si no usa HTTPS, si apunta a localhost, si contiene una ruta, si los dos orígenes no coinciden o si `VITE_HR_DEMO_MODE` no vale exactamente `dashboard-read-only`. `VITE_ELEVANT_API_URL` configura el cliente OpenAPI compartido y `VITE_PROTOTYPE_API_URL` mantiene temporalmente los adaptadores anteriores apuntando a la misma API real de Development. El modo de Gestión Humana conserva la autenticación real, pero limita ese módulo a un dashboard de datos sintéticos y solo lectura: no llama endpoints `/api/hr`, no expone rutas profundas ni ofrece acciones de escritura o exportación.

El formulario de acceso usa `POST /api/v1/auth/session` mediante el cliente OpenAPI compartido. Solo acepta roles conocidos del portal `back_office`, conserva el Bearer de corta duración en el almacenamiento elegido por el usuario y elimina la sesión al vencer o cuando la API responde `401`. Las credenciales mock existen únicamente durante las pruebas automatizadas.

## Planificación OCC remota

La ruta `/admin-occ/planning` es el primer módulo de negocio conectado de extremo a extremo con la API de Development. Consume exclusivamente el cliente compartido para consultar:

- `GET /api/v1/occ/planning`, con estación tomada de los scopes de la sesión y fecha operativa controlada por el usuario;
- `GET /api/v1/occ/planning/options?turnaroundId={turnaroundId}`, al abrir el detalle de una escala autorizada;
- `POST /api/v1/occ/planning/turnarounds/{turnaroundId}/assignment`, para confirmar la asignación inicial de un único agente elegible con el `ETag` fuerte devuelto por la consulta de opciones.

La pantalla representa una escala completa, conserva sus tramos de llegada y salida y muestra solo los recursos devueltos por el servidor. El manifiesto de despacho permite escoger exclusivamente un agente marcado como elegible; contrato, posición y servicios son decisiones del backend y se muestran como datos bloqueados. La web no reintenta automáticamente el comando. Un `409`, `412`, `404` o resultado de red ambiguo obliga a refrescar opciones y planificación antes de una nueva confirmación.

El módulo incluye estados de carga, vacío, error recuperable, sesión expirada, permiso denegado y ausencia de scopes. Un `403` no se presenta como fallo de conexión ni ofrece reintentos infinitos. Crear vuelos, editar la planificación y generar Work Orders permanecen deshabilitados hasta que existan contratos OpenAPI de escritura revisados. Los fixtures del módulo se usan solo en pruebas.

## Frontera de seguridad

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

Esta entrega es un **preview técnico de Development**. La creación de sesión y la lectura de Planificación OCC usan la API real; los demás adaptadores de negocio heredados obtendrán errores controlados hasta que existan sus endpoints versionados. La imagen no incluye ni inicia `backend-prototipo`.
