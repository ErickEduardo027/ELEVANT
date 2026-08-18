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

Cancele cualquier timer usado durante el upgrade. Inmediatamente antes del
reboot, arme un rollback nuevo siguiendo el README del firewall y compruebe su
próxima ejecución. Después:

```bash
sudo systemctl reboot
```

Dentro de los diez minutos del boot, abra dos sesiones nuevas por Tailscale y
valide `sudo`, Dokploy privado, firewall, Docker, landing, swap y estado de
reboot. Solo entonces cancele el timer:

```bash
sudo systemctl is-active containerd docker tailscaled elevant-firewall
swapon --show
sysctl vm.swappiness
test ! -e /var/run/reboot-required
sudo /usr/local/sbin/elevant-preflight
```

No restaure el snapshot por un fallo menor sin guardar antes evidencia. Si se
pierde conectividad, deje actuar el rollback y use el Browser Terminal; el
snapshot frío es el último recurso y revierte todo el VPS.
