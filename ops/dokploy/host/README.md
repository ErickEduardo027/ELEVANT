# Parches, swap y reboot del host

Este runbook cubre únicamente Ubuntu/Docker y memoria virtual del VPS
Development. Se ejecuta después del firewall transitorio y antes de actualizar
Traefik. Requiere snapshot frío, Browser Terminal, Tailscale/SSH privados y un
rollback del firewall conforme a [`../firewall/README.md`](../firewall/README.md).

## Preflight read-only

```bash
sudo /usr/local/sbin/elevant-preflight | tee \
  "/run/elevant-preflight-before-patch-$(date -u +%Y%m%dT%H%M%SZ).log"
sudo apt-get update
apt list --upgradable
apt-mark showhold
sudo apt-get --simulate --with-new-pkgs upgrade
```

El host auditado tenía únicamente `cloud-init` en hold. Deténgase si aparece otro
hold, una remoción, cambio de edición/repositorio, paquete no reconocido o falta
de espacio. No ejecute `autoremove`, `dist-upgrade`, scripts `curl | sh` ni retire
el hold de `cloud-init`.

## Aplicar actualizaciones revisadas

Después de revisar la simulación:

```bash
sudo env DEBIAN_FRONTEND=noninteractive apt-get \
  --yes \
  --with-new-pkgs \
  -o Dpkg::Options::=--force-confold \
  upgrade
```

`--force-confold` conserva la configuración local; no convierte un prompt o un
error en éxito. El upgrade puede reiniciar Docker/containerd y causar una breve
interrupción. Al terminar, exija:

```bash
sudo systemctl is-active containerd docker tailscaled elevant-firewall
docker version
docker compose version
docker service ls
docker ps --format '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'
sudo /usr/local/sbin/elevant-preflight
```

Dokploy/Postgres deben quedar `1/1`, Traefik running y el firewall debe conservar
ambas cadenas `DOCKER-USER`. No continúe si Docker cambió a un backend distinto
de `iptables-nft` o si una red/volumen desapareció.

## Crear swap de 2 GiB una sola vez

Primero demuestre que no existe swap ni artefactos previos:

```bash
swapon --show
test ! -e /swapfile
test ! -e /etc/sysctl.d/90-elevant-memory.conf
! grep -Eq '^[^#]+[[:space:]]+none[[:space:]]+swap[[:space:]]' /etc/fstab
```

Si cualquiera de las tres pruebas falla, inventarie y deténgase. Para una
instalación nueva:

```bash
sudo cp --archive /etc/fstab /etc/fstab.elevant-before-swap
sudo fallocate -l 2G /swapfile
sudo chmod 0600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
printf '%s\n' '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
printf '%s\n' 'vm.swappiness=10' | \
  sudo tee /etc/sysctl.d/90-elevant-memory.conf >/dev/null
sudo sysctl --system
```

Valide antes de reiniciar:

```bash
stat -c 'owner=%U:%G mode=%a size=%s path=%n' /swapfile
swapon --show --bytes
sysctl vm.swappiness
findmnt --verify --verbose
```

El archivo debe ser `root:root`, modo `600`, tamaño 2 GiB; swappiness debe ser
`10` y `findmnt` no debe reportar errores.

## Reboot con recuperación armada

Cancele cualquier timer usado durante el upgrade. Para el reboot final del plano
Development ya desplegado, abra primero una ventana de quiescencia en la
**interfaz web privada de Dokploy**: deshabilite estos seis schedules exactos y
compruebe que ninguno está `Running` ni en cola:

- `ELEVANT Database CD - Backup`;
- `ELEVANT Database CD - Restore Check`;
- `ELEVANT Database CD - Poll`;
- `ELEVANT API CD - Poll`;
- `ELEVANT AVIAM Web CD - Poll`;
- `ELEVANT Public Web CD - Poll`.

En la **terminal SSH privada**, exija después que los locks canónicos de
Database, API y Web estén libres, que los cuatro controladores/perfiles tengan
estado terminal y que cada `current.json` sea idéntico a su
`last-success.json`. No reinicie mientras exista un job activo, un lock ocupado,
un estado `running`/`failed` o copias divergentes. Pause Database CD, API CD,
AVIAM Web CD y Public Web CD; exija los cuatro estados `paused=true` y vuelva a
comprobar todos los locks antes de continuar.

Solo entonces arme un rollback temporizado nuevo siguiendo el README del
firewall y compruebe que está `enabled`, `active` y tiene próxima ejecución.
Después:

```bash
sudo systemctl reboot
```

Dentro de los diez minutos del boot, mantenga los seis schedules deshabilitados,
abra dos sesiones nuevas por Tailscale y valide `sudo`, Dokploy privado,
firewall, Docker/Swarm, los cuatro contenedores de aplicación healthy, listeners
loopback, estados/cache y los cuatro perfiles aún pausados, Services, HTTPS
autorizado, Funnel apagado, landing, swap y estado de reboot. Compare además los
archivos instalados de cada controlador con su paquete aprobado y repita cada
`verify-runtime`; Database CD debe conservar soporte de timeout y código de
conflicto de `flock`:

```bash
sudo systemctl is-active containerd docker tailscaled elevant-firewall
swapon --show
sysctl vm.swappiness
test ! -e /var/run/reboot-required
sudo /usr/local/sbin/elevant-preflight
```

Con el runtime ya verificado, reanude en orden Database CD → API CD → AVIAM Web
CD → Public Web CD y exija que ningún contenedor sea recreado. Rehabilite después
los jobs en orden de dependencia: Database backup → Database restore-check →
Database poll → API poll → AVIAM poll → Public poll. Observe al menos un *no-op*
automático natural en cada uno de los cuatro polls y confirme que los estados e
IDs de contenedor no cambian. Cancele el timer del firewall **solo después** de
aceptar también esta evidencia. Si falla un checkpoint, conserve deshabilitado
el schedule afectado y todos sus dependientes, pause sus perfiles, guarde
logs/estado y deje actuar la recuperación armada.

No restaure el snapshot por un fallo menor sin guardar antes evidencia. Si se
pierde conectividad, deje actuar el rollback y use el Browser Terminal; el
snapshot frío es el último recurso y revierte todo el VPS.
