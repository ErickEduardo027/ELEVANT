# ELEVANT Public Web

Aplicación pública y portal de clientes/aerolíneas de AVIAM. Usa Next.js 16 y React 19. La landing es pública; el portal autenticado debe aislar todas las consultas y escrituras por organización y estaciones autorizadas desde la API.

La implementación principal sigue siendo demostrativa: sesión, documentos,
finanzas y la mayoría de los datos viven en adaptadores mock/locales. La ruta
local `/dev-airline` es una excepción acotada para probar contra la API .NET:
inicia sesión real, muestra el tenant y las estaciones contratadas devueltos
por el servidor, y nunca muestra los fixtures del portal como datos reales.
No representa todavía un portal operativo completo ni una conexión a Production.

## Ejecutar y validar

Desde `frontend/public-web`:

```powershell
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

Para E2E, instale los navegadores de Playwright según su documentación y ejecute `npm run test:e2e`.

Variables públicas actuales:

```text
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_DEMO_FORM_MODE=preview
NEXT_PUBLIC_ELEVANT_API_URL=https://api.development.elevant.test
NEXT_PUBLIC_PROTOTYPE_API_URL=https://api.development.elevant.test
```

`NEXT_PUBLIC_ELEVANT_API_URL` configura el cliente OpenAPI compartido. La variable del prototipo se conserva temporalmente para migrar sus adaptadores gradualmente, pero no tiene fallback: debe configurarse explícitamente. En una imagen de Development ambas variables apuntan exactamente a la API real de Development; los endpoints de negocio que todavía no existen fallan de forma visible y nunca intentan usar `localhost` en el navegador. Sustituya los dominios `.test` por los orígenes asignados a su entorno local. Todo valor `NEXT_PUBLIC_*` queda incorporado al bundle y nunca puede contener secretos. Antes de cambiar código, lea el `AGENTS.md` de esta carpeta y la documentación incluida en la versión instalada de Next.

## Rutas observadas

- `/`: landing, propuesta comercial y solicitud demo.
- `/login`: acceso mock y afiliación local.
- `/dev-airline`: solo en `next dev`; acceso real de aerolínea y lectura del
  bootstrap contractual con `NEXT_PUBLIC_ELEVANT_API_URL`. El token vive solo
  en memoria y se pierde al recargar. En builds de Development/Production la
  ruta devuelve 404. Requiere que el origen local esté permitido por CORS y
  que la API publique `GET /api/v1/airline/portal/bootstrap`.
- `/portal`: resumen y actividad autorizada.
- `/portal/vuelos` y `/portal/vuelos/[operationId]`: búsqueda y detalle de turnarounds.
- `/portal/solicitudes`: solicitudes de servicio.
- `/portal/contratos`: vigencia, estaciones y tarifarios.
- `/portal/documentos`: documentos/evidencias autorizados.
- `/portal/finanzas`: prefacturas, facturas, conciliaciones y disputas.
- `/portal/reportes`: indicadores y exportaciones.
- `/portal/perfil`: organización, estaciones, permisos y auditoría.

## Contrato de seguridad

El navegador nunca decide el tenant confiable. La API obtiene la organización desde la membresía de la cuenta autenticada y aplica el scope de estación en cada consulta. Un `organizationId`, `airlineId` o `stationId` recibido del cliente se valida contra esa sesión; ocultar una opción o separar claves de `localStorage` no autoriza acceso.

Las escrituras previstas se limitan a capacidades expresas, como solicitudes de servicio y respuestas financieras. El portal no modifica vuelos, ejecución histórica, tarifas contractuales o auditoría. Cualquier ampliación requiere permiso de API, historial y pruebas de aislamiento entre tenants.

## Datos de demostración

La interfaz ofrece una identidad `.test` solo para UX. Es material sintético, no una cuenta de Production. El formulario comercial permanece en modo preview y no transmite solicitudes mientras no exista su contrato de backend.

## Criterio de promoción en Development

Una candidata de Public Web solo puede promoverse cuando CI certifica de forma conjunta:

- una imagen y un manifiesto OCI identificados por digest inmutable;
- el commit y el workflow de origen en la rama `Development`;
- el manifiesto de API requerido y el hash OpenAPI exacto;
- el Compose revisado, con puerto loopback y una única red de runtime;
- el healthcheck y las rutas de smoke test `/`, `/login` y `/health`.

Un tag mutable o un redeploy manual no constituye una identidad de release. El controlador adopta una baseline revisada y después solo acepta ejecuciones certificadas más recientes; ante un fallo conserva la última versión saludable para rollback.

## Despliegue previsto

Development usa una imagen Node no-root con salida Next `standalone`, construida y certificada en CI y desplegada aparte de AVIAM Web y API. El artefacto incorpora un `deploymentId` igual al commit, referencia una API certificada exacta y expone `/health` sin consultar la API ni SQL Server. El Compose revisado publica `127.0.0.1:18082` y conecta únicamente la red externa `elevant-dev-public-web-runtime`; Tailscale Serve es el único proxy HTTPS previsto y Funnel debe permanecer desactivado.

Esta primera publicación es un **preview privado de Development**, no un portal operacional: autenticación, tenant scope y operaciones de negocio siguen en adaptadores demostrativos hasta que existan sus contratos OpenAPI. La imagen no incluye ni contacta `backend-prototipo`, no se conecta a SQL y no contiene secretos. El sitio público de Production necesitará un dominio público real y un plan aprobado por separado.

El Dockerfile se construye desde la raíz del monorepo porque consume `packages/api-client`:

```bash
commit=0000000000000000000000000000000000000000
digest=0000000000000000000000000000000000000000000000000000000000000000
docker build \
  --file frontend/public-web/Dockerfile \
  --build-arg "VCS_REF=$commit" \
  --build-arg "ELEVANT_DEPLOYMENT_ID=$commit" \
  --build-arg OCI_CREATED=2026-01-01T00:00:00Z \
  --build-arg OCI_SOURCE=https://github.com/example/ELEVANT \
  --build-arg "REQUIRED_API_MANIFEST=ghcr.io/example/elevant-api-release-manifest@sha256:$digest" \
  --build-arg "OPENAPI_SHA256=sha256:$digest" \
  --build-arg SOURCE_RUN_ID=1 \
  --build-arg NEXT_PUBLIC_SITE_URL=https://public.elevant.test \
  --build-arg NEXT_PUBLIC_ELEVANT_API_URL=https://api.elevant.test \
  --build-arg NEXT_PUBLIC_PROTOTYPE_API_URL=https://api.elevant.test \
  --build-arg NEXT_PUBLIC_DEMO_FORM_MODE=preview \
  --tag elevant-public-web:local .
```

La canalización suministra los argumentos de procedencia, los orígenes HTTPS y el manifiesto inmutable de API. `scripts/validate-development-env.mjs` rechaza valores incompletos, loopback, orígenes distintos para los adaptadores y un deployment ID que no coincida con el commit. `scripts/certify-image.sh` prueba la imagen con rootfs de solo lectura, usuario no-root, health, rutas, headers, deployment ID y ausencia del antiguo fallback local. La certificación interpreta la CSP como directivas cerradas: rechaza nombres duplicados y exige que `connect-src` contenga exactamente `'self'` y el origen certificado de la API, sin esquemas ni hosts adicionales. Antes de construir o publicar, CI también renderiza el Compose real y valida su servicio único, puerto loopback, red externa aislada, usuario, restricciones, recursos y healthcheck.

`ELEVANT_DEPLOYMENT_ID` es la entrada de procedencia controlada por ELEVANT y debe coincidir con `VCS_REF`. No use `NEXT_DEPLOYMENT_ID` para este contrato: ese nombre está reservado por Next.js y puede cambiar durante la evaluación interna del build.
