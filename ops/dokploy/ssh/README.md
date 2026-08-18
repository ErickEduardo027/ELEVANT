# Endurecimiento de OpenSSH

Este cambio deja un único usuario remoto, `elevant-ops`, autenticado por clave.
El acceso `root` por SSH y toda autenticación por contraseña quedan desactivados;
el Browser Terminal de Hostinger continúa siendo la recuperación fuera de banda
porque no entra por OpenSSH.

No aplique este drop-in hasta que `elevant-ops` tenga una clave Ed25519 con
passphrase, `sudo` funcional y dos sesiones nuevas comprobadas por Tailscale. El
usuario no pertenece al grupo `docker`.

## Alta del usuario

Genere una clave nueva en el PC del operador; no reutilice la clave temporal de
auditoría. Transfiera **solo** el archivo `.pub` al VPS mediante la sesión de
recuperación existente y guárdelo temporalmente como `/run/elevant-ops.pub`.
Nunca copie la clave privada al servidor, al chat o al repositorio.

Desde el Browser Terminal del VPS:

```bash
sudo adduser --disabled-password --gecos '' elevant-ops
sudo passwd elevant-ops

sudo install -d -o elevant-ops -g elevant-ops -m 0700 \
  /home/elevant-ops/.ssh
sudo install -o elevant-ops -g elevant-ops -m 0600 \
  /run/elevant-ops.pub \
  /home/elevant-ops/.ssh/authorized_keys
sudo rm -f /run/elevant-ops.pub

sudo visudo -cf ops/dokploy/ssh/sudoers.elevant-ops
sudo install -o root -g root -m 0440 \
  ops/dokploy/ssh/sudoers.elevant-ops \
  /etc/sudoers.d/elevant-ops
sudo visudo -cf /etc/sudoers.d/elevant-ops
```

`passwd` define únicamente la contraseña de elevación `sudo`; guárdela en el
password manager. El perfil bootstrap de Hostinger ya debe limitar TCP `22` a la
IP del operador. No añada el usuario a `sudo` ni `docker`: la única autorización
es el archivo sudoers revisado, que exige contraseña.

## Preflight del usuario

Desde el Browser Terminal, compruebe sin mostrar claves:

```bash
id elevant-ops
sudo -l -U elevant-ops
stat -c 'owner=%U:%G mode=%a path=%n' \
  /home/elevant-ops \
  /home/elevant-ops/.ssh \
  /home/elevant-ops/.ssh/authorized_keys
```

Los modos esperados son `750` o más restrictivo para el home, `700` para
`.ssh` y `600` para `authorized_keys`. `sudo -l` debe mostrar el contrato
operativo aprobado, no acceso al grupo Docker.

## Instalación con rollback

Ejecute desde la raíz del checkout. El nombre `00-` es deliberado: OpenSSH usa
el primer valor obtenido y este archivo debe preceder a drop-ins de cloud-init.
La instalación se niega a sobrescribir un archivo existente.

```bash
test ! -e /etc/ssh/sshd_config.d/00-elevant-hardening.conf

sudo install -D -o root -g root -m 0644 \
  ops/dokploy/ssh/00-elevant-hardening.conf \
  /etc/ssh/sshd_config.d/00-elevant-hardening.conf
sudo install -D -o root -g root -m 0755 \
  ops/dokploy/ssh/elevant-ssh-verify \
  /usr/local/sbin/elevant-ssh-verify
sudo install -D -o root -g root -m 0755 \
  ops/dokploy/ssh/elevant-ssh-rollback \
  /usr/local/sbin/elevant-ssh-rollback

sudo /usr/local/sbin/elevant-ssh-verify
sudo systemd-run \
  --unit=elevant-ssh-rollback \
  --on-active=10m \
  --timer-property=AccuracySec=1s \
  --collect \
  /usr/local/sbin/elevant-ssh-rollback
sudo systemctl reload ssh.service
```

No reinicie el VPS mientras este rollback transitorio esté armado: un transient
timer no sobrevive el reboot. Mantenga el Browser Terminal abierto y pruebe en
dos terminales nuevas, no en conexiones preexistentes:

```powershell
ssh elevant-ops@elevant-dev-host
```

En ambas sesiones ejecute `sudo -v`. Confirme además desde una red externa que
la contraseña y `root` son rechazados, sin realizar intentos repetidos.

Si todas las pruebas pasan, cancele el timer y verifique su ausencia antes de
reiniciar:

```bash
sudo systemctl stop elevant-ssh-rollback.timer
sudo systemctl is-active elevant-ssh-rollback.timer
sudo /usr/local/sbin/elevant-ssh-verify
```

La salida esperada del segundo comando es `inactive`. Solo después se permite el
reboot del checkpoint. Si una prueba falla, no cancele el timer; el rollback
elimina exclusivamente el drop-in que contiene el marcador ELEVANT, valida la
configuración base y recarga OpenSSH.

## Rollback manual

Desde el Browser Terminal:

```bash
sudo /usr/local/sbin/elevant-ssh-rollback
```

El rollback se niega a retirar un symlink, un archivo no regular o un archivo
sin el marcador exacto. No modifica otras claves, usuarios ni drop-ins.
