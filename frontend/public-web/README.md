# ELEVANT Public Web

El login ofrece el enlace «¿No tienes credenciales? Solicita acceso aquí»;
la solicitud permanece en `/solicitar-acceso`. Las fotos de servicios y los
logos del catálogo se sirven como recursos locales o por la API cuando fueron
subidos por el equipo autorizado. Las fichas históricas sin logo oficial
verificable usan una placa rotulada como referencia, nunca una marca simulada.

Aplicación pública y portal de clientes/aerolíneas de AVIAM. Usa Next.js 16 y React 19. La landing es pública; el portal autenticado debe aislar todas las consultas y escrituras por organización y estaciones autorizadas desde la API.

El botón naranja **Solicitar acceso** abre `/solicitar-acceso` en cuatro pasos: servicios en carrusel, aerolínea predefinida con ficha de solo lectura, datos del representante y confirmación final con resumen editable. Nacionalidad, dirección, país/provincia/municipio y documento son opcionales; el par tipo/número de documento debe completarse junto cuando se usa. El catálogo y la solicitud usan la API real; una caída temporal al releer el catálogo conserva el formulario y muestra un reintento, mientras la API valida otra vez la visibilidad al enviarlo. Contratos revisa antes de que el superadministrador cree credenciales. El portal de contratos muestra propuestas en borrador y permite enviar observaciones; una tarifa no confirmada aparece **por definir**, aunque su valor inicial sea cero. Consulte [el flujo comercial](../../docs/workflows/commercial-intake-and-governance.md).

`/login` y `/portal` usan la sesión real de la API de Development. La API
determina la aerolínea y devuelve las estaciones y operaciones actuales
autorizadas; inicio, vuelos, detalle y perfil separan esa respuesta de las
muestras visuales. La ruta separada `/dev-airline` fue retirada. Inicio y vuelos
conservan una secuencia sintética del prototipo en una sección señalizada, sin
enlaces a detalles inventados. Contratos consulta versiones aprobadas reales,
incluyendo historial vencido, con cobertura y tarifas de la aerolínea
autenticada. Solicitudes, documentos, finanzas y reportes conservan una vista visual de demostración claramente
marcada: sus cifras y registros son sintéticos y sus acciones están deshabilitadas.
No representan datos de la cuenta ni un portal operativo completo de Production.

En la rama de integración, la sesión del portal revalida identidad y
`bootstrap` al recuperar conexión/foco y cada 25 segundos. También escucha
`ChangedV1` en el hub autorizado: lee `GET /api/v1/changes` con cursor por
cuenta y vuelve a consultar el `bootstrap` cuando aparece
`airline_operations`. El socket nunca entrega datos del tenant; si falla,
el sondeo HTTP sigue activo. Se conserva la última vista autorizada durante
un fallo transitorio de red, pero `401`, `403` o pérdida del contexto revocan
la sesión visible. Falta medir latencia real en navegador y VPS.

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

- `/`: landing y acceso al flujo comercial real.
- `/solicitar-acceso`: solicitud comercial en tres pasos; no crea usuario ni acepta contraseña.
- `/login`: sesión real de aerolínea y cambio de contraseña temporal. El acceso heredado a `/login?mode=register` redirige a `/solicitar-acceso`; no existe un alta paralela con contraseña elegida por el solicitante.
- `/portal`: alcance y operaciones actuales del bootstrap autorizado, separados de una secuencia visual sintética.
- `/portal/vuelos`: lista real de la ventana actual y una tabla de ejemplo filtrable, señalizada y no navegable. `/portal/vuelos/[operationId]` solo muestra detalles de una operación real devuelta por la API.
- `/portal/perfil`: identidad y estaciones de la sesión real.
- `/portal/contratos`: consulta real y paginada de versiones aprobadas; también muestra borradores y envía observaciones a Contratos, sin aceptar ni activar unilateralmente.
- `/portal/solicitudes`, `/portal/documentos`, `/portal/finanzas` y `/portal/reportes`: vistas sintéticas de solo lectura, sin consultas de negocio ni acciones reales.
- `/dev-airline`: retirada; responde 404.

## Contrato de seguridad

El navegador nunca decide el tenant confiable. La API obtiene la organización desde la membresía de la cuenta autenticada y aplica el scope de estación en cada consulta. Un `organizationId`, `airlineId` o `stationId` recibido del cliente se valida contra esa sesión; ocultar una opción o separar claves de `localStorage` no autoriza acceso.

Las escrituras previstas se limitan a capacidades expresas, como solicitudes de servicio y respuestas financieras. El portal no modifica vuelos, ejecución histórica, tarifas contractuales o auditoría. Cualquier ampliación requiere permiso de API, historial y pruebas de aislamiento entre tenants.

## Datos de demostración

Las tarjetas de ejemplo están etiquetadas como datos de demostración y no pertenecen al tenant autenticado. El formulario comercial envía solicitudes a la API de Development y muestra una referencia solo después de confirmar su recepción; no crea una cuenta ni permite elegir contraseña. La sesión de aerolínea conserva únicamente el JWT y su vencimiento en `sessionStorage` de la pestaña; revalida identidad y contexto con la API al recargar, y lo elimina al cerrar sesión, vencer o perder autorización. No existe opción «Recordarme».

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

Esta publicación sigue siendo un **preview privado de Development**, no un portal operacional: autenticación, tenant y operaciones actuales usan el contrato OpenAPI; los demás módulos aún son presentaciones sintéticas sin acciones. La imagen no incluye ni contacta `backend-prototipo`, no se conecta a SQL y no contiene secretos. El sitio público de Production necesitará un dominio público real y un plan aprobado por separado.

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
