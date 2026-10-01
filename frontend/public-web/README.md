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
autorizadas; inicio, detalle y perfil muestran únicamente esa consulta. Vuelos
consulta además el historial paginado de su tenant
mediante `GET /api/v1/airline/portal/operations`. El detalle de una operación
histórica se relee por su ID público con autorización en la API, aunque ya no
figure en la ventana actual del bootstrap. Esta rama añade
`GET /api/v1/airline/portal/operations/{operationId}/approved-evidence`:
solo devuelve el snapshot de servicios de la última entrega aprobada por OCC,
tiempos reales y el conteo de incidencias de esa entrega. No expone notas,
identidades de agentes ni descripciones internas. Antes de la aprobación
muestra un estado vacío real; una operación de otro tenant responde 404.
La nueva ruta aún no forma parte de la API promovida en Development.
La ruta separada `/dev-airline` fue retirada. Inicio y vuelos ya no montan la
secuencia sintética del prototipo. Contratos consulta versiones aprobadas reales,
incluyendo historial vencido, con cobertura y tarifas de la aerolínea
autenticada. Solicitudes consulta registros
operativos reales, paginados y propios de la aerolínea; crear y cancelar siguen
deshabilitados. Finanzas consulta prefacturas publicadas de su tenant mediante
`GET /api/v1/airline/portal/preinvoices`; excluye borradores internos y abre
líneas, disputas, factura no fiscal y estado del pago manual por ID propio.
Documentos deja atrás el listado de ejemplo: consulta
prefacturas `Invoiced` del tenant, relee factura y pago y descarga PDFs
privados desde la API con la sesión vigente. Un vacío real indica que aún no
hay facturas emitidas en las páginas cargadas; `404`, error recuperable y
revocación no se reemplazan con mocks. Reportes consulta la primera página
autorizada de operaciones y prefacturas publicadas, muestra solo conteos de
registros cargados y enlaza a los historiales paginados; no presenta porcentajes
de puntualidad, cumplimiento ni facturación total sin un contrato agregado.
Las descargas no son comprobantes fiscales
ni acreditan una transferencia bancaria. La release #118 está promovida en
Development; todavía falta aceptar en remoto un ciclo nuevo hasta el recibo.

La sesión del portal revalida identidad y
`bootstrap` al recuperar conexión/foco y cada 25 segundos. También escucha
`ChangedV1` en el hub autorizado: lee `GET /api/v1/changes` con cursor por
cuenta, vuelve a consultar el `bootstrap` cuando aparece
`airline_operations` y relee Finanzas al recibir `airline_preinvoices`.
El socket nunca entrega importes ni líneas del tenant; si falla,
el sondeo HTTP sigue activo. Se conserva la última vista autorizada durante
un fallo transitorio de red, pero `401`, `403` o pérdida del contexto revocan
la sesión visible. La corrección pendiente de esta rama desactiva los logs
internos del transporte SignalR en el navegador, porque un WebSocket autenticado
puede incluir el JWT en la URL registrada a nivel informativo; esto no desactiva
la reconciliación HTTP ni el sondeo de respaldo. Esta corrección no forma parte
de la imagen #118 ya promovida. Falta medir latencia real en navegador y VPS.

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
- `/solicitar-acceso`: solicitud comercial en cuatro pasos; no crea usuario ni acepta contraseña.
- `/login`: sesión real de aerolínea y cambio de contraseña temporal. El acceso heredado a `/login?mode=register` redirige a `/solicitar-acceso`; no existe un alta paralela con contraseña elegida por el solicitante.
- `/portal`: alcance y operaciones actuales del bootstrap autorizado, sin rotaciones ficticias.
- `/portal/vuelos`: historial real paginado de operaciones propias; `/portal/vuelos/[operationId]` relee el detalle propio desde la API sin depender de la ventana del bootstrap.
- `/portal/perfil`: identidad y estaciones de la sesión real.
- `/portal/contratos`: consulta real y paginada de versiones aprobadas; también muestra borradores y envía observaciones a Contratos, sin aceptar ni activar unilateralmente.
- `/portal/solicitudes`: historial operativo real y paginado de la aerolínea; distinto de la solicitud comercial de `/solicitar-acceso`.
- `/portal/finanzas`: consulta real y paginada de prefacturas publicadas, con líneas autorizadas por la API. Una prefactura `Submitted` puede aceptarse tras confirmación explícita; la acción es idempotente y el estado se relee desde la API. Presenta disputas y su decisión, la factura no fiscal emitida y la lectura tenant-scoped de un pago manual registrado por Finanzas. Documentos ofrece el recibo no fiscal de prueba cuando existe ese pago.
- `/portal/documentos`: consulta y descarga autorizada de facturas y recibos no fiscales de prueba; un vacío no se rellena con fixtures.
- `/portal/reportes`: resumen de solo lectura de la primera página de operaciones y prefacturas propias, con estados vacíos/errores y enlaces a los historiales completos; no exporta ni afirma métricas globales.
- `/dev-airline`: retirada; responde 404.

`/portal/finanzas` también permite seleccionar
líneas de una prefactura `Submitted`, escribir el motivo y confirmar una disputa
persistida por `POST /api/v1/airline/portal/preinvoices/{preinvoiceId}/dispute`.
La respuesta se relee desde la API; el mismo intento usa la misma clave si la
red falla. La aerolínea consulta su historial de disputas mediante el endpoint
aditivo `GET /api/v1/airline/portal/preinvoices/{preinvoiceId}/disputes`;
la respuesta v1 del detalle de prefactura no cambia.
Finanzas debe resolver cada disputa antes del cierre. En esta rama la aerolínea
puede releer la decisión y el motivo de Finanzas: una decisión de mantener
devuelve la prefactura a `Submitted` y permite responder otra vez; una anulada
permanece visible como historial de solo lectura, sin aceptar ni disputar.
Una prefactura `Invoiced`
permite releer su factura no fiscal por
`GET /api/v1/airline/portal/preinvoices/{preinvoiceId}/invoice`; el portal
muestra número, fecha, líneas y total emitidos sin inventar saldos. Si Finanzas
registró un pago manual completo, el portal relee importe y referencia por
`GET /api/v1/airline/portal/invoices/{invoiceId}/payment`; si aún no lo hay,
muestra un estado vacío real. No hay verificación bancaria ni documento
tributario. El recibo y la factura disponibles en Documentos son de prueba y
no fiscales; su descarga remota con un ciclo nuevo sigue pendiente de prueba.

## Contrato de seguridad

El navegador nunca decide el tenant confiable. La API obtiene la organización desde la membresía de la cuenta autenticada y aplica el scope de estación en cada consulta. Un `organizationId`, `airlineId` o `stationId` recibido del cliente se valida contra esa sesión; ocultar una opción o separar claves de `localStorage` no autoriza acceso.

Las escrituras previstas se limitan a capacidades expresas, como solicitudes de servicio y respuestas financieras. El portal no modifica vuelos, ejecución histórica, tarifas contractuales o auditoría. Cualquier ampliación requiere permiso de API, historial y pruebas de aislamiento entre tenants.

## Datos de demostración

Las rutas activas de Inicio, Vuelos, Solicitudes, Finanzas, Documentos y Reportes no muestran tarjetas de negocio inventadas. El formulario comercial envía solicitudes a la API de Development y muestra una referencia solo después de confirmar su recepción; no crea una cuenta ni permite elegir contraseña. La sesión de aerolínea conserva únicamente el JWT y su vencimiento en `sessionStorage` de la pestaña; revalida identidad y contexto con la API al recargar, y lo elimina al cerrar sesión, vencer o perder autorización. No existe opción «Recordarme». Tras la promoción de #118, las ocho rutas del portal autenticado se recorrieron en navegador contra el VPS sin 404/405/5xx observados; eso no sustituye la prueba de escritura y descarga de un ciclo nuevo.

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

Esta publicación sigue siendo un **preview privado de Development**, no un portal de Production. La release #118 ya incluye historial de vuelos, solicitudes, prefacturas publicadas, documentos financieros y el resumen acotado de Reportes; la lectura nueva de evidencias aprobadas sigue en esta rama sin promocionar. La imagen no incluye ni contacta `backend-prototipo`, no se conecta a SQL y no contiene secretos. El sitio público de Production necesitará un dominio público real y un plan aprobado por separado.

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

La canalización suministra los argumentos de procedencia, los orígenes HTTPS y el manifiesto inmutable de API. `scripts/validate-development-env.mjs` rechaza valores incompletos, loopback, orígenes distintos para los adaptadores y un deployment ID que no coincida con el commit. `scripts/certify-image.sh` prueba la imagen con rootfs de solo lectura, usuario no-root, health, rutas, headers, deployment ID y ausencia del antiguo fallback local. La certificación interpreta la CSP como directivas cerradas: rechaza nombres duplicados y exige que `connect-src` contenga exactamente `'self'`, el origen HTTPS certificado de la API y su equivalente `wss://` para el hub SignalR, sin hosts adicionales ni comodines de esquema. Antes de construir o publicar, CI también renderiza el Compose real y valida su servicio único, puerto loopback, red externa aislada, usuario, restricciones, recursos y healthcheck.

`ELEVANT_DEPLOYMENT_ID` es la entrada de procedencia controlada por ELEVANT y debe coincidir con `VCS_REF`. No use `NEXT_DEPLOYMENT_ID` para este contrato: ese nombre está reservado por Next.js y puede cambiar durante la evaluación interna del build.
