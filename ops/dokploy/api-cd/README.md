# Controlador privado de API CD

Este paquete define el despliegue *pull-based* de `Elevant.Api` en Development.
Es una plantilla revisable y secret-free: no autoriza al agente a conectarse al
VPS. El operador instala y valida cada checkpoint manualmente por SSH privado.

## Contrato

- `development-certified` se usa solo para descubrir un bundle. El controlador
  resuelve el tag a digest y nunca despliega un tag mutable.
- El bundle contiene exactamente `/manifest.json` y
  `/compose/compose.development.api.yml`. Se verifican su forma cerrada, hash,
  repo/ref/commit/run, endpoints, labels OCI y referencias GHCR `@sha256`.
- La API solo se promueve si el controlador de Database CD registra un estado
  `succeeded/complete`. Se acepta el bundle DB requerido exacto o uno con
  `runId` posterior y las mismas huellas de migraciones y modelo. Una DB más
  antigua o incompatible deja el candidato esperando, sin modificar Compose.
- El lock de Database CD se adquiere antes del lock de API CD. Así una
  migración, backup o restore-check nunca corre a la vez que un rollout API.
  El job programado espera 15 segundos después del inicio del minuto para que
  el poll normal de Database CD tome y libere primero ese lock. Si una operación
  DB dura más, el lock sigue cerrando el paso y API CD reevalúa al minuto
  siguiente.
- El Compose certificado debe ser semánticamente idéntico al Raw revisado en
  Dokploy. Los secretos permanecen en su `.env` `root:root 0600`; el controlador
  solo reemplaza atómicamente `ELEVANT_API_IMAGE` y nunca imprime el archivo.
- Tras `compose up`, se exige un único contenedor `api`, health Docker
  `healthy` y un smoke interno de health, readiness, ping y OpenAPI ejecutado en
  el namespace de red de ese contenedor. El loopback del host se verifica como
  checkpoint manual porque el job corre dentro de Dokploy. Un fallo restaura el
  par certificado de imagen y Compose/hash de la última baseline saludable. Si
  el rollback falla, el controlador se pausa automáticamente.
- Un digest fallido o interrumpido exige `--retry` explícito. No hay retry
  automático, rollback de esquema, exposición pública ni edición de la DB.

## Bundle API v1

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
    "api": "ghcr.io/owner/elevant-api@sha256:..."
  },
  "compose": {
    "apiSha256": "64-lowercase-hex"
  },
  "database": {
    "requiredManifest": "ghcr.io/owner/elevant-db-release-manifest@sha256:...",
    "requiredRunId": "122",
    "migrationFingerprint": "sha256:...",
    "modelFingerprint": "sha256:..."
  },
  "endpoints": {
    "containerPort": 8080,
    "livenessPath": "/health",
    "readinessPath": "/health/ready",
    "pingPath": "/api/v1/system/ping",
    "swaggerPath": "/swagger/v1/swagger.json"
  },
  "publishedAt": "2026-08-31T00:00:00Z"
}
```

El artefacto exige estas labels además de revision/source OCI:

```text
org.elevant.api.environment=Development
org.elevant.api.manifest.schema=1
io.elevant.api-release.bundle-version=1
io.elevant.api-release.media-type=application/vnd.elevant.api-release-bundle.v1
```

## Instalación manual

Antes de empezar, el resource Compose de la API ya debe existir en Dokploy con
Provider Raw, AutoDeploy deshabilitado, sin Domain ni Traefik, y su `.env` debe
ser `root:root 0600`. El Compose publica solamente
`127.0.0.1:18080 -> 8080` y conecta las redes externas
`elevant-dev-data` y `elevant-dev-api-runtime`.

1. Desde PowerShell local, empaquetar blobs del commit aprobado con LF:

   ```powershell
   $commit = git rev-parse HEAD
   $archive = "ELEVANT-api-cd-$($commit.Substring(0, 12))-lf.tar.gz"
   git -c core.autocrlf=false archive --format=tar.gz `
     --prefix=api-cd/ --output=$archive `
     "${commit}:ops/dokploy/api-cd"
   Get-FileHash -Algorithm SHA256 $archive
   ```

2. Transferir, verificar SHA-256, extraer en un directorio temporal del VPS y
   ejecutar manualmente:

   ```bash
   sudo bash ./install-controller
   ```

   El instalador preserva `config.env` y estado existentes. Nunca crea un job
   ni despliega. Tampoco requiere Node.js en el host: limita su validación local
   a inventario, permisos y sintaxis shell. Los `node --check` se ejecutan en el
   runtime privado de Dokploy mediante `verify-runtime` en el paso siguiente.

3. Completar `/etc/dokploy/elevant/api-cd/config.env` sin incluir secretos y
   mantenerlo `root:root 0600`. Las rutas Database deben apuntar al controlador
   ya certificado; la conexión SQL permanece exclusivamente en el `.env` API.

4. Validar el runtime real desde el host:

   ```bash
   sudo /etc/dokploy/elevant/api-cd/verify-runtime --host-container dokploy
   ```

   Debe devolver `RUNTIME_OK`. No instala dependencias.

5. Resolver la única tarea Dokploy y ejecutar el dry-run dentro de ella:

   ```bash
   DOKPLOY_TASK="$(sudo docker container ls --quiet --no-trunc \
     --filter status=running \
     --filter 'label=com.docker.swarm.service.name=dokploy')"
   [[ "$DOKPLOY_TASK" =~ ^[0-9a-f]{64}$ ]] &&
   sudo docker container exec "$DOKPLOY_TASK" \
     /etc/dokploy/elevant/api-cd/elevant-api-cd --dry-run
   ```

6. Después de desplegar manualmente el primer digest certificado y verificar
   su acceso privado, registrar la baseline una sola vez:

   ```bash
   sudo docker container exec "$DOKPLOY_TASK" \
     /etc/dokploy/elevant/api-cd/elevant-api-cd --adopt-current
   ```

7. Crear en la UI privada global de Dokploy un schedule interno, inicialmente
   deshabilitado:

   - nombre: `ELEVANT API CD - Poll`;
   - cron: `* * * * *`, UTC;
   - script: contenido exacto de `jobs/poll.job.sh`;
   - servidor: `dokploy-server`, no Application/Compose Job.

   El script versionado aplica un desfase fijo de 15 segundos frente al poll de
   Database CD, que también inicia en `:00`. No añada otro `sleep` en la UI.

8. Ejecutar `--poll` manual. El bundle actual debe ser no-op o completar un
   rollout. Revisar `--status`, logs, contenedor healthy y listener loopback.
   Solo entonces habilitar el schedule. Después de un reboot controlado, exigir
   otro poll no-op y persistencia del servicio Tailscale de la API.

No se publica el panel, SQL ni el puerto 18080 a Internet. Tailscale Serve es
el único consumidor del listener loopback.

## Operación

```bash
sudo docker container exec "$DOKPLOY_TASK" \
  /etc/dokploy/elevant/api-cd/elevant-api-cd --status

# Operaciones administrativas:
# --pause
# --resume
# --retry sha256:REPLACE_FAILED_API_BUNDLE_DIGEST
```

El estado vive en `state/current.json`, `state/last-success.json`,
`state/attempts/` y `state/compose/api/`, todo root-only. El log propio contiene
solo etapas e identidades no secretas. `--retry` funciona únicamente para el
digest fallido que aún anuncia el alias; un bundle corregido se procesa con el
poll normal.

## Validación local

En Ubuntu 24.04:

```bash
bash -n elevant-api-cd install-controller verify-runtime tests/*.sh
/bin/sh -n jobs/*.sh
node --check manifest-tool.mjs
node --check state-tool.mjs
node --check compose-model-tool.mjs
node --check env-tool.mjs
shellcheck elevant-api-cd install-controller verify-runtime jobs/*.sh tests/*.sh
bash tests/test-tools.sh
bash tests/test-install-controller.sh
bash tests/test-poll-job.sh
bash tests/test-verify-runtime.sh
```

Las pruebas no necesitan red, GHCR, SQL ni credenciales y no modifican un host
real. Pasarlas no autoriza un despliegue.
