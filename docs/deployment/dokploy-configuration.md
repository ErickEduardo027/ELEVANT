# Configuración de Dokploy

## Cambio pendiente: medios comerciales privados

La carga de fotos, videos y avatares del flujo comercial requiere un almacén S3
privado adicional. El contrato revisable, el orden de instalación, el backup del
par de volúmenes y la prueba de restauración están en
[`ops/dokploy/media-storage`](../../ops/dokploy/media-storage/README.md).
Este bloque describe una **preparación pendiente** y no afirma que Garage esté
instalado o que los nuevos endpoints estén promocionados en el VPS.

Antes de aceptar un bundle API que contenga `MediaStorage`, el operador prepara
Garage, el bucket y la clave de alcance limitado, guarda las cinco variables
`ELEVANT_MEDIA_*` en el Environment privado de API y actualiza el Raw API con
las referencias exactas de `backend/compose.development.api.yml`. Después
verifica Preview Compose y la igualdad semántica exigida por API CD. No se
exponen puertos S3 ni credenciales al navegador. Los medios publicados se leen
mediante `/api/v1/media/{id}` y los avatares requieren autorización.

El orden de promoción continúa siendo Database Release → API → AVIAM Web y
Public Web. No se habilita el poll API para este cambio hasta que el
almacenamiento, el backup y una restauración de prueba estén verificados.

Esta guía registra cómo se convirtió el VPS Development en un plano de control
privado, cómo se desplegaron DB v1, la API y las dos webs, y cómo se habilitaron
sus carriles CD pull-based. También define los runbooks de reconstrucción y el
handoff del acceso SSMS humano a datos sintéticos; versionar
artefactos por sí solo no autoriza instalarlos. El operador realiza todos los
cambios remotos manualmente. El agente entrega un bloque corto, identifica si
corresponde a PowerShell, hPanel, VPS o Dokploy y valida la evidencia antes de
avanzar.

## Estado aprobado

- DB v1 inicial: commit `1281bd139709898f220c90f12ff27036a6a83b93` de `Development`.
- Base de hardening del control plane: `86555b61b0ff17b4a42f5e51fe2055000e90664f`.
- Controlador Database CD instalado y actualizado: merge
  `d9a03877a83d12fe02bceda3fe947c15ea8befd7`.
- Entrega DB automática aceptada: commit fuente
  `1ed89a7a0f120c9eba8645ab070de4118cfa7c3c`, run
  `34694288399` y bundle
  `sha256:bb667f503ab0e7576bee565786adea130be1a48c8eda87728682d83c3307cfe2`.
- Imágenes DB aceptadas: ops
  `sha256:1c07b1f12938e7a8a86f7f429632201c56148e584a10e718a996015d4e04f129`
  y release
  `sha256:f8671425e656bd8abca1eeabab3541cc6f18f3ed0cf9aafc1d03baa81da23f40`.
- Entrega API automática aceptada para el mismo commit/run: imagen
  `sha256:ae517c037a99f12dcf283b94ee9a880cab138965cef2853ffede406d96d00789`
  y bundle
  `sha256:ca95c61c234af01c166d9a3b3ac4f43175fc48aec3118b692bd1a3f404f2796e`.
- Compose aceptados: database
  `9b4319896a1d0b25caa6119122e2842fa6f0313ac8fdcbfa90598903cfc10b21`
  y release
  `bd8fbded7339f87c71bb7e4058427581f58417602b8e37ebd0e90a0d1e79fd07`.
- Dokploy: mantener `v0.30.0` o una revisión posterior expresamente auditada.
- Traefik objetivo: `traefik:v3.6.25@sha256:31267173a15b4944e797a76ffd9c419707c8d8b32fe5b610f80cd0cfa05f372d`.
- SQL: Development sintético únicamente; Production no se crea en este VPS.
- Landing existente: se preserva, se deshabilita su Domain y se detiene; no se elimina.
- Acceso: operaciones administra el host/panel; los desarrolladores acceden
  únicamente a los Services de aplicación aceptados. API, AVIAM Web y Public
  Web están activos por Tailscale con sus carriles CD habilitados; los miembros
  autorizados de `group:elevant-db-editors` acceden además a SQL Tools.
- Evidencia 2026-08-23: SQL healthy/privado, cinco migraciones, seed
  idempotente, permisos mínimos, backup + restore-check y schedules validados.
- Evidencia 2026-08-31 UTC: adopción, primera promoción, backup, restore-check,
  poll periódico, estado `succeeded/complete` y persistencia tras reboot
  validados. Instalar una revisión futura continúa siendo una operación manual;
  versionarla no autoriza modificar el host.
- Evidencia 2026-09-05 UTC: API por digest, API-CD `succeeded/complete`, health,
  readiness, ping, Swagger, CORS exacto, poll no-op y recuperación tras reboot
  validados. El acceso continúa exclusivamente por Tailscale.
- Evidencia 2026-09-07 UTC: AVIAM Web y Public Web quedaron healthy por
  Tailscale; ambos drills B -> A -> B, sus rollbacks, repromociones, estados
  terminales, polls no-op y schedules automáticos fueron aceptados.
- Evidencia 2026-09-10 UTC: DB/API se promovieron al commit fuente
  `a60b5346ffa903e7bd98e4d19dc24c47a2e2afeb`; los cuatro workloads, los
  controladores y los seis schedules sobrevivieron el reboot final. La DB se
  promovió después a
  `45e1e0267b5a7ba443da8299d1000cb43cb412b6` para preparar identidades y
  diagramas.
- Evidencia 2026-09-12 UTC: el gateway SQL Tools del merge
  `1dae9ab422f003cf01dc16c6e9ccf38e5c6f94e2` quedó healthy con HAProxy
  `sha256:6343ce34a132a5dceaa24767d739df2bd519f8f7c1079ae39e4821334e8eb42e`,
  listener loopback, dos redes exactas y el Service TCP privado como única
  entrada. Las tres cuentas personales y sus permisos mínimos, el soporte
  controlado de diagramas, los límites negativos de red y una conexión SSMS real
  pasaron.
- Evidencia 2026-09-12 UTC: el merge
  `1ed89a7a0f120c9eba8645ab070de4118cfa7c3c` incorporó el gate OpenAPI al job
  que bloquea la publicación API. DB se promovió antes que API; ambos quedaron
  `succeeded/complete` y sus polls posteriores fueron *no-op*. Tras el reboot de
  aceptación, los cinco workloads conservaron identidad y health sin
  recreaciones; los cuatro controladores persistieron y se reanudaron, los seis
  schedules se rehabilitaron en orden y el firewall final quedó aceptado. La
  primera ventana temporizada venció durante la recopilación de evidencia y el
  rollback actuó; desde el Browser Terminal se armó una ventana nueva, se
  reaplicó la fase final y se repitieron los gates antes de cancelarla.
- Alertas externas, heartbeats por carril, commit statuses y protección de ramas
  están diferidos en el
  [backlog de hardening](development-hardening-backlog.md). Mientras no se
  configuren, el operador revisa diariamente Beszel, Schedules y
  `controller.log`; no se debe afirmar que existe notificación automática ni
  gobernanza técnica de ramas.

No continúe si aparece una identidad, servicio, integración o volumen no reconocido.

## Checkpoints obligatorios

### A. Recuperación e inventario

1. Registrar versiones, listeners, redes, volúmenes y hashes sin volcar variables ni archivos sensibles.
2. Apagar limpiamente el VPS desde hPanel.
3. Crear el único snapshot frío de Hostinger y esperar su finalización.
4. Encender y exigir Dokploy/Postgres `1/1`, Traefik running y landing `1/1`.
5. Crear y activar el perfil Hostinger `elevant-dev-bootstrap`: ICMP y UDP `41641` desde cualquier origen; TCP `22` y `3000` solo desde las direcciones `/32`/`/128` actuales del operador; TCP `80` desde cualquier origen. Esperar dos minutos y probar conexiones nuevas.
6. Confirmar que el operador conserva SSH/panel, la landing conserva HTTP y otra red no alcanza `22`, `3000`, Docker API ni Swarm. Un fallo se recupera desactivando el perfil desde hPanel, no agregando `Allow all`.

El snapshot es rollback destructivo de último recurso y no sustituye un backup lógico. Tras estabilizar el hardening se reemplaza por un snapshot nuevo; restaurar el antiguo reintroduciría las credenciales temporales.

### B. Identidad administrativa y Tailscale

1. Crear `elevant-ops` con clave Ed25519 dedicada y passphrase.
2. Conceder `sudo` explícito con contraseña, sin añadir el usuario al grupo Docker.
3. Crear una tailnet nueva y aplicar la plantilla de `ops/dokploy/tailscale`.
4. Enrolar el VPS con una auth key one-off, tagged, no reusable y no ephemeral.
5. Publicar `svc:elevant-dev-dokploy` por HTTPS hacia `127.0.0.1:3000`.
6. Abrir dos sesiones nuevas `elevant-ops` por Tailscale y probar `sudo`.
7. Confirmar login, logs y WebSockets de Dokploy por la URL privada.
8. Eliminar del perfil Hostinger la excepción temporal TCP `3000`, esperar su propagación y demostrar que la IP pública ya no sirve el panel desde una conexión nueva.

No cierre todavía TCP `22` del operador ni TCP `80`; el panel `3000` sí se
retira en cuanto su Service privado queda validado.

### C. Firewall transitorio, parches y reboot

1. Instalar los artefactos revisados de [`ops/dokploy/firewall`](../../ops/dokploy/firewall/README.md).
2. Armar el rollback persistente de diez minutos y aplicar fase `transitional`: ICMP/ICMPv6, UDP 41641, TCP 22 y TCP 80 al host; en forwarding solo continúa TCP nuevo con DNAT y puerto de destino original 80. Todo otro ingreso por la interfaz pública se rechaza antes de las reglas Docker/Tailscale.
3. Confirmar que el perfil Hostinger ya quedó en su matriz transitoria sin `3000`; no ampliarlo al aplicar la segunda capa del host.
4. Probar con conexiones nuevas IPv4 e IPv6: `3000`, `1433`, Docker API y Swarm deben estar bloqueados. Tailscale, SSH privado, Dokploy privado y landing HTTP deben conservar su resultado esperado.
5. Cancelar y verificar el primer rollback. No ejecutar `apt` con ese plazo de diez minutos corriendo.
6. Seguir [`ops/dokploy/host`](../../ops/dokploy/host/README.md) para actualizar Ubuntu, kernel, Docker y containerd desde los repositorios ya configurados. No retirar el hold de `cloud-init` sin aprobación de Hostinger.
7. Crear con ese runbook un swap persistente de 2 GiB y `vm.swappiness=10`.
8. Justo antes del reboot, armar de nuevo el rollback persistente; comprobar que está `enabled`, `active` y tiene próxima ejecución.
9. Reiniciar. Dentro de los diez minutos posteriores al boot, repetir Tailscale, dos sesiones SSH nuevas, Dokploy, reglas host, perfil Hostinger y landing; solo entonces cancelar de nuevo el rollback.

No desactive las reglas administradas por Docker/Tailscale, no guarde su ruleset completo y no cambie Docker al backend nftables experimental.

El firewall del host usa exclusivamente `table inet elevant_firewall`, con base
chains `public_input` (hook `input`) y `public_forward` (hook `forward`) a
prioridad `filter - 10` y política `accept`. Los
`drop` limitados a la interfaz pública son definitivos antes de la compatibilidad
iptables-nft; los `accept` continúan hacia las reglas normales del host. Docker y
Tailscale permanecen en iptables-nft/netfilter-mode `on` y pueden reordenar sus
propios hooks sin desplazar la tabla ELEVANT. Aplicación y reemplazo son una sola
transacción nft; cualquier drift de la tabla ELEVANT aborta antes de eliminarla.
Un drop-in de `docker.service` ordena el arranque normal después de
`elevant-firewall.service` y ejecuta un `--verify-active` read-only antes de cada
start/restart. Docker falla cerrado si falta la tabla o no coincide exactamente
con la fase configurada, sin enlazar los ciclos de vida de ambas unidades.
Tailscale queda disponible como recuperación privada y el perfil Hostinger
continúa protegiendo los servicios del host durante ese fallo.
Después de cada boot se comprueban por separado
`elevant-firewall.service` y `docker.service`; un target `active` no demuestra
que sus unidades dependientes hayan arrancado correctamente.

El perfil de Hostinger usa política implícita `DROP`: no añada reglas `Allow all` ni rangos de puertos. Durante el bootstrap, antes de que Dokploy exista por Tailscale, contiene exclusivamente:

| Acción | Protocolo/puerto | Origen |
| --- | --- | --- |
| Accept | ICMP | Anywhere |
| Accept | UDP `41641` | Anywhere |
| Accept | TCP `22` | `<OPERATOR_IPV4>/32` y, si aplica, `<OPERATOR_IPV6>/128` |
| Accept | TCP `3000` | `<OPERATOR_IPV4>/32` y, si aplica, `<OPERATOR_IPV6>/128` |
| Accept | TCP `80` | Anywhere |

Después de validar Dokploy privado se elimina `3000`, dejando la matriz transitoria:

| Acción | Protocolo/puerto | Origen |
| --- | --- | --- |
| Accept | ICMP | Anywhere |
| Accept | UDP `41641` | Anywhere |
| Accept | TCP `22` | `<OPERATOR_IPV4>/32` y, si aplica, `<OPERATOR_IPV6>/128` |
| Accept | TCP `80` | Anywhere |

En fase final se eliminan las dos reglas TCP y permanecen solo ICMP y UDP `41641`. Una modificación puede tardar hasta dos minutos y no corta conexiones ya establecidas; todas las pruebas se hacen con conexiones nuevas. Consulte la [guía oficial de Hostinger](https://support.hostinger.com/es/articles/8172641-como-usar-un-firewall-vps-administrado).

### D. Traefik, landing y cierre final

1. Seguir el contrato, gates y rollback de [`ops/dokploy/traefik`](../../ops/dokploy/traefik/README.md) para descargar y verificar el digest objetivo.
2. Recrear el contenedor standalone con los mismos tres mounts, puertos, restart policy y socket Docker read-only; conectarlo a `dokploy-network` antes de arrancarlo.
3. Exigir `3.6.25`, providers sanos, logs sin errores y landing HTTP con el mismo resultado previo.
4. En Dokploy, deshabilitar —no borrar— el Domain de la landing y pulsar `Stop Application`; confirmar cero réplicas.
5. Aplicar [`ops/dokploy/ssh`](../../ops/dokploy/ssh/README.md) con rollback: `elevant-ops` key-only, contraseñas deshabilitadas y root por SSH bloqueado. El Browser Terminal de Hostinger es la recuperación local fuera de OpenSSH.
6. Armar el rollback persistente y cambiar **solo el firewall del host** a fase `final`: únicamente ICMP/ICMPv6 y UDP 41641 públicos.
7. Comprobar con conexiones nuevas que Tailscale, SSH privado y Dokploy privado funcionan y que los puertos públicos previstos fallan. Solo después editar/activar el perfil Hostinger final; el timer no revierte hPanel.
8. Esperar la propagación de Hostinger y repetir desde fuera las pruebas IPv4/IPv6 para TCP 22/80/443/3000/1433/2375/2376/2377/7946 y UDP 443/4789/7946. Cancelar este primer rollback únicamente si todo pasa.
9. Armar un rollback nuevo inmediatamente antes del reboot, reiniciar y, dentro de diez minutos, demostrar persistencia de firewall, Serve, SSH y Docker desde sesiones nuevas.
10. Cancelar el rollback post-boot únicamente después de todas las pruebas.

### E. Rotación y observabilidad

1. Rotar root y Dokploy; habilitar passkey/2FA, revocar sesiones y renovar la integración GitHub.
2. Eliminar solo la clave root con comentario `elevant-audit-root-temporary-2026-08-18`.
3. Terminar/eliminar `elevant-audit`, su home y `/tmp/elevant-audit-psql`; nunca ejecutar `pkill -u root`.
4. Verificar la revocación y entonces borrar la clave privada temporal del PC.
5. Revocar la auth key de enrolamiento Tailscale sin eliminar la máquina tagged.
6. Desplegar `elevant-dev-observability`, publicar solo
   `svc:elevant-dev-monitoring`, comprobar sus métricas privadas y el heartbeat
   base obligatorio del Hub. Telegram, alertas de umbral y checks separados de
   DB se activan en un cambio posterior cuando el operador lo apruebe.
7. Crear el snapshot post-hardening.

La observabilidad v1 no recibe `docker.sock`: Beszel muestra estado y métricas
del host, no health, logs ni inventario de contenedores. El heartbeat base del
Hub está activo. En el estado aceptado del 2026-09-12, SQL health y los seis
carriles programados —Database backup, Database restore-check, Database poll,
API poll, AVIAM poll y Public poll— se revisan en Containers, Schedules y
`controller.log` de Dokploy; todavía no envían heartbeats independientes ni
alertas externas. Es una mejora explícitamente diferida en el
[backlog de hardening](development-hardening-backlog.md).

## Handoff: despliegue manual DB v1

Al llegar aquí, el agente debe decir: **“Llegamos al despliegue manual de la DB v1”** y detener cualquier automatización. El operador crea y despliega los proyectos desde Dokploy; el agente solo proporciona campos, valida capturas/logs saneados y autoriza el siguiente checkpoint.

### Artefactos inmutables

```text
ghcr.io/erickeduardo027/elevant-db-ops@sha256:9ca989d112bdafc5519c202739253db6ae3f424f53c9dc4ef7206ae56f802682
ghcr.io/erickeduardo027/elevant-db-release@sha256:dde5d415ca3d3034a4ae438ff0b2c20549a8e617110be7b2dce6b68cd0e73473
mcr.microsoft.com/mssql/server:2022-CU26-ubuntu-22.04@sha256:ba4c8329f48fb8f02e1416be6a930ebfd71268caee78aa985f3af4315e457c89
```

El Compose también es un artefacto, no solo las imágenes. Para DB v1 se usa el
provider **Raw** de Dokploy, nunca una rama Git mutable. Los dos archivos se
extraen del commit aprobado `1281bd139709898f220c90f12ff27036a6a83b93` y se
comparan antes de pegarlos:

```powershell
$approvedRevision = '1281bd139709898f220c90f12ff27036a6a83b93'
$exportDirectory = Join-Path $env:TEMP ("elevant-db-v1-" + [guid]::NewGuid())
$archivePath = Join-Path $exportDirectory 'compose.zip'
New-Item -ItemType Directory -Path $exportDirectory | Out-Null

git cat-file -e "$approvedRevision^{commit}"
git archive --format=zip --output=$archivePath $approvedRevision -- `
  database/DevelopmentDB/compose.development.database.yml `
  database/DevelopmentDB/compose.development.release.yml
Expand-Archive -LiteralPath $archivePath -DestinationPath $exportDirectory

Get-FileHash -Algorithm SHA256 `
  (Join-Path $exportDirectory 'database/DevelopmentDB/compose.development.database.yml'), `
  (Join-Path $exportDirectory 'database/DevelopmentDB/compose.development.release.yml')
```

Los hashes deben coincidir exactamente con los registrados más abajo. En cada
proyecto, seleccione **Raw**, **Docker Compose**, AutoDeploy desactivado y pegue
el archivo exportado sin editar. Justo antes de **Deploy**, reabra el editor Raw,
copie todo su contenido y normalícelo en el PC para comprobar qué quedó guardado:

```powershell
$rawCompose = Get-Clipboard -Raw
$normalizedCompose = ($rawCompose -replace "`r`n?", "`n").TrimEnd("`n") + "`n"
$verificationPath = Join-Path $exportDirectory 'dokploy-raw-verify.yml'
[IO.File]::WriteAllText(
  $verificationPath,
  $normalizedCompose,
  [Text.UTF8Encoding]::new($false)
)
Get-FileHash -Algorithm SHA256 $verificationPath
```

El hash debe seguir siendo exacto. Use entonces **Preview Compose**: debe validar
sin añadir `dokploy-network`, Domain, labels o ports. No comparta una captura
porque el render puede contener secretos interpolados.

Las imágenes GHCR son privadas. El operador crea una credencial classic con solo `read:packages`, expiración y acceso a esos packages. No se usa en shell ni se muestra al agente.

### Secretos

Generar en el PC siete passwords SQL distintos de 40–48 caracteres y tres
passwords demo distintos, uno por cada cuenta sintética Development. Guardarlos
en un password manager y en los Environment separados de Dokploy. Excluir
espacios, `$`, comillas, punto y coma, `#` y saltos de línea para evitar
ambigüedad de Compose/connection string.

### Recursos one-time

Después de revalidar rutas, el operador crea:

```text
elevant-dev-data: bridge internal, 172.30.240.0/24, gateway 172.30.240.1
elevant-dev-sql-data: external named volume
elevant-dev-sql-backups: external named volume
```

Si alguno ya existe, detenerse e inventariarlo. Nunca usar `down -v`.

### Proyecto `elevant-dev-database`

- Provider Raw, Docker Compose normal, manual, sin AutoDeploy, Domain, ports o `dokploy-network`.
- Fuente: `database/DevelopmentDB/compose.development.database.yml`.
- SHA-256: `9b4319896a1d0b25caa6119122e2842fa6f0313ac8fdcbfa90598903cfc10b21`.
- Resultado: storage init/provisioner `Exit 0`, SQL healthy, marker Development singleton, `sa` deshabilitado y ningún 1433 público.
- Ejecutar backup y restore-check manuales antes de migrar; ambos deben terminar cero.

### Proyecto `elevant-dev-database-release`

- Provider Raw, Compose separado, manual, sin AutoDeploy, Domain o `dokploy-network`.
- Fuente: `database/DevelopmentDB/compose.development.release.yml`.
- SHA-256: `bd8fbded7339f87c71bb7e4058427581f58417602b8e37ebd0e90a0d1e79fd07`.
- `migrator Exit 0` precede a `seeder-development Exit 0`.
- Repetir seed para idempotencia y ejecutar `verify-development`, backup y restore-check.
- Nunca editar `__EFMigrationsHistory` ni ejecutar Down automáticamente.

### Programación

- Backup diario: 02:15 UTC.
- Restore-check: domingos 04:30 UTC.
- Retención local: siete backups.
- Los comandos operativos entregan la credencial a `sqlcmd` mediante
  `SQLCMDPASSWORD`; `-P` queda prohibido porque expone el secreto en los
  argumentos del proceso. Los nombres originales de contraseña tampoco se
  heredan al proceso hijo; el provisionador conserva sólo sus variables de
  scripting aprobadas.
- Sin solapamiento, `set -x` ni secretos duplicados.

Estos backups son suficientes solo mientras Development sea sintético y reconstruible.

## Handoff: activar CD automático de la base Development

El rollout inicial descrito aquí quedó aceptado el 2026-08-31 UTC. Esta sección
permanece como runbook para reconstruir, auditar o actualizar el controlador: el
repositorio entrega el controlador y sus pruebas, pero nunca lo instala por sí
solo. El operador aplica
[`ops/dokploy/database-cd/README.md`](../../ops/dokploy/database-cd/README.md)
en checkpoints y conserva AutoDeploy desactivado en ambos Compose.

Orden obligatorio:

1. En **GitHub desde el navegador del operador**, fusionar el PR y esperar el
   primer bundle OCI v1 `development-certified` completamente verde. Debe
   contener `/manifest.json` y los dos Compose, y declarar
   `bundle-version=1` y el media type v1; un artefacto de solo manifiesto no es
   candidato para este rollout.
2. En **PowerShell local del PC**, exportar el paquete
   `ops/dokploy/database-cd` del commit aprobado, verificar su hash y
   transferirlo; el paquete debe conservar finales de línea LF aunque se prepare
   en Windows.
3. En la **terminal SSH `elevant-ops` por Tailscale**, instalar en
   `/etc/dokploy/elevant/database-cd`, crear config/state/lock con permisos
   root-only y ejecutar `verify-runtime` sin mostrar `.env`. El verificador
   exige `compose config` con las opciones de render semántico, `flock` con
   `--timeout` y `--conflict-exit-code`, y resuelve el servicio Swarm `dokploy`
   únicamente cuando tiene una sola tarea local activa.
4. En esa misma **terminal SSH**, registrar los nombres y rutas exactos de los
   dos proyectos Raw existentes, sus `.env`, los hashes Compose aprobados y los
   repositorios GHCR esperados.
5. Opcionalmente, en **GitHub desde el navegador del operador**, crear un
   fine-grained PAT dedicado con solo
   `Metadata: read` y `Commit statuses: read and write`; guardarlo únicamente en
   el token file root-only indicado por el runbook.
6. En la **terminal SSH**, resolver nuevamente el ID completo de la única tarea
   local activa de `dokploy` antes de cada `docker container exec` y ejecutar
   `--dry-run`. Debe extraer y validar los tres payloads, cachear por hash y
   comprobar equivalencia semántica con los Raw vivos sin ejecutar SQL.
7. Justo antes de adoptar, abrir la ventana: en la **interfaz web privada de
   Dokploy**, deshabilitar los schedules manuales anteriores de backup y
   restore-check y comprobar que ninguno esté activo. No se deshabilitan antes
   de completar `verify-runtime` y `--dry-run`.
8. En la **terminal SSH**, ejecutar `--adopt-current` y después `--status`. Debe
   mostrar `adopted/adopted-current`, cachear ambos Compose vivos con modo `0600`
   y no volver a migrar DB v1. Si falla, no avanzar: conservar evidencia y
   reactivar los schedules manuales anteriores. El lector de las referencias
   OCI acepta el formato `.env` real de Dokploy: valor sin comillas o con un
   único par de comillas dobles exteriores. Solo retira ese par, sin
   `source`/`eval` ni interpretación de escapes; repositorio y digest continúan
   validándose de forma exacta antes de cualquier operación SQL.
9. En la **interfaz web privada de Dokploy**, página global **Schedules** y sin
   seleccionar servidor externo, crear deshabilitados estos tres jobs internos
   `dokploy-server`, todos en UTC:

   | Nombre exacto | Cron | Script versionado |
   | --- | --- | --- |
   | `ELEVANT Database CD - Backup` | `15 2 * * *` | `jobs/backup.job.sh` |
   | `ELEVANT Database CD - Restore Check` | `30 4 * * 0` | `jobs/restore-check.job.sh` |
   | `ELEVANT Database CD - Poll` | `* * * * *` | `jobs/poll.job.sh` |

   El contenido del campo Script debe coincidir con el archivo indicado y
   ejecutar el controlador/config mediante paths absolutos. No usar `server`,
   Application ni Compose Job. Dokploy puede iniciar simultáneamente el poll y
   el mantenimiento del mismo minuto. El poll conserva adquisición no
   bloqueante; backup y restore-check esperan hasta 900 segundos por el lock
   compartido. Un timeout es fallo y debe investigarse, nunca reinterpretarse
   como ejecución satisfactoria ni compensarse con otro job paralelo.
10. En la **terminal SSH**, ejecutar un único `--poll` manual para el bundle del
    commit aprobado. Exigir `succeeded/complete`, la secuencia completa, lock
    común, cache íntegro, códigos cero, logs sanitizados y SQL healthy. Ejecutar
    después `--backup` y `--restore-check` manuales.
11. En la **interfaz web privada de Dokploy**, habilitar los jobs nuevos solo
    tras esa validación y en orden backup → restore-check → poll. Verificar una
    entrega de prueba aditiva. Reiniciar el VPS solo después de terminar la
    aceptación y confirmar persistencia.

Estado vivo aceptado el 2026-08-31 UTC: los tres jobs anteriores están
habilitados, el poll posterior al reboot es *no-op* sobre el bundle ya aceptado y
los dos schedules legacy permanecen deshabilitados. No borrar los legacy hasta
observar al menos una ejecución natural correcta del backup nuevo y otra del
restore-check nuevo. No hay token de commit status ni heartbeat externo
específico de DB configurado en esta fase; el heartbeat base del Hub permanece
activo.

### Actualización in-place del controlador Database CD

Una revisión nueva del controlador sobre una baseline ya adoptada usa un flujo
distinto de los pasos 7–8 anteriores:

1. Deshabilitar los tres schedules Database CD —backup, restore-check y poll— y
   comprobar que ninguno está `Running` ni en cola. Pausar el controlador,
   exigir `paused=true` y verificar que los locks canónicos de DB/API/Web están
   libres antes de abrir el cambio.
2. Crear un snapshot `root:root 0700`, con archivos `0600`, de `config.env`, el
   estado/cache completo, los `.env` y Compose Raw vivos de Database y Database
   Release, sus SHA-256 y los IDs/imágenes/health de SQL, API y ambas webs. No
   imprimir Environment ni almacenar el snapshot en Git.
3. Instalar únicamente el paquete LF del commit aprobado. El instalador debe
   preservar configuración y estado; comparar byte a byte cada archivo
   versionado instalado con el paquete y ejecutar `sha256sum -c` contra el
   snapshot. Ejecutar `verify-runtime` y exigir `RUNTIME_OK`.
4. Aún pausado, exigir `current.json == last-success.json` en estado terminal,
   ejecutar `--status` y `--dry-run`, y demostrar que hashes, Raw, estado e IDs
   de contenedor no cambiaron. **No ejecutar `--adopt-current`, borrar o editar
   estado/cache, editar un Raw ni pulsar Deploy durante este upgrade.**
5. Reanudar con los schedules todavía deshabilitados y aceptar la semántica del
   lock real: bajo un holder breve e independiente, el poll falla de inmediato
   sin SQL; backup y restore-check esperan, adquieren el lock al liberarlo antes
   de 900 segundos y completan exactamente una vez cada uno. El holder debe
   tener liberación/timeout propios, y los logs deben distinguir contención,
   timeout y error interno de `flock`.
6. Volver a exigir copias de estado exactas, caches íntegros, locks libres y
   SQL/API/AVIAM/Public healthy, sin recreaciones ni reinicios. Solo entonces
   habilitar backup → restore-check → poll y observar un poll automático natural
   *no-op* sobre el bundle aceptado.

Ante cualquier fallo se conservan deshabilitados los tres schedules, se pausa
el controlador y se guardan snapshot, hashes y logs. No se reanuda ni se muta el
estado hasta diagnosticar la causa y aprobar expresamente la recuperación. El
procedimiento ejecutable y sus checkpoints completos viven en
[`ops/dokploy/database-cd/README.md`](../../ops/dokploy/database-cd/README.md).

Si una promoción ya registrada entra en una etapa y falla, el mismo bundle queda
bloqueado. Un error anterior a crear el intento —resolución, descarga, extracción
o validación del bundle— falla antes de ejecutar SQL y puede volver a evaluarse
en el poll siguiente. No pulse Deploy, no
edite Environment para apuntar al candidato fallido y no programe retry. Primero
investigue; una corrección normal llega con otro digest. `--retry` exige decisión
manual explícita cuando la causa era externa y ya fue corregida.

GitHub Free no permite imponer branch protection a este repositorio privado.
Por decisión del equipo, cualquier push directo DB-owned a `Development` puede
publicar candidato. Los gates inmutables/fail-stop reducen el riesgo, pero no
reemplazan una aprobación obligatoria; active las reglas documentadas en
[`.github/BRANCH_PROTECTION.md`](../../.github/BRANCH_PROTECTION.md) cuando el
plan lo permita.

## Handoff: habilitar SSMS privado para CRUD Development

El rollout quedó aceptado el 2026-09-12. Esta sección permanece como runbook de
reconstrucción, auditoría y rotación; versionarla no autoriza cambios remotos.

Este acceso es una herramienta humana para manipular datos sintéticos. No forma
parte del runtime de la API o las webs y no autoriza cambios estructurales desde
SSMS. SQL conserva cero puertos publicados; un gateway separado entrega solo el
flujo TCP autorizado por Tailscale.

| Componente | Contrato |
| --- | --- |
| SQL Server | sin `ports`, solo `elevant-dev-data` |
| Gateway | `elevant-dev-sql-tools-gateway`, loopback `127.0.0.1:11433` |
| Backend gateway | `elevant-dev-sql:1433`, sin credenciales ni terminación TLS |
| Tailscale | `svc:elevant-dev-sql-tools`, endpoint `tcp:1433` |
| Acceso | `group:elevant-db-editors` y `group:elevant-ops` |
| Base | `ElevantDevelopmentDb` |
| Rol | `elevant_dev_team_editor` |

El artefacto operativo está en
[`ops/dokploy/sql-tools-gateway`](../../ops/dokploy/sql-tools-gateway/README.md).
Usa
`docker.io/library/haproxy:3.2.23-alpine3.24@sha256:6343ce34a132a5dceaa24767d739df2bd519f8f7c1079ae39e4821334e8eb42e`
para `linux/amd64`, usuario no-root, filesystem read-only, `cap_drop: ALL`,
`no-new-privileges`, límites y exactamente dos redes externas: la interna
`elevant-dev-data` para alcanzar SQL y la bridge no interna, exclusiva,
`elevant-dev-sql-tools-runtime` para materializar el binding del host. SQL
permanece únicamente en la primera. No agregue Domain, `dokploy-network`, una
tercera red, otra publicación o un listener **del host** en `0.0.0.0`/`::`.
El `bind :11433` interno de HAProxy es correcto; no constituye una publicación
wildcard del VPS.
`haproxy.cfg` se instala en
el directorio persistente hermano `files/haproxy.cfg`, fuera de `code/`, porque
Dokploy elimina y regenera `code/` antes de cada despliegue Raw. El directorio
es `root:root 0700` y el archivo, que no contiene secretos, es `root:root 0644`
para que el config mount sea legible por UID `65534`.

Orden obligatorio del rollout:

1. Fusionar un PR aprobado con el gateway, la política Tailscale, el
   provisionador Development, verificaciones de permisos y esta documentación.
   Exigir CI verde, Compose válido e imagen gateway fijada por digest; una rama
   versionada no autoriza instalarla.
2. En la ventana manual, comprobar estados terminales exactos, contenedores
   healthy, locks libres, backup reciente verificado y restore-check correcto.
   Deshabilitar backup, restore-check y poll de Database CD; pausar Database CD
   y volver a comprobar que no hay operación SQL en curso. Registrar hashes,
   IDs de los cuatro contenedores y configuración viva sin imprimir secretos.
   Guardar `sqlserver`, `api`, `aviam-web` y `public-web`, un ID completo por
   línea y en ese orden, en `<SNAPSHOT>/container-ids.before`.
3. Tras demostrar que su CIDR está libre, crear
   `elevant-dev-sql-tools-runtime` como bridge externa, `internal=false`, con
   binding predeterminado defensivo `127.0.0.1`; debe permanecer dedicada al
   gateway. Exigir Compose 2.33.1 o posterior y Docker Engine 28.0.0 o
   posterior. Crear entonces el recurso Raw
   `elevant-dev-sql-tools-gateway` con AutoDeploy, Domain e Isolated Deployments
   desactivados. Antes del primer Deploy, resolver su
   `appName` y guardar los bytes exactos de `haproxy.cfg` en
   `/etc/dokploy/compose/<appName>/files/haproxy.cfg`; nunca dentro de `code/`.
   Validar el layout `code/` + `files/` primero en staging root-only, junto con
   hash, propietario y modo. Desplegar el Compose exacto del commit. Después del
   Deploy, verificar byte a byte `files/haproxy.cfg` y ejecutar
   `ops/dokploy/sql-tools-gateway/verify-compose-model.py` contra el Compose
   aprobado y `code/docker-compose.yml`; Dokploy normaliza el Raw y omite
   `name`. Exigir driver, `internal`, opción de binding, CIDR/gateway aprobados,
   ruta por defecto runtime, exactamente las redes `elevant-dev-data` y
   `elevant-dev-sql-tools-runtime`, backend resoluble, health correcto, TCP real
   y mapping efectivo `127.0.0.1:11433`. SQL, API y webs no se recrean y SQL
   nunca se conecta a la red runtime. Los comandos canónicos están en el README
   del gateway.
4. En Tailscale, crear `svc:elevant-dev-sql-tools` con endpoint `tcp:1433` y el
   grupo `group:elevant-db-editors`. Los tres correos reales se escriben solo en
   la consola del operador; la plantilla conserva placeholders. Mantener los
   deny tests de acceso directo al host `:1433`/`:11433`, sin Funnel, subnet
   routes, exit node ni Tailscale SSH. Este grupo concede solo SQL Tools; cada
   integrante continúa además en `group:elevant-dev` si necesita API o webs.
5. Los logins contractuales son `elevant_dev_erick`,
   `elevant_dev_eliezer` y `elevant_dev_laisha`. Guardar sus tres contraseñas
   distintas como `ELEVANT_DB_TEAM_ERICK_PASSWORD`,
   `ELEVANT_DB_TEAM_ELIEZER_PASSWORD` y
   `ELEVANT_DB_TEAM_LAISHA_PASSWORD`; nunca pegarlas en un comando, log,
   repositorio o captura. Cargar esos valores y `ELEVANT_DB_DBA_PASSWORD` en un
   archivo temporal
   `root:root 0600`. Ejecutar la imagen db-ops exacta `@sha256` del bundle
   aprobado como `docker run --rm --pull never`, con
   `--network elevant-dev-data`, filesystem read-only, todas las capabilities eliminadas,
   `no-new-privileges` y límites. Pasar solo la ruta del archivo mediante
   `--env-file` y ejecutar el entrypoint idempotente
   `provision-development-team-access`; verificar y eliminar inmediatamente el
   archivo temporal. Los valores secretos nunca forman parte de argumentos ni
   interpolación en el shell.
6. Si el equipo usará **Database Diagrams**, ejecutar una sola vez, como DBA y
   con otro `docker run` endurecido de la misma imagen y el entrypoint
   idempotente `install-development-diagram-support`. Verificar los objetos
   auxiliares y permisos mínimos; no entregar `db_owner` ni permitir `ALTER` de
   tablas al rol humano. Ninguno de estos one-shot se añade al Compose
   certificado de la base.
7. Configurar el proxy TCP únicamente después de validar el listener local:

   ```bash
   sudo tailscale serve \
     --service=svc:elevant-dev-sql-tools \
     --tcp=1433 \
     tcp://127.0.0.1:11433
   ```

   Aprobar el anuncio del host en la consola y comprobar `serve status`; Funnel
   debe seguir vacío. El nombre de conexión es
   `elevant-dev-sql-tools.<TAILNET_DNS_NAME>.ts.net,1433`.
8. Desde cada PC y su propia identidad Tailscale, conectar SSMS con
   `Database Engine`, `SQL Server Authentication`, base
   `ElevantDevelopmentDb`, `Encryption: Mandatory` y
   `Trust server certificate` habilitado solo para este Development. Probar
   `SELECT` y un ciclo transaccional `INSERT`/`UPDATE`/`DELETE` sobre tablas de
   negocio; confirmar que `CREATE`/`ALTER`/`DROP`, gestión de seguridad,
   backup/restore y escritura en `infra`/`audit` son rechazados.
9. Probar desde fuera de Tailscale y con una identidad no autorizada que el
   endpoint falla. Probar también que la IP pública no sirve `1433` ni `11433`,
   el host Tailscale no acepta esos puertos directamente y SQL sigue sin
   publicación Docker.
10. Reanudar Database CD y rehabilitar backup → restore-check → poll. Exigir un
    poll no-op, estados exactos, locks libres, los cinco workloads —SQL, API,
    ambas webs y gateway— healthy y cero recreaciones ajenas. Reiniciar el VPS
    bajo el procedimiento de quiescencia/rollback ya aceptado; repetir topología
    de redes, listener, Serve, permisos, denegaciones y conexión SSMS antes de
    cancelar el rollback.

El CRUD humano modifica datos de prueba sin pasar por reglas de negocio de la
API, por diseño. Foreign keys, `NOT NULL`, unicidad y `CHECK` continúan activos.
Una tabla, columna, relación, índice o constraint nuevos se implementan siempre
en una migración EF Core, pasan CI y los aplica Database CD; no se guardan desde
el diseñador de SSMS. Consulte
[`docs/security/database-access.md`](../security/database-access.md) para el
contrato diario y las transacciones de prueba.

Esta sección no habilita nada en Production. No copie su Service, gateway,
usuarios, contraseñas, permisos, certificado ni objetos de diagramas a ese
ambiente.

## Handoff: publicar API Development y activar su CD

La API conserva un recurso Docker Compose normal y un controlador separado. El
procedimiento ejecutable completo está en
[`ops/dokploy/api-cd/README.md`](../../ops/dokploy/api-cd/README.md). Ninguno de
los pasos siguientes autoriza al agente a modificar el host: el operador los
ejecuta y entrega evidencia sanitizada antes de avanzar.

1. Fusionar la implementación aprobada en `Development` y exigir CI verde,
   imagen API por digest y bundle `elevant-api-release-manifest` certificado.
2. Comprobar DB-CD `succeeded/complete`, SQL healthy, backups recientes,
   `systemctl --failed` vacío, recursos disponibles y puerto `18080` libre.
3. Crear una bridge externa exclusiva de runtime con CIDR libre y gateway fijo.
   No convertir `elevant-dev-data` en red de salida ni unir la API a
   `dokploy-network`.
4. Crear `elevant-dev-api` como **Docker Compose / Raw**, sin Domain y con
   AutoDeploy desactivado. Guardar Environment `root:root 0600`, registrar los
   paths reales y desplegar solo la referencia `@sha256` certificada.
5. Exigir UID no-root, hardening, límites, redes exactas, listener únicamente
   `127.0.0.1:18080`, health/readiness/ping/Swagger correctos y ausencia de
   migración/seed en logs.
6. Publicar `svc:elevant-dev-api` con Tailscale Serve hacia el loopback. Probar
   acceso de `group:elevant-dev` y `group:elevant-ops`, denegación pública y
   Funnel vacío.
7. Transferir el paquete LF de `api-cd` desde el commit aprobado, validar su
   SHA-256, instalarlo pausado y ejecutar `verify-runtime`, `--dry-run` y
   `--adopt-current` sin mostrar Environment.
8. Crear deshabilitado el único schedule `ELEVANT API CD - Poll`, UTC
   `* * * * *`, con el contenido exacto del job versionado. Ese job espera 15
   segundos para no competir sistemáticamente en `:00` con Database CD; los
   locks siguen siendo la protección definitiva si una operación DB dura más.
   Ejecutar primero un no-op manual y habilitarlo después.
9. Validar la siguiente entrega API-only, rollback de aplicación y persistencia
   tras un reboot controlado. Nunca hacer rollback de esquema como respuesta a
   un fallo API.

Cuando una entrega cambia el Compose certificado (por ejemplo, al registrar los
orígenes CORS de las webs), hay un checkpoint adicional **antes del merge**:
deshabilitar el schedule API, pausar `api-cd`, agregar al Environment root-only
los nuevos valores y guardar en Raw el Compose exacto ya revisado, sin desplegar
manualmente otra imagen. Solo después se fusiona y publica el bundle. Con el
candidato disponible, ejecutar `--dry-run`, reanudar, hacer un `--poll` manual y
validar la promoción antes de reactivar el schedule. Esto evita registrar un
`preflight_failed` por divergencia entre el Raw vivo y el payload certificado.

El primer rollout de sesión requiere coordinar Database y API antes de fusionar:
el Environment root-only de Database Release incorpora
`ELEVANT_DEV_ADMIN_ACCOUNT_PASSWORD`, `ELEVANT_DEV_RAMP_ACCOUNT_PASSWORD`,
`ELEVANT_DEV_AIRLINE_ACCOUNT_PASSWORD` y
`ELEVANT_DEV_HUMAN_RESOURCES_ACCOUNT_PASSWORD`, con valores distintos; el Environment
de API incorpora `ELEVANT_API_AUTH_ISSUER`, `ELEVANT_API_AUTH_AUDIENCE` y
`ELEVANT_API_AUTH_SIGNING_KEY_BASE64`, y puede fijar
`ELEVANT_API_AUTH_ACCESS_TOKEN_MINUTES`. La clave de firma se genera como 32–128
bytes aleatorios codificados en Base64. No se reutiliza ningún password de
cuenta, no se muestran valores en logs o capturas y se conserva la antigua
variable compartida del seed durante toda la ventana de rollback. Solo se retira
después de la aceptación final de Database, API y webs.
Como cambian ambos Compose certificados, se pausan los controladores y schedules
de DB/API/Web, se guardan los Raw exactos revisados y se ejecutan los dry-runs
antes del merge. La promoción se acepta en orden Database → API → webs.

Para incorporar las cuentas sintéticas de Contratos y Finanzas en una entrega
posterior, Database Release también necesita
`ELEVANT_DEV_CONTRACTS_ACCOUNT_PASSWORD` y
`ELEVANT_DEV_FINANCE_ACCOUNT_PASSWORD` en su Environment root-only y las dos
entradas correspondientes en el Compose vivo. Ambos valores deben ser nuevos y
distintos de las otras cuatro cuentas. El operador compara primero el Compose
vivo con el candidato certificado, prepara los dos valores sin mostrarlos en
terminal ni PR y realiza `--dry-run` antes de reanudar la promoción. El seed
crea cuentas ausentes, pero nunca vuelve a escribir contraseñas existentes.
La recuperación de Gestión Humana es un comando manual separado,
`rotate-development-human-resources`, fuera de los schedules.

La entrega de gobernanza comercial añade `ELEVANT_DEV_SUPERADMIN_ACCOUNT_PASSWORD`
al seeder de Development. Antes de publicar el commit en `Development`, el
operador prepara una séptima contraseña distinta en el Environment root-only de
Database Release y agrega la entrada correspondiente al Compose Raw vivo. Con
los schedules de Database CD deshabilitados y el controlador pausado, compara
el Compose vivo con el candidato revisado y comprueba que la única diferencia
semántica esperada es esa variable del seeder. No pulsa **Deploy** ni ejecuta el
seed manualmente. Tras la publicación del bundle certificado, ejecuta
`--dry-run`, reanuda el controlador y hace un único `--poll` manual. Exige
backup previo, migraciones, seed, verificación, backup posterior y restore-check
en estado `succeeded/complete` antes de reactivar el schedule. Conserva el
secreto fuera del repositorio, logs y capturas. La cuenta sintética es
`super.admin@dev.elevant.test`; el seed no cambia su contraseña en ejecuciones
posteriores. Después valida API, AVIAM Web y Public Web contra sus bundles
compatibles, en ese orden.

En el checkpoint observado para esta entrega, **Guardar** el Raw y el
Environment en Dokploy conservó el contenido del editor, pero no actualizó
`code/docker-compose.yml` ni `code/.env` antes de **Deploy**. Database CD lee esos
archivos vivos durante su preflight. Con los schedules deshabilitados y el
controlador pausado, el operador reabre el Raw guardado y comprueba su SHA-256
contra `database/DevelopmentDB/compose.development.release.yml`; crea una copia
de seguridad `root:root 0700` del Compose y el Environment vivos; sincroniza
ambos archivos con el Raw revisado y el mismo secreto guardado en Dokploy,
introducido por terminal privada sin eco; y comprueba el hash del Compose, la
presencia de la clave sin imprimirla y `root:root 0600` para `.env`. La fuente
guardada en Dokploy y los archivos vivos deben concordar antes de publicar el
commit. Ninguno de estos pasos ejecuta **Deploy** o el seed.

La credencial runtime de la API sigue siendo exclusivamente `elevant_dev_app`.
Además de autenticación y contexto de actor, el primer slice OCC publica dos
lecturas bajo `/api/v1/occ/planning`. Estas aplican rol, membresía y scope de
estación en el backend; no introducen secretos ni variables runtime nuevas. El
seed sintético agrega una escala determinista para validar la lectura, por lo
que una entrega de este corte se promueve en orden Database → API y, cuando el
cliente lo consuma, AVIAM Web. No se pausa ni reconfigura el control plane por
una entrega ordinaria cuyo Compose certificado no cambie: los controladores
existentes descubren y promueven los bundles según su dependencia. Development
permanece 100 % tailnet-only y con datos sintéticos.

## Handoff: publicar las webs Development y activar su CD

Este handoff conserva el procedimiento de reconstrucción y de próximas
promociones. AVIAM Web y Public Web ya completaron sus despliegues, adopciones,
drills B -> A -> B y activación de schedules; una repetición exige igualmente
artefactos certificados y todos los checkpoints. No interprete la presencia de
Compose, Dockerfiles o `web-cd` en el repositorio como autorización para cambiar
el VPS. El procedimiento detallado del controlador está en
[`ops/dokploy/web-cd/README.md`](../../ops/dokploy/web-cd/README.md).

### Publicación en GitHub

1. En **GitHub desde el navegador del operador**, registrar como variables de
   repositorio los orígenes HTTPS exactos, sin `/` final:
   `ELEVANT_DEV_API_ORIGIN`, `ELEVANT_DEV_AVIAM_WEB_ORIGIN` y
   `ELEVANT_DEV_PUBLIC_WEB_ORIGIN`. No son secretos, pero sus valores vivos no
   se copian a plantillas, documentación ni logs.
2. Fusionar el PR aprobado en `Development` y exigir CI verde para cada carril
   aplicable. GitHub Actions debe construir/certificar fuera del VPS y publicar
   por digest:
   - imagen `elevant-private-web` + bundle
     `elevant-aviam-web-release-manifest`;
   - imagen `elevant-public-web` + bundle
     `elevant-public-web-release-manifest`.
3. Para cada bundle, comprobar que `development-certified` se movió al final,
   que contiene exactamente `/manifest.json` y
   `/compose/compose.development.web.yml`, y que ambos payloads coinciden byte a
   byte con la entrega. El alias es descubrimiento; registrar el digest
   resuelto.
4. Revisar el manifiesto cerrado: aplicación, commit/run, imagen web, hash
   Compose, fingerprint de configuración y dependencia API exacta. Bundle,
   `runId`, imagen y OpenAPI requeridos deben corresponder al estado API-CD
   activo antes de desplegar.

### Rollout manual, una web a la vez

Aplicar primero `aviam-web` y aceptarla completamente antes de iniciar
`public-web`:

1. En la **terminal SSH privada**, comprobar DB-CD y API-CD
   `succeeded/complete`, SQL y API healthy, locks libres, `systemctl --failed`
   vacío, recursos disponibles y el puerto objetivo sin listener.
2. Inventariar todas las redes Docker y elegir CIDR libres. Crear bridges
   externas distintas: `elevant-dev-aviam-web-runtime` y
   `elevant-dev-public-web-runtime`. No conectarlas a `elevant-dev-data`,
   `dokploy-network` ni entre sí.
3. En la **interfaz privada de Dokploy**, crear dos recursos Docker Compose
   normales con provider **Raw**, AutoDeploy desactivado y sin Domain. Usar los
   Compose certificados de:
   - `frontend/private-web/compose.development.aviam-web.yml`;
   - `frontend/public-web/compose.development.public-web.yml`.
4. En cada Environment restringido guardar solo su referencia de imagen
   `@sha256:` y configuración declarada por el Compose. Mantener archivo
   `root:root 0600`; no mostrarlo ni duplicar secretos. Ejecutar Preview Compose
   y comprobar que Dokploy no añadió red, labels, Domain o puerto.
5. Desplegar manualmente la baseline certificada. Exigir un solo contenedor
   healthy con cero reinicios, usuario no-root, rootfs read-only, límites y una
   sola red runtime. Verificar listeners exactos:
   - AVIAM Web: `127.0.0.1:18081 -> 8080`, `/healthz` y rutas shell/deep-link;
   - Public Web: `127.0.0.1:18082 -> 3000`, `/health` y rutas/assets Next.
6. Confirmar que ninguna web pertenece a una red SQL y que los puertos
   `18081`/`18082` no responden por la IP pública. Publicar después los Services
   Tailscale ya reservados hacia cada loopback, aprobar el anuncio y probar
   HTTPS desde identidades autorizadas. Exigir `tailscale funnel status` sin
   exposición pública.
7. Transferir el paquete LF `ops/dokploy/web-cd` del commit aprobado, validar su
   SHA-256 e instalarlo una vez en `/etc/dokploy/elevant/web-cd`. El instalador
   debe preservar cualquier configuración/estado existente y dejar los dos
   schedules desactivados; no despliega ninguna aplicación.
8. Completar por separado `config.aviam-web.env` y
   `config.public-web.env` con repositorios, proyectos y paths reales. Ambos
   perfiles deben identificar el mismo proyecto/servicio Compose de API, su
   puerto interno `8080`, el path Swagger v1 y una imagen
   `docker.io/curlimages/curl` revisada e inmutable por digest. El controlador
   consulta Swagger con un probe efímero dentro del namespace de red del
   contenedor API exacto; `127.0.0.1:18080` desde Dokploy no representa el
   loopback del VPS y no debe configurarse como origen. Mantener directorios
   `0700`, ejecutables `0555` y configuración/estado/cache `0600`. Ejecutar
   `verify-runtime` sin imprimir Environment.
9. Para el perfil actual, ejecutar `--dry-run`, `--adopt-current` y `--status`.
   Debe verificar el bundle, Compose, imagen, API exacta, OpenAPI, contenedor y
   smokes antes de registrar `adopted-current`; nunca vuelve a desplegar ni toca
   la otra web durante la adopción. Esta baseline sana es A.
10. En **Schedules** crear deshabilitados dos jobs internos
    `dokploy-server`, UTC y cron `* * * * *`:

    | Nombre exacto | Script versionado | Offset interno |
    | --- | --- | --- |
    | `ELEVANT AVIAM Web CD - Poll` | `jobs/aviam-web-poll.job.sh` | 30 segundos |
    | `ELEVANT Public Web CD - Poll` | `jobs/public-web-poll.job.sh` | 45 segundos |

    El script se copia exactamente y llama al path absoluto del controlador.
    No usar Application, Compose Job ni servidor externo. Database inicia
    normalmente en `:00` y API en `:15`; los locks siguen siendo la exclusión
    definitiva.
11. Mantener el schedule **Disabled** y esperar un candidato certificado B cuyo
    `runId` sea estrictamente posterior a A. Instalar o actualizar primero la
    revisión del controlador que incorpora el drill seguro, volver a ejecutar
    `verify-runtime`, pausar el perfil y ejecutar `--dry-run`. No ejecutar un
    `--poll` normal una vez publicado B: debe seguir siendo nuevo para el drill.
12. Con el digest exacto actualmente anunciado para B, ejecutar:

    ```text
    elevant-web-cd --app <aviam-web|public-web> \
      --promote-with-rollback-drill sha256:<DIGEST_EXACTO>
    ```

    El comando exige el perfil pausado, una baseline A sana y la misma tupla
    exacta `apiManifest`/`apiRunId`/`apiImage`/`openApiSha256` en A, B y la API
    activa. Antes de la primera mutación precarga y valida todos los artefactos;
    luego ejecuta B -> A -> B exclusivamente con `--pull never`, health y todos
    los smokes certificados en cada tramo.
13. En éxito, exigir que el perfil continúe pausado y que su estado sea
    `succeeded/complete` con `rollbackStatus=succeeded`. Confirmar además imagen
    y Compose finales de B, contenedor healthy con cero reinicios, listener
    loopback, red runtime única, ausencia de red SQL y que DB, API y la otra web
    no se recrearon. En cualquier fallo, dejar el schedule deshabilitado: el
    perfil queda pausado, intenta restaurar A y requiere una acción explícita
    del operador antes de continuar. Si la API exacta ya no está activa, la
    recuperación se difiere sin mutar la web y conserva el intento como
    `running/interrupted`; restaurar primero esa tupla API y volver a invocar el
    digest pendiente. `--resume` permanece bloqueado mientras exista ese estado,
    ante cualquier `rollbackStatus=failed` y después de cualquier fallo terminal
    del drill. Una promoción ordinaria interrumpida se contiene o reconcilia con
    un primer `--resume`, o con el siguiente `--poll` si el perfil todavía no
    estaba pausado. En ambos casos continúa pausada, exige revisión y solo una
    invocación posterior de `--resume` elimina la pausa; nunca se reclasifica
    como drill y todo poll posterior a la pausa es un no-op absoluto.
14. Solo tras esa aceptación, reanudar el perfil, ejecutar manualmente el job
    todavía deshabilitado y exigir un no-op sobre B. Habilitar entonces su
    schedule y comprobar el primer no-op automático. Repetir desde el paso 1
    para la segunda web.
15. Tras aceptar ambas, abrir una ventana de quiescencia para el reboot. En
    **Schedules**, deshabilitar los seis jobs exactos: Database backup,
    Database restore-check, Database poll, API poll, AVIAM poll y Public poll.
    Exigir que ninguno esté ejecutándose ni en cola; después comprobar que todos
    los locks canónicos están libres, que cada controlador está en estado
    terminal y que cada `current.json` coincide exactamente con su
    `last-success.json`. Pausar entonces Database CD, API CD y ambos perfiles
    Web CD, exigir sus cuatro estados `paused=true` y volver a comprobar que los
    locks están libres.
16. Solo con esa evidencia, armar y verificar el rollback temporizado del
    firewall y reiniciar. Durante la recuperación mantener los seis schedules
    deshabilitados; validar desde sesiones nuevas Docker/Swarm, los cinco
    workloads healthy —SQL, API, AVIAM Web, Public Web y SQL Tools Gateway—,
    listeners loopback, estados/cache y los cuatro perfiles aún pausados,
    Tailscale Services, HTTPS autorizado y Funnel apagado. El
    gateway debe conservar exactamente sus dos redes y su mapping
    `127.0.0.1:11433`; SQL debe permanecer solo en `elevant-dev-data` y sin
    listener host `1433`. Comparar también los archivos instalados de cada
    controlador con sus paquetes aprobados, el modelo/configuración del gateway
    con sus artefactos aprobados y repetir los tres `verify-runtime`; para
    Database CD debe seguir verificada la semántica de timeout y código de
    conflicto de `flock`. Antes de cancelar el rollback, repetir desde un PC
    autorizado la conexión SQL por el Service, las denegaciones a los puertos
    directos y una autenticación SSMS personal. Inmediatamente después del boot
    y antes de cada bloque largo o prueba externa, verificar marcador, estado y
    próxima ejecución del timer y reiniciarlo para recuperar la ventana
    completa. Si ya venció, detener la aceptación y seguir la recuperación
    fail-closed de
    [`ops/dokploy/firewall`](../../ops/dokploy/firewall/README.md).
17. Reanudar en orden Database CD → API CD → AVIAM Web CD → Public Web CD y
    exigir que reanudar no recrea contenedores. Rehabilitar después los jobs en
    orden de dependencia: Database backup → Database restore-check → Database
    poll → API poll → AVIAM poll → Public poll. Exigir al menos un *no-op*
    automático natural de cada uno de los cuatro polls y confirmar que estado e
    IDs de contenedor permanecen estables. Solo después cancelar el rollback del
    firewall. Si falla un checkpoint, conservar deshabilitado el job afectado y
    todos sus dependientes, pausar sus perfiles, guardar evidencia y dejar actuar
    la recuperación armada en vez de declarar aceptado el reboot.

Un candidato que no coincide exactamente con el bundle/run/imagen/OpenAPI de la
API activa se difiere sin intento ni mutación. Si la promoción falla después de
iniciar el deploy, el controlador restaura el último par imagen + Compose sano;
si ese rollback falla, pausa solo el perfil afectado. Nunca ejecutar
`docker compose down`, eliminar las redes o conectar las webs a SQL.

### Cambio controlado del runtime AVIAM Web a Next.js

La imagen nueva de `aviam-web` ejecuta Next.js standalone con Node 24 y UID
`101`. Conserva el contrato externo `127.0.0.1:18081 -> 8080`, `/healthz`
con cuerpo `ok` y los smokes `/` y `/dashboard`. El Compose revisado monta
`/tmp` y `/app/frontend/private-web/.next/cache` como tmpfs, mantiene rootfs
read-only y permite más memoria y procesos para SSR. El servidor genera la CSP
con nonce por solicitud y responde rutas profundas sin fallback SPA de Nginx.

Para pasar de la baseline Nginx ya instalada, el operador deshabilita únicamente
`ELEVANT AVIAM Web CD - Poll`, espera que no haya ejecución activa y pausa el
perfil `aviam-web`; Database, API y Public Web conservan sus schedules. Registra
la baseline A, su imagen y Compose exactos y verifica `--status` y `--dry-run`
sin mutar Dokploy. Después del merge y la certificación de B, compara el
Compose del bundle con `frontend/private-web/compose.development.aviam-web.yml`
y confirma la misma tupla API antes de ejecutar el drill B → A → B documentado
arriba. El controlador aplica el Compose del bundle; no se hace un Deploy manual
del Raw ni se habilita AutoDeploy. Tras el drill, el operador verifica rutas
profundas, CSP, recursos `/_next/static/`, sesión interna y aislamiento de red,
reanuda el perfil, exige un no-op manual y habilita el poll. Si falla un gate,
mantiene el perfil pausado y el poll deshabilitado para conservar o restaurar A.

### Alcance de aceptación

La entrega sigue siendo un preview técnico compartido. Sesión y las consultas
OCC de snapshot/opciones son contratos reales de la API; creación de escalas,
asignación, ejecución mobile, revisión y el resto de flujos del prototipo siguen
pendientes y no deben presentarse como funcionales. No se despliega
`backend-prototipo` ni se usa localhost como backend remoto. Mobile Agent
continúa únicamente en emulador/tablet y su artefacto APK/EAS nunca es un
servicio Dokploy.

## Aceptación

- Dokploy y monitoreo funcionan solo por Tailscale.
- Traefik es 3.6.25 y la landing permanece guardada en cero réplicas.
- SSH público y contraseñas SSH fallan; `elevant-ops` privado y el Browser Terminal fuera de banda funcionan.
- El único ingreso público es ICMP/ICMPv6 y UDP 41641.
- Firewall, Serve y Docker sobreviven un reboot.
- SQL está healthy, sin puerto público y solo en `elevant-dev-data`.
- Migración, seed idempotente, permisos, backup y restore-check pasan.
- SSMS Development está habilitado: el gateway escucha únicamente en
  `127.0.0.1:11433`, pertenece exactamente a `elevant-dev-data` y
  `elevant-dev-sql-tools-runtime`, y el Service `svc:elevant-dev-sql-tools` es
  la única entrada. SQL permanece solo en la red de datos y la red runtime solo
  contiene el gateway. Las tres cuentas personales
  pasan CRUD de negocio y no pueden ejecutar DDL, administrar SQL ni escribir
  en `infra`/`audit`; una identidad no autorizada y la red pública no conectan.
- El controlador adoptó la baseline, ejecuta imágenes y Compose certificados
  por digest/hash, compara semántica con los Raw vivos, serializa promoción y
  schedules, y registra el mismo resultado en Dokploy/GitHub cuando el token
  opcional existe.
- Los caches `state/compose/database` y `state/compose/release` son root-only,
  modo `0600`, y contienen las entradas referenciadas por `last-success.json`.
- Tras el rollout API, el servicio está healthy por digest, API-CD está
  `succeeded/complete`, el poll aceptado es no-op y Tailscale es la única vía de
  acceso a `18080`.
- Los preflights CORS de ambos orígenes HTTPS exactos incluyen credenciales,
  `Authorization` y `Content-Type`; un origen similar no recibe headers CORS.
- Tras la aceptación inicial de cada perfil web, Web CD está
  `succeeded/complete` con `rollbackStatus=succeeded`, usa imagen/Compose por
  digest/hash, completó el drill pausado B -> A -> B contra la API exacta y
  convierte el bundle aceptado en no-op; el otro perfil conserva su estado.
- AVIAM Web escucha solo en `127.0.0.1:18081` y Public Web solo en
  `127.0.0.1:18082`; ambas son no-root, healthy, visibles exclusivamente por su
  Service Tailscale y no pertenecen a ninguna red SQL. Funnel continúa apagado.
- La aceptación web se etiqueta como preview técnico. Solo sesión y las dos
  lecturas OCC publicadas por OpenAPI cuentan como negocio validable; no acredita
  comandos de creación/asignación, ejecución mobile ni otros módulos pendientes.
- Quedan más de 2 GiB de memoria disponible y 15 GB de disco libre, sin OOM.

## Rollback

- Firewall host: rollback temporizado que valida y elimina solo `table inet elevant_firewall`.
- Hostinger: desactivar el perfil.
- SSH: retirar solo el drop-in desde Browser Terminal.
- Traefik: recrear temporalmente con el digest auditado 3.6.7.
- Landing: Start Application y habilitar Domain.
- API: pausar `api-cd`, deshabilitar su schedule y restaurar juntos la imagen y
  el Compose/hash registrados en `last-success`; si no existe baseline sana,
  drenar/limpiar solo `svc:elevant-dev-api` y detener su Compose sin tocar
  SQL/red/volúmenes.
- AVIAM/Public Web: pausar solo el perfil `web-cd` afectado, deshabilitar su
  schedule y restaurar juntos imagen + Compose/hash de su `last-success`. Si no
  existe baseline sana, drenar/limpiar únicamente su Service Tailscale y
  detener ese Compose; no tocar API, SQL, redes ajenas ni el otro perfil.
  Un drill fallido ya deja el perfil pausado y restaura la baseline cuando es
  posible; no reanudar ni habilitar el schedule hasta diagnosticar su estado y
  decidir explícitamente la recuperación.
- SSMS Development: drenar y limpiar únicamente
  `svc:elevant-dev-sql-tools`, detener el recurso gateway y deshabilitar los
  logins personales. No borrar la red `elevant-dev-data`, recrear SQL ni tocar
  sus volúmenes. La retirada del soporte de diagramas, si fue instalado, es una
  decisión de esquema separada y no forma parte del rollback de conectividad.
- DB: detener Compose conservando red y volúmenes.
- Snapshot: último recurso; restaura todo el VPS y pierde cambios posteriores.
