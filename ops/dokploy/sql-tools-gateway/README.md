# Gateway privado para herramientas SQL Development

Este directorio define el unico puente autorizado entre Tailscale y SQL Server
Development. El gateway no autentica usuarios, no termina TLS y no contiene
credenciales: HAProxy reenvia TCP sin modificar entre el listener local y
`elevant-dev-sql:1433`. SQL Server sigue aplicando autenticacion, cifrado y
permisos.

## Contrato

- proyecto Compose: `elevant-dev-sql-tools-gateway`;
- servicio: `sql-tools-gateway`;
- listener del host: solo `127.0.0.1:11433/tcp`;
- destino: `elevant-dev-sql:1433` por la red externa e interna
  `elevant-dev-data`;
- imagen oficial HAProxy inmutable y plataforma `linux/amd64`;
- usuario `65534:65534`, raiz de solo lectura, `cap_drop: ALL`,
  `no-new-privileges`, limites de CPU/memoria/PID y logs rotados;
- sin Environment, secretos, Domain, Traefik, `dokploy-network`, AutoDeploy,
  Isolated Deployments, volumen de datos persistente o Funnel;
- configuracion inmutable en `../files/haproxy.cfg`, fuera de `code/`, para
  sobrevivir la regeneracion que Dokploy aplica a cada despliegue Raw.

El puerto `11433` no es un endpoint de usuario. Tailscale Serve es el unico
consumidor autorizado y publica `svc:elevant-dev-sql-tools` como `tcp:1433`.
El puerto directo del host y el `1433` del contenedor SQL permanecen inaccesibles
por la tailnet y por Internet.

## Preparacion manual en Dokploy

1. Confirme que `elevant-dev-data` ya existe, es `bridge`, `internal=true` y
   contiene el alias sano `elevant-dev-sql`.
2. Cree un Compose **Raw** llamado `ELEVANT Development SQL Tools Gateway` sin
   Domain, AutoDeploy ni Isolated Deployments. No reutilice el recurso de la DB.
3. Copie [`compose.yml`](compose.yml) como Compose Raw. Resuelva el `appName`
   asignado por Dokploy y coloque [`haproxy.cfg`](haproxy.cfg), con esos bytes
   exactos, en `/etc/dokploy/compose/<appName>/files/haproxy.cfg`. Ese directorio
   hermano de `code/` es persistente: Dokploy elimina y regenera `code/` antes
   de cada Deploy Raw. No coloque la configuracion dentro de `code/` ni la
   genere desde Environment.
4. Exija `root:root 0700` para `files/` y `root:root 0644` para
   `files/haproxy.cfg`; el archivo no contiene secretos y debe ser legible por
   el UID no privilegiado `65534`. Antes del primer Deploy, reproduzca el layout
   `code/` + `files/` en un directorio temporal root-only y ejecute
   `docker compose config --quiet` sobre una copia aprobada del Compose. Tras el
   Deploy, compare los SHA-256 de `code/docker-compose.yml` y
   `files/haproxy.cfg` con el commit aprobado; no acepte el contenedor antes de
   esa comprobacion.
5. Despliegue una vez manualmente y verifique que el contenedor este `healthy`,
   use una sola red y publique exactamente `127.0.0.1:11433`.

No use `Deploy` o `Rebuild` si falta `../files/haproxy.cfg`: ambos regeneran
`code/` y el despliegue debe fallar cerrado antes de crear el gateway. Restaure
primero el archivo persistente aprobado y vuelva a validar sus bytes y permisos.

No agregue `depends_on` hacia otro proyecto Compose: la comprobacion de salud
espera al backend y el resolver Docker recupera cambios de direccion sin acoplar
los ciclos de vida.

## Publicacion Tailscale

Defina primero `svc:elevant-dev-sql-tools` con endpoint `tcp:1433`, aplique la
politica revisada de [`../tailscale`](../tailscale) y apruebe el host anunciado.
Despues ejecute en el VPS:

```bash
sudo tailscale serve \
  --service=svc:elevant-dev-sql-tools \
  --tcp=1433 \
  tcp://127.0.0.1:11433
```

Compruebe siempre:

```bash
sudo tailscale serve get-config --service=svc:elevant-dev-sql-tools
sudo tailscale serve status
sudo tailscale funnel status
sudo ss -ltnp '( sport = :11433 or sport = :1433 )'
```

El resultado valido contiene `127.0.0.1:11433`, no contiene un listener host
en `1433` y no muestra ninguna configuracion Funnel. Desde un dispositivo
autorizado, SSMS usa
`elevant-dev-sql-tools.<TAILNET_DNS_NAME>.ts.net,1433`; desde una identidad fuera
de `group:elevant-db-editors` y `group:elevant-ops` debe fallar.

## Retirada

Primero retire el endpoint y luego detenga solamente este Compose:

```bash
sudo tailscale serve drain svc:elevant-dev-sql-tools
sudo tailscale serve clear svc:elevant-dev-sql-tools
```

No quite redes o volumenes SQL, no publique temporalmente `1433` y no cambie el
Compose certificado de la base durante este rollback.
