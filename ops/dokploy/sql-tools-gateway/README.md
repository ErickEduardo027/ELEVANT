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
- publicacion host por la bridge externa dedicada y no interna
  `elevant-dev-sql-tools-runtime`; solamente el gateway pertenece a ambas redes
  y `gw_priority` selecciona `runtime` como gateway de red;
- imagen oficial HAProxy inmutable y plataforma `linux/amd64`;
- usuario `65534:65534`, raiz de solo lectura, `cap_drop: ALL`,
  `no-new-privileges`, limites de CPU/memoria/PID y logs rotados;
- sin Environment, secretos, Domain, Traefik, `dokploy-network`, AutoDeploy,
  Isolated Deployments, volumen de datos persistente o Funnel;
- configuracion inmutable en `../files/haproxy.cfg`, fuera de `code/`, para
  sobrevivir la regeneracion que Dokploy aplica a cada despliegue Raw.

La prohibicion de listeners wildcard se aplica al **host**. HAProxy escucha
`bind :11433` dentro de su namespace de red para que Docker pueda reenviar el
binding; el unico listener aceptable del VPS sigue siendo
`127.0.0.1:11433/tcp`.

El puerto `11433` no es un endpoint de usuario. Tailscale Serve es el unico
consumidor autorizado y publica `svc:elevant-dev-sql-tools` como `tcp:1433`.
El puerto directo del host y el `1433` del contenedor SQL permanecen inaccesibles
por la tailnet y por Internet.

Docker Engine no materializa un `ports` solicitado cuando todas las redes del
contenedor son `internal=true`: conserva `HostConfig.PortBindings`, pero deja
`NetworkSettings.Ports` sin mapping efectivo. La segunda bridge es por ello una
frontera de publicacion necesaria, no una via adicional hacia SQL. El binding
Compose explicito y la opcion defensiva de la red mantienen esa publicacion en
loopback aun cuando `runtime` sea no interna. Este comportamiento y la topologia
de dos redes estan documentados en
[`moby/moby#53256`](https://github.com/moby/moby/discussions/53256).

## Preparacion manual en Dokploy

1. Confirme que `elevant-dev-data` ya existe, es `bridge`, `internal=true` y
   contiene el alias sano `elevant-dev-sql`. Verifique tambien que el CIDR
   elegido para `elevant-dev-sql-tools-runtime` no colisiona y cree esa red
   externa como `bridge`, `internal=false`, dedicada exclusivamente al gateway:

   ```bash
   sudo docker network create \
     --driver bridge \
     --subnet <CIDR_APROBADO> \
     --gateway <GATEWAY_APROBADO> \
     --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
     elevant-dev-sql-tools-runtime
   ```

   No conecte SQL, API, webs, Dokploy ni observabilidad a esta red.
2. Exija Docker Compose 2.33.1 o posterior y Docker Engine 28.0.0 o posterior
   para `gw_priority`. Cree un Compose **Raw** llamado
   `ELEVANT Development SQL Tools Gateway` sin
   Domain, AutoDeploy ni Isolated Deployments. No reutilice el recurso de la DB.
3. Suba [`compose.yml`](compose.yml), [`haproxy.cfg`](haproxy.cfg) y
   [`verify-compose-model.py`](verify-compose-model.py) juntos al staging
   restringido `/home/elevant-ops/sql-tools-<REVISION>/`, verificando sus hashes.
   Copie `compose.yml` como Compose Raw. Resuelva el `appName` asignado por
   Dokploy y coloque `haproxy.cfg`, con esos bytes exactos, en
   `/etc/dokploy/compose/<appName>/files/haproxy.cfg`. Ese directorio hermano de
   `code/` es persistente: Dokploy elimina y regenera `code/` antes de cada
   Deploy Raw. No coloque la configuracion dentro de `code/` ni la genere desde
   Environment.
4. Exija `root:root 0700` para `files/` y `root:root 0644` para
   `files/haproxy.cfg`; el archivo no contiene secretos y debe ser legible por
   el UID no privilegiado `65534`. Antes del primer Deploy, reproduzca el layout
   `code/` + `files/` en un directorio temporal root-only y ejecute
   `docker compose config --quiet` sobre una copia aprobada del Compose.
5. Despliegue una vez manualmente y verifique que el contenedor este `healthy`,
   use exactamente `elevant-dev-data` y `elevant-dev-sql-tools-runtime`, y
   publique exactamente `127.0.0.1:11433`. `NetworkSettings.Ports` no puede ser
   `null`; SQL debe continuar solamente en `elevant-dev-data` y la red runtime
   no puede contener otro contenedor.
6. Tras el Deploy, compare byte a byte el SHA-256 de `files/haproxy.cfg` y use
   [`verify-compose-model.py`](verify-compose-model.py) para comparar el modelo
   completo de `code/docker-compose.yml` con el Compose aprobado:

   ```bash
   STAGE=/home/elevant-ops/sql-tools-<REVISION>
   APP=<appName>

   sudo python3 "$STAGE/verify-compose-model.py" \
     --approved-compose "$STAGE/compose.yml" \
     --approved-config "$STAGE/haproxy.cfg" \
     --live-compose "/etc/dokploy/compose/$APP/code/docker-compose.yml" \
     --live-config "/etc/dokploy/compose/$APP/files/haproxy.cfg"
   ```

   El resultado exacto es `SQL_TOOLS_GATEWAY_COMPOSE_MODEL_EXACT`. La herramienta
   usa el mismo nombre de proyecto para ambos modelos y reemplaza solo la ruta
   absoluta del config por su hash. Por eso tolera que Dokploy omita `name`,
   cambie comillas o reformatee YAML, pero falla ante drift real.

## Checkpoint de red posterior al Deploy

No acepte solamente `HostConfig.PortBindings`: el incidente original conservaba
esa intencion pero dejaba `NetworkSettings.Ports` en `null`. El preflight debe
haber guardado, un ID por linea y en el orden `sqlserver`, `api`, `aviam-web`,
`public-web`, el archivo `<SNAPSHOT>/container-ids.before`. Ejecute el checkpoint
completo en un subshell fail-closed y sustituya los tres placeholders:

```bash
( set -euo pipefail
  SNAPSHOT=REPLACE_SNAPSHOT_PATH
  EXPECTED_CIDR=REPLACE_APPROVED_CIDR
  EXPECTED_GATEWAY=REPLACE_APPROVED_GATEWAY

  ID=$(sudo docker ps -q --no-trunc \
    --filter status=running \
    --filter label=com.docker.compose.service=sql-tools-gateway)
  [[ "$ID" =~ ^[0-9a-f]{64}$ ]]

  MAPPING=$(sudo docker port "$ID" 11433/tcp)
  LISTENERS=$(sudo ss -ltnH '( sport = :11433 )' | \
    awk '{print $4}' | sort -u)
  [[ "$MAPPING" == '127.0.0.1:11433' ]]
  [[ "$LISTENERS" == '127.0.0.1:11433' ]]

  CONTRACT=$(sudo docker network inspect -f \
    '{{.Driver}}|{{.Internal}}|{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}|{{(index .IPAM.Config 0).Subnet}}|{{(index .IPAM.Config 0).Gateway}}|{{len .Containers}}' \
    elevant-dev-sql-tools-runtime)
  [[ "$CONTRACT" == \
    "bridge|false|127.0.0.1|$EXPECTED_CIDR|$EXPECTED_GATEWAY|1" ]]

  DEFAULT_ROUTE=$(sudo docker exec "$ID" ip route show default)
  [[ "$DEFAULT_ROUTE" == "default via $EXPECTED_GATEWAY dev "* ]]

  GATEWAY_NETWORKS=$(sudo docker inspect -f \
    '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' \
    "$ID" | sed '/^$/d' | sort)
  [[ "$GATEWAY_NETWORKS" == \
    $'elevant-dev-data\nelevant-dev-sql-tools-runtime' ]]

  SQL_ID=$(sudo docker ps -q --no-trunc \
    --filter status=running \
    --filter label=com.docker.compose.service=sqlserver)
  [[ "$SQL_ID" =~ ^[0-9a-f]{64}$ ]]
  SQL_NETWORKS=$(sudo docker inspect -f \
    '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' \
    "$SQL_ID" | sed '/^$/d' | sort)
  [[ "$SQL_NETWORKS" == 'elevant-dev-data' ]]

  timeout 5 bash -c '</dev/tcp/127.0.0.1/11433'

  workload_ids() {
    local cid service
    for service in sqlserver api aviam-web public-web; do
      cid=$(sudo docker ps -q --no-trunc \
        --filter status=running \
        --filter "label=com.docker.compose.service=$service")
      [[ "$cid" =~ ^[0-9a-f]{64}$ ]]
      printf '%s\n' "$cid"
    done
  }
  [[ "$(workload_ids)" == \
    "$(sudo cat "$SNAPSHOT/container-ids.before")" ]]

  echo SQL_TOOLS_GATEWAY_RUNTIME_EXACT
)
```

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
