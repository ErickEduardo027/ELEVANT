# ADR-0012: CD pull-based para las webs Development

## Estado

Accepted — 2026-09-05. Define la entrega de AVIAM Web y Public Web en
Development. La instalación inicial y el rollout del VPS siguen siendo
checkpoints manuales posteriores; este ADR no declara que las webs ya estén
desplegadas. Production y Mobile Agent quedan fuera de alcance.

## Contexto

Database CD y API CD ya establecen una cadena privada de artefactos certificados
para `Development`. Las dos aplicaciones web tienen runtimes y ciclos distintos:
`frontend/private-web` produce un sitio Vite servido por Nginx y
`frontend/public-web` produce un servidor Next.js `standalone`. Ambas consumen
la misma API; ninguna debe entrar a la red SQL.

El AutoDeploy del provider GitHub de Dokploy no conserva esta cadena de
custodia. Recibiría un webhook, reconstruiría en el VPS y omitiría el gate que
demuestra qué API/OpenAPI se usó al construir el cliente. Tampoco proporciona
por sí solo promoción por digest, rollback del par imagen/Compose ni el
aislamiento requerido entre ambas webs. El VPS y Dokploy permanecen privados y
no reciben conexiones iniciadas por GitHub Actions.

La API real todavía expone el scaffold técnico, no todos los endpoints de
autenticación y negocio que usan los prototipos. Publicar una interfaz no debe
ocultar esa limitación ni justificar desplegar `backend-prototipo`.

## Decisión

- GitHub Actions valida, construye y certifica cada web fuera del VPS. Una
  entrega relevante de `Development` produce dos carriles independientes:
  `aviam-web` y `public-web`.
- Cada carril publica su propia imagen por digest y un bundle OCI v1 separado
  con manifiesto cerrado y los bytes exactos de su Compose:
  `elevant-aviam-web-release-manifest` y
  `elevant-public-web-release-manifest`. El alias `development-certified` se
  mueve al final y sirve únicamente para descubrimiento.
- Los orígenes públicos de build proceden de variables de repositorio, no de
  secretos ni de nombres vivos escritos en plantillas:
  `ELEVANT_DEV_API_ORIGIN`, `ELEVANT_DEV_AVIAM_WEB_ORIGIN` y
  `ELEVANT_DEV_PUBLIC_WEB_ORIGIN`. CI rechaza valores inseguros, localhost en un
  build Development y barras finales ambiguas.
- El manifiesto fija la imagen web, hash del Compose, fingerprint de
  configuración y la entrega API exacta usada para certificarla: digest del
  bundle API, `runId`, imagen API y hash canónico de OpenAPI.
- Un único paquete `ops/dokploy/web-cd` implementa dos perfiles. Cada perfil
  tiene configuración, estado, historial, cache Compose, log y pausa separados;
  un lock web común impide recrear ambas webs a la vez.
- El controlador valida la identidad OCI, el manifiesto, los hashes, la
  equivalencia semántica con el Raw vivo y la entrega API exacta antes de
  desplegar. Un candidato cuya API aún no esté activa se difiere sin mutar el
  runtime ni consumir el intento.
- La jerarquía de locks es `database -> API -> web común -> perfil web`. Las
  ventanas normales se escalonan dentro del minuto: Database `:00`, API `:15`,
  AVIAM Web `:30` y Public Web `:45`; los locks, no los retrasos, son la
  exclusión autoritativa.
- Dokploy conserva dos recursos Docker Compose / Raw independientes, sin
  AutoDeploy ni Domain. AVIAM Web publica solo
  `127.0.0.1:18081:8080`; Public Web solo
  `127.0.0.1:18082:3000`. Cada una usa su propia red runtime y ninguna se conecta
  a `elevant-dev-data`.
- Tailscale Serve expone únicamente los Services privados ya reservados
  `svc:elevant-dev-aviam-web` y `svc:elevant-dev-public-web`. Funnel permanece
  desactivado.
- El primer despliegue, la instalación del controlador, la adopción de la
  baseline y la habilitación de los dos schedules son acciones manuales del
  operador, con evidencia sanitizada y una web a la vez.
- Una promoción fallida restaura el último par imagen/Compose certificado y
  repite health/smoke. Un rollback fallido pausa solo el perfil afectado. El
  controlador nunca ejecuta `docker compose down`, elimina redes o toca SQL.
- Mobile Agent se prueba en emulador/tablet y se distribuye como APK/EAS por su
  propio canal; no se instala como servicio del VPS.

## Consecuencias

- Un merge web relevante a `Development` puede llegar automáticamente al VPS
  solo después del rollout manual del controlador y de todos los gates. GitHub
  no necesita alcanzar el host y el KVM no compila Node, Vite ni Next.js.
- AVIAM Web y Public Web pueden avanzar o retroceder independientemente sin
  recrear API, SQL ni la otra web.
- La dependencia exacta de API prioriza reproducibilidad. Si API avanza, un
  bundle web certificado contra una entrega anterior se difiere hasta que una
  nueva ejecución lo certifique contra la API activa; el controlador no adivina
  compatibilidad.
- Los valores `VITE_*` y `NEXT_PUBLIC_*` quedan horneados en la imagen y son
  públicos. Los secretos continúan exclusivamente en los runtimes que los
  necesitan; una web nunca recibe credenciales SQL.
- Tras el rollout, ambas aplicaciones seguirán siendo previews técnicos de
  Development mientras falten endpoints reales de autenticación/negocio. Las
  rutas todavía conectadas al contrato prototipo deben fallar de forma visible
  contra la API real; no pueden apuntar al localhost del navegador ni a un
  backend prototipo en el VPS.

Guías operativas:
[`docs/deployment/dokploy.md`](../deployment/dokploy.md),
[`docs/workflows/web-workflow.md`](../workflows/web-workflow.md) y
[`ops/dokploy/web-cd/README.md`](../../ops/dokploy/web-cd/README.md).
