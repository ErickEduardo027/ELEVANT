# Reconciliación de Traefik para Dokploy v0.30.0

El VPS auditado ejecuta un contenedor standalone `dokploy-traefik` con Traefik
`3.6.7`. Dokploy no reemplaza automáticamente un Traefik ya existente durante
su propio upgrade. Este procedimiento conserva el contrato observado y cambia
únicamente la imagen a la revisión corregida que requiere Dokploy v0.30.0.

## Contrato observado

No continúe si una inspección nueva difiere de cualquiera de estos puntos:

- contenedor: `dokploy-traefik`, restart policy `always`, no privileged;
- puertos: `80/tcp`, `443/tcp` y `443/udp` en todas las interfaces;
- bind `/etc/dokploy/traefik/traefik.yml:/etc/traefik/traefik.yml`;
- bind `/etc/dokploy/traefik/dynamic:/etc/dokploy/traefik/dynamic`;
- bind read-only `/var/run/docker.sock:/var/run/docker.sock:ro`;
- redes: `bridge` y `dokploy-network`;
- comando: `traefik`.

El sufijo `:ro` impide escribir el archivo socket, pero no convierte la API de
Docker en solo lectura: Traefik conserva la autoridad que expone ese socket. Por
eso el contenedor y su configuración forman parte del plano de control confiable,
no se comparten con usuarios no administradores y se mantienen aislados por
Tailscale y el firewall.

Objetivo inmutable:

```text
traefik:v3.6.25@sha256:31267173a15b4944e797a76ffd9c419707c8d8b32fe5b610f80cd0cfa05f372d
```

El digest anterior para rollback es:

```text
traefik:v3.6.7@sha256:a9890c898f379c1905ee5b28342f6b408dc863f08db2dab20e46c267d1ff463a
```

## Gates previos

Se requiere snapshot frío terminado, Browser Terminal abierto, Dokploy privado
por Tailscale, firewall transitorio, copia local de las sumas SHA-256 de los
archivos bajo `/etc/dokploy/traefik` y un smoke de la landing actual. No copie
configuraciones, dominios o logs al repositorio.

En el VPS, inspeccione sin mostrar variables de contenedores:

```bash
docker inspect dokploy-traefik \
  --format 'image={{.Config.Image}} restart={{.HostConfig.RestartPolicy.Name}} privileged={{.HostConfig.Privileged}}'
docker inspect dokploy-traefik --format '{{json .Mounts}}'
docker inspect dokploy-traefik --format '{{json .HostConfig.PortBindings}}'
docker inspect dokploy-traefik --format '{{json .NetworkSettings.Networks}}'
docker inspect dokploy-traefik --format '{{json .Config.Cmd}}'
sudo find /etc/dokploy/traefik -xdev -type f -exec sha256sum -- {} +
```

## Recreación manual

Defina las referencias en la sesión root del Browser Terminal y precárguelas:

```bash
ELEVANT_TRAEFIK_TARGET='traefik:v3.6.25@sha256:31267173a15b4944e797a76ffd9c419707c8d8b32fe5b610f80cd0cfa05f372d'
ELEVANT_TRAEFIK_ROLLBACK='traefik:v3.6.7@sha256:a9890c898f379c1905ee5b28342f6b408dc863f08db2dab20e46c267d1ff463a'

docker pull "$ELEVANT_TRAEFIK_TARGET"
docker pull "$ELEVANT_TRAEFIK_ROLLBACK"
```

Solo después de comprobar el contrato y ambos pulls, ejecute el reemplazo. La
secuencia usa `create`, conecta la red overlay antes del arranque y nunca toca
los archivos de configuración:

```bash
docker stop --time 30 dokploy-traefik
docker rm dokploy-traefik

docker create \
  --name dokploy-traefik \
  --restart always \
  --publish 80:80/tcp \
  --publish 443:443/tcp \
  --publish 443:443/udp \
  --mount type=bind,src=/etc/dokploy/traefik/traefik.yml,dst=/etc/traefik/traefik.yml \
  --mount type=bind,src=/etc/dokploy/traefik/dynamic,dst=/etc/dokploy/traefik/dynamic \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly \
  "$ELEVANT_TRAEFIK_TARGET"

docker network connect dokploy-network dokploy-traefik
docker start dokploy-traefik
```

## Aceptación

```bash
docker exec dokploy-traefik traefik version
docker inspect dokploy-traefik \
  --format 'image={{.Config.Image}} restart={{.HostConfig.RestartPolicy.Name}} status={{.State.Status}}'
docker inspect dokploy-traefik --format '{{json .NetworkSettings.Networks}}'
docker ps --filter name=^/dokploy-traefik$ \
  --format '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'
```

La versión debe ser exactamente `3.6.25`, el estado `running` y las únicas redes
`bridge`/`dokploy-network`. Repita el smoke de la misma URL de landing y revise
solo errores recientes de providers. Después, desde Dokploy, deshabilite el
Domain de la landing y use **Stop Application**; no elimine la aplicación.

## Rollback

Si falla cualquier validación, repita la secuencia `stop`, `rm`, `create`,
`network connect`, `start` sustituyendo `$ELEVANT_TRAEFIK_TARGET` por
`$ELEVANT_TRAEFIK_ROLLBACK`. Vuelva a exigir `3.6.7`, las dos redes y el smoke
anterior. El rollback restaura disponibilidad, pero vuelve a una versión con
vulnerabilidades conocidas: no avance al despliegue DB hasta corregir la causa
y completar de nuevo el upgrade a `3.6.25`.

## Referencias oficiales

- [Dokploy v0.30.0](https://github.com/Dokploy/dokploy/releases/tag/v0.30.0)
- [Actualización manual de Traefik existente](https://docs.dokploy.com/docs/core/manual-installation#updating-traefik-manually)
- [Traefik v3.6.25](https://github.com/traefik/traefik/releases/tag/v3.6.25)
