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
npm run dev
npm run build
```

Vite sirve localmente en `http://localhost:5173`. Las entradas históricas `dashboard.html`, `contracts.html` y `finance.html` se conservan junto con las rutas del router.

Ambas variables `VITE_*` son públicas. El build falla si falta alguna, si no usa HTTPS, si apunta a localhost, si contiene una ruta o si no representan el mismo origen. `VITE_ELEVANT_API_URL` configura el cliente OpenAPI compartido. `VITE_PROTOTYPE_API_URL` mantiene temporalmente los adaptadores anteriores, pero en una imagen certificada también apunta a la API real de Development. Nunca use tokens, contraseñas ni cadenas SQL en variables `VITE_*`.

## Frontera de seguridad

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

Esta entrega es un **preview técnico de Development**. La API real solo tiene por ahora el contrato inicial del sistema; los adaptadores de negocio heredados obtendrán errores controlados hasta que existan sus endpoints versionados. La imagen no incluye ni inicia `backend-prototipo`.
