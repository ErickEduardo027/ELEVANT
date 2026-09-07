# Controlador privado de Database CD

Este directorio define el controlador *pull-based* de la base Development. Es
una plantilla revisable: no autoriza a un agente a instalarla, modificar
Dokploy ni desplegar una migración. El operador realiza cada cambio remoto y
valida su checkpoint.

## Contrato de seguridad

- El tag `development-certified` sirve solo para descubrir una publicación.
  El controlador resuelve su digest, extrae los tres payloads del bundle desde
  esa identidad inmutable y ejecuta exclusivamente imágenes `@sha256` y Compose
  certificados.
- Solo acepta `ErickEduardo027/ELEVANT`, `refs/heads/Development`, ambiente
  `Development`, bundle/media type v1, etiquetas OCI coincidentes, hashes
  exactos de ambos payloads Compose y huellas/migraciones con formato canónico.
- Los Compose extraídos se almacenan por hash en el estado root-only. Antes de
  cualquier operación se compara su modelo renderizado con el de los archivos
  Raw vivos en Dokploy: se toleran comentarios/formato, no drift semántico.
- Un lock compartido serializa promoción, backup y restore-check. Los polls y
  operaciones de control fallan inmediatamente si está ocupado; backup y
  restore-check esperan como máximo 900 segundos. Esa espera acotada evita que
  un poll simultáneo consuma la única ventana diaria o semanal, sin permitir
  operaciones SQL concurrentes. Un timeout termina en error visible y exige
  investigación; no se trata como backup completado. Los estados se escriben con
  `fsync` y reemplazo atómico. Una promoción fallida o interrumpida
  después de crear su intento no se reintenta automáticamente. Un fallo previo
  de resolución/extracción/validación se rechaza antes de SQL y puede evaluarse
  otra vez en el siguiente poll. El lock vive dentro del directorio de estado
  `0700`, no en un path público de `/run/lock`.
- Después de la adopción inicial, el `runId` de cada candidato debe ser mayor
  que el último aceptado. Reejecutar un workflow antiguo puede mover un alias
  mutable, pero el controlador lo trata como *no-op* y nunca ejecuta SQL.
- La secuencia fija es: preflight, backup, migración, seed idempotente,
  verificación integral, segundo backup y restore-check. No existe rollback
  automático de esquema, restore automático, edición de `__EFMigrationsHistory`,
  eliminación de volumen ni publicación de 1433.
- Las credenciales continúan solo en los `.env` `root:root 0600` de los dos
  recursos Dokploy. El controlador exige ese modo exacto y no las extrae,
  imprime ni registra. El PAT opcional vive en un archivo `0600`, nunca en
  GitHub, el Compose o la línea de comandos.
- Este diseño automatiza el push directo a `Development`, pero GitHub Free no
  puede imponer revisión obligatoria en el repositorio privado. Todo colaborador
  con permiso de escritura puede disparar el pipeline o cambiar un workflow.

## Bundle certificado v1

El artefacto OCI es una imagen `scratch` mínima con `CMD ["/manifest.json"]` y
estos tres payloads obligatorios:

```text
/manifest.json
/compose/compose.development.database.yml
/compose/compose.development.release.yml
```

Usa las etiquetas
`org.opencontainers.image.revision`, `org.opencontainers.image.source`,
`org.elevant.database.environment=Development`,
`org.elevant.database.manifest.schema=1`,
`io.elevant.database-release.schema-version=1` y
`io.elevant.database-release.bundle-version=1`. El media type de protocolo es
`io.elevant.database-release.media-type=application/vnd.elevant.database-release-bundle.v1`.
El JSON, que valida explícitamente `Development` y los hashes de los otros dos
payloads, mantiene esta forma exacta:

```json
{
  "schemaVersion": 1,
  "environment": "Development",
  "source": {
    "repository": "OWNER/REPOSITORY",
    "ref": "refs/heads/Development",
    "commit": "40-lowercase-hex",
    "runId": "123",
    "runAttempt": 1,
    "workflowUrl": "https://github.com/OWNER/REPOSITORY/actions/runs/123"
  },
  "images": {
    "ops": "ghcr.io/owner/elevant-db-ops@sha256:...",
    "release": "ghcr.io/owner/elevant-db-release@sha256:..."
  },
  "compose": {
    "databaseSha256": "64-lowercase-hex",
    "releaseSha256": "64-lowercase-hex"
  },
  "database": {
    "migrationIds": ["20260817200402_V1_01_Platform"],
    "migrationFingerprint": "sha256:...",
    "modelFingerprint": "sha256:...",
    "seedFingerprint": "sha256:..."
  },
  "publishedAt": "2026-08-23T00:00:00Z"
}
```

CI vuelve a extraer los tres archivos y exige igualdad byte a byte antes y
después de publicar el digest. El controlador exige los tres archivos
regulares, no symlinks, entre 1 byte y 1 MiB; compara el SHA-256 de cada Compose
con el manifiesto antes de guardarlo o ejecutar SQL. Las claves extra, tags de
imagen, mayúsculas en digests, migraciones vacías o desordenadas y cualquier
discrepancia de identidad se rechazan antes de SQL.

## Instalación manual, un checkpoint a la vez

La ruta operativa normal empieza en el PC y entra por SSH privado de Tailscale.

**Terminal: PowerShell local en el PC del operador**

```powershell
$commit = git rev-parse HEAD
$archive = "ELEVANT-database-cd-$($commit.Substring(0, 12)).tar.gz"
git -c core.autocrlf=false archive `
  --format=tar.gz `
  --prefix=database-cd/ `
  --output=$archive `
  "${commit}:ops/dokploy/database-cd"
Get-FileHash -Algorithm SHA256 $archive
```

La exportación usa los blobs del commit aprobado, impone LF aunque el PC sea
Windows y añade un único prefijo `database-cd/`. El hash se compara después de
la transferencia y antes de extraer; no se empaqueta la copia de trabajo.

**Terminal: PowerShell local; apertura de la sesión SSH privada**

```powershell
ssh -i "$HOME/.ssh/elevant_ops_ed25519" elevant-ops@elevant-dev-host
```

Los comandos Linux de los pasos siguientes se ejecutan en esa **terminal SSH
del VPS** con `sudo`. La terminal root de Hostinger queda exclusivamente como
recuperación si Tailscale u OpenSSH no están disponibles.

1. En la **terminal SSH del VPS**, extraer el paquete revisado en un directorio
   temporal y ejecutar:

   ```bash
   sudo bash ./install-controller
   ```

   El instalador solo copia el controlador, `manifest-tool.mjs`,
   `compose-model-tool.mjs`, `state-tool.mjs` y las plantillas de job a
   `/etc/dokploy/elevant/database-cd`; crea también el cache root-only
   `state/compose/{database,release}`. No habilita jobs ni despliega.
   El paquete debe conservar finales de línea LF; un error `set: pipefail` al
   instalar indica una exportación CRLF y detiene este checkpoint.

2. Editar la copia `/etc/dokploy/elevant/database-cd/config.env`, sustituir cada
   `REPLACE_*`, mantener `root:root 0600` y comprobar que las rutas corresponden
   a los recursos **Database** y **Database Release** ya desplegados. No pegar
   secretos en esta plantilla.

3. Si se desea estado de commit, crear fuera del repositorio el archivo indicado
   en `ELEVANT_CD_GITHUB_TOKEN_FILE`. El fine-grained PAT se limita al repositorio
   ELEVANT con `Metadata: read` y `Commit statuses: read/write`. El acceso GHCR
   continúa usando `/root/.docker` dentro de Dokploy.

4. Antes de crear cualquier job, en la **terminal SSH privada del VPS** ejecutar
   el
   preflight read-only del runtime real:

   ```bash
   sudo /etc/dokploy/elevant/database-cd/verify-runtime --host-container dokploy
   ```

   Debe devolver `RUNTIME_OK`. Comprueba dentro del contenedor `bash`, `docker`,
   el plugin Compose y las opciones `config --format`, `--no-interpolate`,
   `--no-env-resolution` y `--no-path-resolution`; también `node`, los tres
   helpers, `curl`, `flock` con soporte de `--timeout` y
   `--conflict-exit-code`, `sha256sum`, el daemon Docker, `/etc/dokploy` y
   `/root/.docker`. No instala nada. Si
   falta una dependencia, el poller **no se habilita**: se detiene el checkpoint
   y se prepara un runtime de controlador versionado; nunca se instala un paquete
   manual dentro del contenedor Dokploy porque desaparecería al actualizarlo.
   El argumento puede ser un contenedor exacto o el nombre de un servicio
   Swarm. Para un servicio, el verificador exige exactamente una tarea local
   activa y ejecuta su ID completo; cero o varias tareas detienen el checkpoint.

5. Dentro de esa misma **terminal SSH del VPS**, declarar este resolvedor
   *fail-closed* y ejecutar el controlador en la única tarea local activa de
   Dokploy:

   ```bash
   resolve_dokploy_task() {
     local task_id
     task_id="$(sudo docker container ls --quiet --no-trunc \
       --filter status=running \
       --filter 'label=com.docker.swarm.service.name=dokploy')" || return 1
     [[ "$task_id" =~ ^[0-9a-f]{64}$ ]] || {
       printf '%s\n' 'Expected exactly one local running Dokploy task.' >&2
       return 1
     }
     printf '%s\n' "$task_id"
   }

   DOKPLOY_CONTAINER_ID="$(resolve_dokploy_task)" &&
   sudo docker container exec "$DOKPLOY_CONTAINER_ID" \
     /etc/dokploy/elevant/database-cd/elevant-database-cd --dry-run
   ```

   Se vuelve a resolver antes de cada checkpoint: una actualización de Swarm
   puede reemplazar el contenedor y cambiar su ID.

6. Solo ahora abrir la ventana de cambio. En la **interfaz web privada de
   Dokploy**, deshabilitar los schedules manuales anteriores de backup y
   restore-check y comprobar que ninguno esté ejecutándose. Después, en la
   **terminal SSH del VPS**, registrar conscientemente la v1 ya desplegada:

   ```bash
   DOKPLOY_CONTAINER_ID="$(resolve_dokploy_task)" &&
   sudo docker container exec "$DOKPLOY_CONTAINER_ID" \
     /etc/dokploy/elevant/database-cd/elevant-database-cd --adopt-current
   ```

   Este comando **no consume el alias candidato**. Lee exclusivamente
   `ELEVANT_DB_OPS_IMAGE` del `.env` Database y `ELEVANT_DB_RELEASE_IMAGE` del
   `.env` Database Release; exige referencias `@sha256`, revisiones/labels OCI
   coherentes, calcula los hashes de ambos Compose vivos, los almacena por
   contenido y ejecuta `verify-development`, backup y restore-check. Solo
   después guarda el baseline.
   Los valores pueden estar sin comillas o con el único par de comillas dobles
   exteriores que genera Dokploy. El lector estricto de estas dos referencias
   retira solo ese par: no ejecuta `source`/`eval`, interpreta escapes ni
   permite comentarios, espacios o comillas internas en una referencia de
   imagen.
   Por eso el primer `--poll` posterior sí promueve el primer bundle nuevo.
   Ejecutar inmediatamente `--status` y exigir
   `adopted/adopted-current`. Si la adopción falla, no crear jobs nuevos:
   conservar evidencia, corregir o retirar el controlador y reactivar los dos
   schedules manuales anteriores.

7. En la **interfaz web privada de Dokploy**, página global **Schedules**, dejar
   el filtro en el servidor Dokploy local —sin seleccionar un servidor
   externo— y crear, todavía deshabilitados, tres jobs internos
   `dokploy-server`:

   - `ELEVANT Database CD - Backup`: `jobs/backup.job.sh`, cron
     `15 2 * * *` UTC;
   - `ELEVANT Database CD - Restore Check`:
     `jobs/restore-check.job.sh`, cron `30 4 * * 0` UTC;
   - `ELEVANT Database CD - Poll`: `jobs/poll.job.sh`, cron
     `* * * * *` UTC.

   El poll que coincide con backup o restore-check conserva su lock no
   bloqueante. Los dos jobs de mantenimiento esperan hasta 900 segundos por el
   mismo lock, por lo que una carrera de arranque no les hace perder su única
   ejecución. Si agotan el timeout, el schedule debe quedar fallido y revisarse;
   no se habilita un segundo job paralelo para compensarlo.

   No usar `server`, Application ni Compose Job: cada script debe ejecutarse
   dentro del contenedor Dokploy, donde están montados `/etc/dokploy`,
   `/root/.docker` y el socket Docker. Nunca dejar en paralelo los scripts
   anteriores y los jobs nuevos.

8. En la **terminal SSH del VPS**, ejecutar un único `--poll` manual y exigir
   `succeeded/complete`, SQL healthy, cache `0600` y la secuencia completa.
   Ejecutar después `--backup` y `--restore-check` manuales. Solo cuando los tres
   comandos, `--status` y los logs sanitizados pasen, habilitar en la
   **interfaz web privada de Dokploy** los jobs en este orden: backup,
   restore-check y, al final, poll.

   Tras el reboot, exigir un poll automático *no-op*. Conservar deshabilitados
   los dos schedules legacy hasta observar una ejecución natural correcta del
   backup nuevo y otra del restore-check nuevo; solo entonces pueden eliminarse.

## Actualización segura de un controlador ya adoptado

Este flujo sustituye una revisión del controlador cuando `current.json` y
`last-success.json` ya contienen una baseline aceptada. No es una instalación
inicial y no vuelve a registrar la base viva.

1. En la **interfaz web privada de Dokploy**, deshabilitar exactamente
   `ELEVANT Database CD - Backup`, `ELEVANT Database CD - Restore Check` y
   `ELEVANT Database CD - Poll`. Comprobar en el historial que ninguno está
   `Running` ni en cola antes de tocar archivos.
2. En la **terminal SSH privada**, resolver de nuevo la tarea local de Dokploy,
   ejecutar `--pause` y exigir `paused=true`. Verificar que no existe una
   operación DB/API/Web activa y que todos sus locks canónicos pueden adquirirse
   con `flock -n`; liberarlos inmediatamente. Si algún lock está ocupado, esperar
   a que termine la operación propietaria e iniciar otra vez el checkpoint.
3. Crear un snapshot nuevo `root:root 0700`, con archivos `0600`, que incluya
   `config.env`, el estado completo del controlador, los `.env` y Compose vivos
   de Database y Database Release, y una lista SHA-256 de cada archivo. Registrar
   aparte los IDs, imágenes y estados de SQL, API, AVIAM Web y Public Web. Nunca
   imprimir el contenido de un `.env` ni guardar el snapshot en el repositorio.
4. Extraer el paquete LF del commit aprobado en un directorio temporal y ejecutar
   `install-controller`. El instalador debe informar que conserva `config.env` y
   no puede sustituir ni borrar `state/`. Comparar con `cmp` cada archivo
   versionado instalado contra el paquete y comprobar con `sha256sum -c` que
   configuración, estado y Raw vivos continúan exactos. Ejecutar después
   `verify-runtime --host-container dokploy` y exigir `RUNTIME_OK`.
5. Con el perfil aún pausado, ejecutar `--status` y exigir una copia exacta y
   terminal de `current.json`/`last-success.json`; ejecutar luego `--dry-run`.
   Ambos comandos deben conservar hashes, estados e IDs de contenedor.

   **En una actualización está prohibido ejecutar `--adopt-current`, eliminar o
   editar el estado/cache, editar los Raw vivos o pulsar Deploy.** La adopción es
   un checkpoint de una sola vez; repetirla sobre una baseline ya aceptada
   destruye la trazabilidad del rollout.

6. Reanudar el controlador mientras los tres schedules siguen deshabilitados.
   Ejecutar la aceptación de contención contra el lock DB real con un proceso
   independiente que lo mantenga ocupado de forma breve y controlada:

   - un `--poll` debe fallar inmediatamente por lock ocupado y no ejecutar SQL;
   - `--backup` debe permanecer esperando, adquirir el lock al liberarlo antes
     de 900 segundos y completar exactamente una vez;
   - repetir el mismo ensayo con `--restore-check` y exigir una única verificación
     restaurada correcta.

   El proceso que sostiene el lock debe tener liberación y timeout propios; no
   dejar un `flock` huérfano ni interpretar el timeout del controlador como
   éxito. Los logs y el historial de Dokploy deben distinguir contención,
   timeout y error interno de `flock`.
7. Confirmar de nuevo `current.json == last-success.json`, estado terminal,
   caches íntegros y locks libres. SQL, API y ambas webs deben conservar sus IDs,
   imágenes, health y cero reinicios; el ensayo de mantenimiento no autoriza una
   migración, seed, despliegue ni recreación de esos servicios.
8. Solo después de aceptar toda la evidencia, habilitar en Dokploy y en este
   orden: backup → restore-check → poll. Observar un poll automático natural
   *no-op* sobre el bundle ya aceptado y comprobar que los tres historiales quedan
   sanos, sin ejecuciones superpuestas. En el siguiente reboot controlado, antes
   de reactivar schedules, volver a comparar los archivos instalados con el
   paquete aprobado, ejecutar `verify-runtime` y confirmar que esta semántica de
   contención continúa activa; un poll *no-op* con el lock libre no basta para
   identificar la revisión nueva.
9. Ante cualquier fallo, deshabilitar o conservar deshabilitados los tres
   schedules, pausar el controlador y guardar snapshot, logs y hashes. No
   reanudar, adoptar, editar estado ni desplegar hasta diagnosticar la causa y
   aprobar explícitamente la recuperación.

## Contrato del rollout

Antes del paso 1, en **GitHub desde el navegador del operador**, el cambio debe
estar fusionado y el run DB-owned debe haber publicado un bundle v1 verde. Los
tres payloads, las labels de esquema/bundle y el digest inmutable se validan
antes de mover `development-certified`; un artefacto anterior de solo
`/manifest.json` no sirve para este rollout.

Los schedules manuales anteriores permanecen activos durante instalación,
configuración, `verify-runtime` y `--dry-run`. La ventana sin jobs comienza
justo antes de `--adopt-current`, como indica el paso 6. Si falla ese checkpoint,
se reactivan los schedules anteriores y no se habilita ningún job nuevo. Si
pasa, la baseline queda cacheada y el rollout avanza solo hacia el primer poll
manual y la habilitación ordenada backup → restore-check → poll. No se elimina
estado, no se repunta el alias y no se edita un intento para forzar el avance.

## Operación

**Terminal: sesión SSH privada del VPS.** Los comandos siguientes se ejecutan
dentro de la única tarea local activa de Dokploy. Se declara
`resolve_dokploy_task` como en el paso 5, se resuelve un ID nuevo antes de cada
operación y luego se ejecuta:

```bash
DOKPLOY_CONTAINER_ID="$(resolve_dokploy_task)" &&
sudo docker container exec "$DOKPLOY_CONTAINER_ID" \
  /etc/dokploy/elevant/database-cd/elevant-database-cd --status

# Sustituir --status por --pause, --resume o:
# --retry sha256:REPLACE_FAILED_DIGEST
```

`--retry` solo acepta el bundle fallido que todavía anuncia el alias. Si ya
hay una publicación corregida, se usa `--poll`. Pausar hace que poll, backup y
restore-check terminen correctamente sin ejecutar SQL.

El estado persistente queda en `state/current.json`, `state/last-success.json` y
`state/attempts/`. El log propio solo contiene códigos/etapas no secretos. La
salida de los contenedores permanece en el historial del job Dokploy.

Los Compose certificados quedan en
`state/compose/database/<sha256>.yml` y
`state/compose/release/<sha256>.yml`. El controlador comprueba propietario,
modo `0600` y hash cada vez que los carga. Ejecuta estos archivos cacheados, no
el YAML Raw vivo. Renderiza candidato y Raw vivo con todos los perfiles, sin
interpolación, resolución de entorno ni resolución de paths, y compara el hash
de un JSON canónico. Por eso un comentario o reordenamiento no genera drift,
pero un cambio efectivo de servicios, imágenes, comandos, redes, volúmenes o
permisos falla cerrado. No elimine manualmente una entrada referenciada por
`last-success.json`.

`last-success.json` se escribe como registro canónico solo después de terminar
todas las etapas. Si el proceso se interrumpe entre las escrituras atómicas
finales, el siguiente poll reconcilia `current.json`/`attempts/` desde ese estado
ya aceptado sin repetir SQL, backup ni restore-check.

Estados terminales explícitos de una entrega:

- `adopted/adopted-current`: baseline viva adoptada una sola vez, sin consumir
  el alias;
- `succeeded/complete`: promoción completa y única fuente para jobs posteriores;
- `failed/<etapa>`: intento detenido, sin retry automático. Un estado `running`
  encontrado por otro poll se convierte en `failed/interrupted` y también exige
  decisión manual.

Un candidato con `runId` anterior o igual, un digest ya aceptado, un digest ya
fallido o un controlador pausado terminan como *no-op* sin SQL. Un error al
validar el bundle antes de crear el intento devuelve error y tampoco cambia la
baseline aceptada; como no existe todavía un intento terminal, el poll periódico
puede volver a descargar y validar ese candidato. Investigue el alias si el
mismo error se repite.

## Estado vivo de referencia

El rollout Development fue aceptado manualmente el 2026-08-31 UTC con el
controlador del merge `e4ae11c7bb8ba8f9c75d8f3d82c199736dc57878` y el bundle
`sha256:bd385ea1bd736d9ecd58fb3deddb75f50eb5a51755e34e4c857546bc21d4cd26`
del commit fuente `5c6af693f4fc80e9cccabdb1b0fc0aefd865e20f`. La promoción, los dos jobs
operativos, los *no-op* periódicos y la persistencia tras reboot pasaron. El PAT
opcional de commit status y los heartbeats externos específicos de DB no están
configurados; el heartbeat base de Beszel continúa activo y la revisión diaria
de Dokploy/Beszel es el control temporal acordado.

## Validación local

En Ubuntu 24.04:

```bash
bash -n elevant-database-cd install-controller verify-runtime jobs/*.sh tests/*.sh
node --check manifest-tool.mjs
node --check compose-model-tool.mjs
node --check state-tool.mjs
shellcheck elevant-database-cd install-controller verify-runtime jobs/*.sh tests/*.sh
bash tests/test-controller.sh
bash tests/test-verify-runtime.sh
```

La prueba usa Docker y curl simulados; no necesita SQL, GHCR, credenciales ni
red y no modifica un host real.
