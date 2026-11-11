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
autorizadas; inicio, detalle y perfil muestran únicamente esa consulta. El
layout activo solo monta `AirlineSessionProvider`; el proveedor de sesión mock
permanece en componentes prototípicos no montados y no concede acceso al portal.
La tarjeta del login describe la verificación pendiente sin mostrar rutas ni
estados autenticados ficticios. El login, `/activar` y `/recuperar` no nombran
ningún entorno: solo muestran una etiqueta si el build define
`NEXT_PUBLIC_ELEVANT_ENVIRONMENT_LABEL` (por ejemplo «Pruebas»), que es
configuración pública de build, nunca un secreto. El código de acceso y los
enlaces quedan en la cola de correo de la API; la pantalla nunca afirma que ya
se enviaron. Vuelos
consulta además el historial paginado de su tenant
mediante `GET /api/v1/airline/portal/operations`. El detalle de una operación
histórica se relee por su ID público con autorización en la API, aunque ya no
figure en la ventana actual del bootstrap. Esta rama añade
`GET /api/v1/airline/portal/operations/{operationId}/approved-evidence`:
solo devuelve el snapshot de servicios de la última entrega aprobada por OCC,
tiempos reales y el conteo de incidencias de esa entrega. No expone notas,
identidades de agentes ni descripciones internas. Antes de la aprobación
muestra un estado vacío real; una operación de otro tenant responde 404.
Si esa lectura falla temporalmente, el vuelo autorizado permanece visible y
la evidencia ofrece su propio reintento. La aprobación de OCC, el inicio y el
fin reales y las firmas de la Orden de Servicio se muestran en la hora local de
la estación con su sufijo «(hora local PUJ)», como el PDF firmado
(`formatLocalDateTime` de `src/lib/business-day.ts`); la API sigue enviando UTC.
La nueva ruta aún no forma parte de la API promovida en Development.
La ruta separada `/dev-airline` fue retirada. Inicio y vuelos ya no montan la
secuencia sintética del prototipo. Contratos consulta versiones aprobadas reales,
incluyendo historial vencido, con cobertura y tarifas de la aerolínea
autenticada. Solicitudes consulta registros
operativos reales, paginados y propios de la aerolínea; crear y cancelar siguen
deshabilitados. Finanzas lista las facturas e-CF simuladas del tenant desde su
estado de cuenta (`/api/v1/airline/portal/treasury`), con e-NCF, estado y saldo,
y abre cada una por su ID: líneas, movimientos, notas de ajuste, PDF y pago con
tarjeta. Desde la fase 4 (ADR-0035, bloque 3) la aerolínea ya no consulta,
acepta ni disputa prefacturas: la prefactura es un paso interno de la emisión y
sus rutas del portal se retiraron (404). Documentos descarga las facturas y los
recibos privados desde la API con la sesión vigente. Un vacío real indica que aún
no hay facturas emitidas; `404`, error recuperable y revocación no se reemplazan
con mocks. Reportes consulta la primera página autorizada de operaciones y el
estado de cuenta, muestra solo conteos de registros cargados y enlaza a los
historiales paginados; no presenta porcentajes de puntualidad, cumplimiento ni
facturación total sin un contrato agregado.
Las descargas no son comprobantes fiscales
ni acreditan una transferencia bancaria. La release #118 está promovida en
Development; todavía falta aceptar en remoto un ciclo nuevo hasta el recibo.

La sesión del portal revalida identidad y
`bootstrap` al recuperar conexión/foco y cada 25 segundos. También escucha
`ChangedV1` en el hub autorizado: lee `GET /api/v1/changes` con cursor por
cuenta, vuelve a consultar el `bootstrap` cuando aparece
`airline_operations` y relee Finanzas al recibir `airline_preinvoices` (la emisión todavía anuncia
así sus facturas) o `airline_treasury`.
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

`npm run test:e2e:stack` recorre el portal contra el stack local real: API en `127.0.0.1:8080` (el puerto que publica `compose.local.yml`; otro puerto con `E2E_STACK_API`), SQL Server y Mailpit en `127.0.0.1:8025`. Cubre la recuperación de contraseña por correo, la nueva contraseña y el inicio de sesión con el código de 6 dígitos, y lee los correos desde la API de Mailpit. Requisitos:
- Levantar antes el stack con `compose.local.yml`.
- Usar la cuenta sembrada `airline.client@dev.elevant.test`, a la que la prueba cambia la contraseña.

El navegador usa el nombre HTTPS `api.stack.elevant.test`, que exige la CSP, y la prueba lo reenvía a la API local. No corre en CI: sin el stack, la prueba se omite.

`npm run test:e2e:cycle` recorre el ciclo operativo completo (ADR-0037) con cuatro proyectos encadenados, uno por fase: comercial, pre-operación, operación y facturación. Levanta public-web en `localhost:4174` y private-web en `localhost:4175` y crea en cada corrida su propia aerolínea sintética. Necesita el stack con el overlay `compose.local.e2e.yml` (almacenamiento S3 con Garage, CORS de los puertos del arnés, límites de uso altos y el feed de vuelos simulado, que nunca llama a AeroDataBox) y `E2E_CYCLE_ENV_FILE` apuntando al `.env` del stack; las credenciales se leen de ahí y nunca se imprimen. El estado de la corrida y las capturas quedan fuera del repositorio, en la carpeta temporal del sistema (`elevant-e2e-cycle`). Con `E2E_CYCLE_HEADED=1` el recorrido se ve en Chrome, y con `--project faseN --no-deps` se reanuda una fase sobre la corrida en curso. Los huecos aún abiertos figuran como `test.fixme("hueco …")`.

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
- `/portal/perfil`: identidad y estaciones de la sesión real, y «Usuarios del portal» (fase 2, bloque E): todos los usuarios de la aerolínea ven quién tiene acceso y quién firma; un representante (la cuenta aprovisionada o quien designe AVIAM) invita por correo, desactiva, reactiva y marca firmantes, nunca a sí mismo ni a otro representante. Cada comando lleva su `Idempotency-Key` y la versión en pantalla; la invitación y el aviso a los demás representantes solo quedan en cola. Solo los representantes y los firmantes firman contratos y envían permisos (`signer_required`); a los demás usuarios el portal se lo explica en lugar del formulario.
- `/portal/contratos`: consulta real y paginada de versiones aprobadas; también muestra borradores y envía observaciones a Contratos, sin aceptar ni activar unilateralmente.
- `/portal/solicitudes`: historial operativo real y paginado de la aerolínea; distinto de la solicitud comercial de `/solicitar-acceso`.
- `/portal/finanzas`: facturas e-CF simuladas del tenant con su e-NCF, saldo, detalle, PDF y pago con tarjeta por el saldo completo; sin prefacturas que aceptar ni disputar (fase 4). Las correcciones son notas de ajuste que emite Finanzas.
- `/portal/documentos`: consulta y descarga autorizada de facturas y recibos no fiscales de prueba; un vacío no se rellena con fixtures.
- `/portal/reportes`: resumen de solo lectura de la primera página de operaciones propias y del estado de cuenta, con estados vacíos/errores y enlaces a los historiales completos; no exporta ni afirma métricas globales.
- `/dev-airline`: retirada; responde 404.

Las facturas emitidas antes de ADR-0035 conservan su lectura histórica: si
Finanzas registró un pago manual, el portal relee importe y referencia por
`GET /api/v1/airline/portal/invoices/{invoiceId}/payment`. No hay verificación
bancaria ni documento tributario: toda e-CF es una simulación sin validez fiscal.
Las revisiones financieras en tiempo real mantienen abierta la selección de
Documentos mientras se releen los IDs
autorizados, incluso si el registro seleccionado venía de una página
posterior a la primera. Un error de relectura no conserva el documento
anterior como si fuera vigente.

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

En el formulario comercial de esta rama, la aprobación de una clausura por Contratos retira el servicio de la siguiente lectura del catálogo. Si ya estaba seleccionado, la pantalla identifica cuál salió, vuelve al primer paso y pide confirmar los servicios otra vez. Conserva la aerolínea y los datos del representante; la API vuelve a validar la visibilidad al recibir la solicitud. Si se perdió la respuesta de un envío anterior, consulta el comprobante con el UUID y cuerpo originales mediante una operación de solo lectura. Si el envío nunca se guardó, pide revisar y confirmar de nuevo sin crear otra solicitud automáticamente. [Flujo comercial](../../docs/workflows/commercial-intake-and-governance.md#clausura-comercial-solicitada-por-occ-rama-de-implementación).
