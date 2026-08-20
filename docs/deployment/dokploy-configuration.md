# Configuración de Dokploy

Esta guía convierte el VPS Development auditado en un plano de control privado y despliega DB v1. El operador realiza todos los cambios manualmente. El agente entrega un bloque corto, identifica si corresponde a PowerShell, hPanel, VPS o Dokploy y valida la evidencia antes de avanzar.

## Estado aprobado

- Base: commit `1281bd139709898f220c90f12ff27036a6a83b93` de `Development`.
- Dokploy: mantener `v0.30.0` o una revisión posterior expresamente auditada.
- Traefik objetivo: `traefik:v3.6.25@sha256:31267173a15b4944e797a76ffd9c419707c8d8b32fe5b610f80cd0cfa05f372d`.
- SQL: Development sintético únicamente; Production no se crea en este VPS.
- Landing existente: se preserva, se deshabilita su Domain y se detiene; no se elimina.
- Acceso inicial: un operador `elevant-ops`; los desarrolladores solo recibirán acceso a API/webs cuando existan.

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
6. Desplegar `elevant-dev-observability`, publicar solo `svc:elevant-dev-monitoring` y probar Telegram/Healthchecks.
7. Crear el snapshot post-hardening.

La observabilidad v1 no recibe `docker.sock`: muestra métricas del host, no
secretos ni inventario de contenedores. SQL health, backup y restore-check usan
heartbeats separados cuando se despliega DB.

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
  backend/infrastructure/docker/compose.development.database.yml `
  backend/infrastructure/docker/compose.development.release.yml
Expand-Archive -LiteralPath $archivePath -DestinationPath $exportDirectory

Get-FileHash -Algorithm SHA256 `
  (Join-Path $exportDirectory 'backend/infrastructure/docker/compose.development.database.yml'), `
  (Join-Path $exportDirectory 'backend/infrastructure/docker/compose.development.release.yml')
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

Generar en el PC siete passwords SQL distintos de 40–48 caracteres y un password demo de 32 caracteres. Guardarlos en un password manager y en los Environment separados de Dokploy. Excluir espacios, `$`, comillas, punto y coma, `#` y saltos de línea para evitar ambigüedad de Compose/connection string.

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
- Fuente: `backend/infrastructure/docker/compose.development.database.yml`.
- SHA-256: `dd29e07fcf92b95b4f0d2b45ac7a288290f862068cbf9360a9c856a962a2a1ee`.
- Resultado: storage init/provisioner `Exit 0`, SQL healthy, marker Development singleton, `sa` deshabilitado y ningún 1433 público.
- Ejecutar backup y restore-check manuales antes de migrar; ambos deben terminar cero.

### Proyecto `elevant-dev-database-release`

- Provider Raw, Compose separado, manual, sin AutoDeploy, Domain o `dokploy-network`.
- Fuente: `backend/infrastructure/docker/compose.development.release.yml`.
- SHA-256: `bd8fbded7339f87c71bb7e4058427581f58417602b8e37ebd0e90a0d1e79fd07`.
- `migrator Exit 0` precede a `seeder-development Exit 0`.
- Repetir seed para idempotencia y ejecutar `verify-development`, backup y restore-check.
- Nunca editar `__EFMigrationsHistory` ni ejecutar Down automáticamente.

### Programación

- Backup diario: 02:15 UTC.
- Restore-check: domingos 04:30 UTC.
- Retención local: siete backups.
- Sin solapamiento, `set -x` ni secretos duplicados.

Estos backups son suficientes solo mientras Development sea sintético y reconstruible.

## Aceptación

- Dokploy y monitoreo funcionan solo por Tailscale.
- Traefik es 3.6.25 y la landing permanece guardada en cero réplicas.
- SSH público y contraseñas SSH fallan; `elevant-ops` privado y el Browser Terminal fuera de banda funcionan.
- El único ingreso público es ICMP/ICMPv6 y UDP 41641.
- Firewall, Serve y Docker sobreviven un reboot.
- SQL está healthy, sin puerto público y solo en `elevant-dev-data`.
- Migración, seed idempotente, permisos, backup y restore-check pasan.
- Quedan más de 2 GiB de memoria disponible y 15 GB de disco libre, sin OOM.

## Rollback

- Firewall host: rollback temporizado que valida y elimina solo `table inet elevant_firewall`.
- Hostinger: desactivar el perfil.
- SSH: retirar solo el drop-in desde Browser Terminal.
- Traefik: recrear temporalmente con el digest auditado 3.6.7.
- Landing: Start Application y habilitar Domain.
- DB: detener Compose conservando red y volúmenes.
- Snapshot: último recurso; restaura todo el VPS y pierde cambios posteriores.
