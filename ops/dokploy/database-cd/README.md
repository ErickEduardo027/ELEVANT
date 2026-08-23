# Controlador privado de Database CD

Este directorio define el controlador *pull-based* de la base Development. Es
una plantilla revisable: no autoriza a un agente a instalarla, modificar
Dokploy ni desplegar una migración. El operador realiza cada cambio remoto y
valida su checkpoint.

## Contrato de seguridad

- El tag `development-certified` sirve solo para descubrir una publicación.
  El controlador resuelve su digest, extrae `/manifest.json` desde esa identidad
  inmutable y ejecuta exclusivamente imágenes `@sha256` declaradas y validadas.
- Solo acepta `ErickEduardo027/ELEVANT`, `refs/heads/Development`, ambiente
  `Development`, etiquetas OCI coincidentes, hashes exactos de ambos Compose y
  huellas/migraciones con formato canónico.
- Un lock compartido serializa promoción, backup y restore-check. Los estados se
  escriben con `fsync` y reemplazo atómico. Un manifiesto fallido o interrumpido
  no se reintenta automáticamente. El lock vive dentro del directorio de estado
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

## Manifiesto certificado v1

El artefacto OCI es una imagen mínima con `CMD ["/manifest.json"]`, las etiquetas
`org.opencontainers.image.revision`, `org.opencontainers.image.source`,
`org.elevant.database.environment=Development`,
`org.elevant.database.manifest.schema=1`,
`io.elevant.database-release.schema-version=1` y
`io.elevant.database-release.media-type=application/vnd.elevant.database-release-manifest.v1+json`.
El JSON, que valida explícitamente `Development`, tiene esta forma exacta:

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

Las claves extra, tags de imagen, mayúsculas en digests, migraciones vacías o
desordenadas y cualquier discrepancia de identidad se rechazan antes de SQL.

## Instalación manual, un checkpoint a la vez

La ruta operativa normal empieza en **PowerShell local** y entra por SSH privado
de Tailscale:

```powershell
$commit = git rev-parse HEAD
$archive = "ELEVANT-database-cd-$($commit.Substring(0, 12)).tar.gz"
git -c core.autocrlf=false archive `
  --format=tar.gz `
  --prefix=database-cd/ `
  --output=$archive `
  "${commit}:ops/dokploy/database-cd"
Get-FileHash -Algorithm SHA256 $archive

ssh -i "$HOME/.ssh/elevant_ops_ed25519" elevant-ops@elevant-dev-host
```

La exportación usa los blobs del commit aprobado, impone LF aunque el PC sea
Windows y añade un único prefijo `database-cd/`. El hash se compara después de
la transferencia y antes de extraer; no se empaqueta la copia de trabajo.

Los comandos Linux siguientes se ejecutan dentro de esa **sesión SSH** con
`sudo`. La terminal root de Hostinger queda exclusivamente como recuperación si
Tailscale u OpenSSH no están disponibles.

1. Extraer el paquete revisado en un directorio temporal y ejecutar:

   ```bash
   sudo bash ./install-controller
   ```

   El instalador solo copia el controlador, sus helpers y las plantillas de job
   a `/etc/dokploy/elevant/database-cd`; no habilita jobs ni despliega.
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

4. Antes de crear cualquier job, en la **sesión SSH privada** ejecutar el
   preflight read-only del runtime real:

   ```bash
   sudo /etc/dokploy/elevant/database-cd/verify-runtime --host-container dokploy
   ```

   Debe devolver `RUNTIME_OK`. Comprueba dentro del contenedor `bash`, `docker`,
   el plugin Compose, `node`, `curl`, `flock`, `sha256sum` y las utilidades base
   usadas por escrituras atómicas; también el daemon Docker, `/etc/dokploy` y
   `/root/.docker`. No instala nada. Si
   falta una dependencia, el poller **no se habilita**: se detiene el checkpoint
   y se prepara un runtime de controlador versionado; nunca se instala un paquete
   manual dentro del contenedor Dokploy porque desaparecería al actualizarlo.
   El argumento puede ser un contenedor exacto o el nombre de un servicio
   Swarm. Para un servicio, el verificador exige exactamente una tarea local
   activa y ejecuta su ID completo; cero o varias tareas detienen el checkpoint.

5. Dentro de esa misma **sesión SSH**, declarar este resolvedor *fail-closed* y
   ejecutar el controlador en la única tarea local activa de Dokploy:

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

6. Para registrar la v1 ya desplegada, ejecutar conscientemente:

   ```bash
   DOKPLOY_CONTAINER_ID="$(resolve_dokploy_task)" &&
   sudo docker container exec "$DOKPLOY_CONTAINER_ID" \
     /etc/dokploy/elevant/database-cd/elevant-database-cd --adopt-current
   ```

   Este comando **no consume el alias candidato**. Lee exclusivamente
   `ELEVANT_DB_OPS_IMAGE` del `.env` Database y `ELEVANT_DB_RELEASE_IMAGE` del
   `.env` Database Release; exige referencias `@sha256`, revisiones/labels OCI
   coherentes, calcula los hashes de ambos Compose y ejecuta
   `verify-development`, backup y restore-check. Solo después guarda el baseline.
   Por eso el primer `--poll` posterior sí promueve el primer manifiesto nuevo.

7. En la página global **Schedules**, dejar el filtro en el servidor Dokploy
   local —sin seleccionar un servidor externo— y crear un job de tipo interno
   `dokploy-server`, inicialmente deshabilitado, con cron `* * * * *`, timezone
   UTC y el contenido de `jobs/poll.job.sh`. No usar `server`, Application ni
   Compose Job: el script debe ejecutarse dentro del contenedor Dokploy, donde
   están montados `/etc/dokploy`, `/root/.docker` y el socket Docker. Ejecutarlo
   manualmente una vez, revisar `--status`, los logs y SQL; solo entonces
   habilitarlo.

8. Reemplazar los jobs existentes por jobs internos `dokploy-server` con
   `jobs/backup.job.sh` (cron `15 2 * * *`) y
   `jobs/restore-check.job.sh` (cron `30 4 * * 0`). De este modo los tres jobs
   usan el mismo lock y el último digest aceptado. Nunca dejar en paralelo los
   scripts antiguos ni programarlos en el recurso Compose.

## Operación

Los comandos siguientes se ejecutan dentro de la única tarea local activa de
Dokploy desde la sesión SSH. Se declara `resolve_dokploy_task` como en el paso 5,
se resuelve un ID nuevo antes de cada operación y luego se ejecuta:

```bash
DOKPLOY_CONTAINER_ID="$(resolve_dokploy_task)" &&
sudo docker container exec "$DOKPLOY_CONTAINER_ID" \
  /etc/dokploy/elevant/database-cd/elevant-database-cd --status

# Sustituir --status por --pause, --resume o:
# --retry sha256:REPLACE_FAILED_DIGEST
```

`--retry` solo acepta el manifiesto fallido que todavía anuncia el alias. Si ya
hay una publicación corregida, se usa `--poll`. Pausar hace que poll, backup y
restore-check terminen correctamente sin ejecutar SQL.

El estado persistente queda en `state/current.json`, `state/last-success.json` y
`state/attempts/`. El log propio solo contiene códigos/etapas no secretos. La
salida de los contenedores permanece en el historial del job Dokploy.

`last-success.json` se escribe como registro canónico solo después de terminar
todas las etapas. Si el proceso se interrumpe entre las escrituras atómicas
finales, el siguiente poll reconcilia `current.json`/`attempts/` desde ese estado
ya aceptado sin repetir SQL, backup ni restore-check.

## Validación local

En Ubuntu 24.04:

```bash
bash -n elevant-database-cd install-controller verify-runtime jobs/*.sh tests/*.sh
node --check manifest-tool.mjs
node --check state-tool.mjs
shellcheck elevant-database-cd install-controller verify-runtime jobs/*.sh tests/*.sh
bash tests/test-controller.sh
bash tests/test-verify-runtime.sh
```

La prueba usa Docker y curl simulados; no necesita SQL, GHCR, credenciales ni
red y no modifica un host real.
