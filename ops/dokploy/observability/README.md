# Observabilidad privada de ELEVANT Development

Este directorio define `elevant-dev-observability`: Beszel Hub y su agente local, protegidos por Tailscale y desplegados manualmente desde [`compose.yml`](compose.yml) como Docker Compose normal en Dokploy. No crea dominios de Dokploy, no usa `dokploy-network` y no autoriza un despliegue automático.

## Contrato de seguridad

| Componente | Acceso | Límite |
| --- | --- | --- |
| Beszel Hub | `127.0.0.1:18083` hacia el puerto interno `8090` | `256 MB`, `0.20 CPU` |
| Beszel Agent | WebSocket saliente a `http://127.0.0.1:18083` | `128 MB`, `0.10 CPU` |

El agente tiene `DISABLE_SSH=true`: no abre `45876`. Hub y agente se ejecutan como UID no-root `65532`; ambos y el init usan raíz de solo lectura, `no-new-privileges`, capabilities mínimas y logs rotados. El servicio corto `beszel-volume-init` solo asigna la propiedad de los dos volúmenes persistentes y termina con `Exit 0`. El único servicio conectado al bridge administrado `elevant-dev-observability-runtime` es el Hub; el agente usa la red del host y el init no tiene red.

Ningún servicio monta `/var/run/docker.sock` ni accede a la API de Docker. El agente fija `DOCKER_HOST` a la cadena vacía, mecanismo soportado por Beszel v0.18.8 para desactivar por completo su administrador Docker. Por tanto, esta versión muestra métricas del host, pero no inventario, métricas, health ni logs por contenedor.

No sustituya este aislamiento por un proxy genérico con `CONTAINERS=1`: esa familia también permite inspeccionar `Config.Env` y leer rutas sensibles como logs, archive o export. Las métricas por contenedor solo podrán habilitarse tras implementar y revisar una allowlist real por ruta y método que niegue inspect, logs, archive, export y toda mutación.

Las identidades de despliegue, verificadas el 18 de agosto de 2026, son:

```text
docker.io/henrygd/beszel:0.18.8@sha256:4c51486968efa0b0a702c1b0967966a2e06fb250b7418f3072d2488faea27c51
docker.io/henrygd/beszel-agent:0.18.8@sha256:3b1939746690e423072b4a99bf4c4af6dd9562a68978a33738a3c4a4cc000c39
ghcr.io/tecnativa/docker-socket-proxy:v0.5.0@sha256:1f5038b54f06c3e18422902cf00ba21803d1c97805aae032e5e6673d532d3459  # solo init
```

Los tags solo documentan la versión; los digests son la identidad efectiva. Una actualización requiere PR, nuevos digests y repetición de estas validaciones.

## Secretos y prerrequisitos

Antes de crear el Compose deben estar terminados el enrolamiento Tailscale y el checkpoint previo al firewall descritos en [`../tailscale/README.md`](../tailscale/README.md). `svc:elevant-dev-monitoring` debe existir y solo `group:elevant-ops` debe tener grant a `tcp:443`.

Copie los nombres de [`.env.example`](.env.example) al **Environment protegido de Dokploy**, pero nunca guarde un `.env` real en el repositorio. Los valores sensibles son:

- `BESZEL_AGENT_TOKEN`, generado por **Add System** en el Hub;
- `BESZEL_HEARTBEAT_URL`, generado por Healthchecks.io;
- la URL `telegram://...`, que se guarda posteriormente en Beszel.

`BESZEL_AGENT_KEY` es la clave pública mostrada por Beszel, pero se administra junto con el token para evitar errores. No configure `USER_EMAIL`, `USER_PASSWORD`, `AUTO_LOGIN` ni `TRUSTED_AUTH_HEADER`. La cuenta administradora se crea de forma interactiva y su contraseña vive únicamente en el password manager. En Beszel v0.18.8, `USER_CREATION=false` impide altas posteriores mediante OAuth, pero no bloquea el endpoint especial de primera ejecución: este solo existe mientras no haya usuarios y desaparece después de crear el administrador inicial. Este flujo fue verificado contra la imagen fijada.

## Despliegue manual en Dokploy

### 1. Crear los volúmenes una sola vez

Ejecute este bloque en la **Terminal VPS** solo para una instalación nueva. Falla si encuentra estado previo; en ese caso inventarie los volúmenes y deténgase en vez de reutilizarlos o borrarlos.

```bash
(
  set -eu
  for ELEVANT_VOLUME in \
    elevant-dev-beszel-data \
    elevant-dev-beszel-agent-data
  do
    if docker volume inspect "$ELEVANT_VOLUME" >/dev/null 2>&1; then
      printf 'ERROR: el volumen ya existe: %s\n' "$ELEVANT_VOLUME" >&2
      exit 1
    fi
  done

  docker volume create \
    --label com.elevant.environment=development \
    --label com.elevant.component=observability \
    elevant-dev-beszel-data

  docker volume create \
    --label com.elevant.environment=development \
    --label com.elevant.component=observability \
    elevant-dev-beszel-agent-data
)
```

No use `docker compose down -v`, `docker volume prune` ni elimine esos volúmenes durante un rollback.

### 2. Crear el Compose

En la interfaz privada de **Dokploy**:

1. Cree un Compose normal llamado `elevant-dev-observability`; no cree un Swarm Stack.
2. Seleccione provider **Raw** y pegue [`compose.yml`](compose.yml) desde la revisión aprobada. Su SHA-256 debe ser `408a76510e6ffa9b7fc9119b88313f7d9eb5683bf8e68ebd0f323dbda2115034`; no use una rama mutable.
3. Desactive AutoDeploy.
4. En **Advanced**, desactive **Isolated Deployments**. En Dokploy v0.30 esa opción adjunta automáticamente otra red a los servicios; esta plantilla ya define su topología y debe conservarla sin modificaciones.
5. No agregue Domain, Traefik labels, `dokploy-network` ni puertos adicionales. Sin Domain y con Isolated Deployments desactivado, Dokploy debe ejecutar el Compose tal como está versionado.
6. Reabra el editor Raw y verifique el texto guardado por SHA-256 con el método de la guía canónica. Abra **Preview Compose** y deténgase si aparece `dokploy-network`, otra red, un Domain/label de Traefik, una publicación adicional o un montaje de `docker.sock`. Deben conservarse el nombre `elevant-dev-observability`, el bridge `elevant-dev-observability-runtime`, `host` para Agent y `none` para Init.
7. Copie las variables de `.env.example` al Environment protegido. Sustituya la URL de Tailscale y el heartbeat, pero en el primer arranque deje marcadores para `BESZEL_AGENT_KEY` y `BESZEL_AGENT_TOKEN`.
8. Pulse **Deploy**. En este primer arranque es esperado que `beszel-agent` no se registre o reinicie por los marcadores; `beszel-hub` debe quedar healthy y `beszel-volume-init` debe quedar `Exit 0`.

Este estado inicial no es una instalación aceptada. No abra temporalmente ningún puerto para corregir el agente.

### 3. Publicar el Hub solo por Tailscale

En la **Terminal VPS**, confirme primero el backend local:

```bash
curl --fail --silent --show-error http://127.0.0.1:18083/api/health
```

Después configure el Service privado, tal como exige la guía de Tailscale:

```bash
sudo tailscale serve \
  --service=svc:elevant-dev-monitoring \
  --https=443 \
  http://127.0.0.1:18083

sudo tailscale serve get-config --service=svc:elevant-dev-monitoring
sudo tailscale funnel status
```

Apruebe el host del Service si la consola lo solicita. Funnel debe permanecer sin configuración. Use la URL HTTPS exacta mostrada por Tailscale como `BESZEL_APP_URL` y actualice el Environment de Dokploy.

### 4. Registrar el VPS y completar el despliegue

1. Abra el Service desde un dispositivo de `group:elevant-ops` y cree la única cuenta administradora inicial con contraseña aleatoria guardada en el password manager.
2. En **Add System**, use el nombre `ELEVANT Development VPS` y el flujo WebSocket. Copie la clave pública y el token generados sin mostrarlos en logs ni en el chat.
3. Sustituya `BESZEL_AGENT_KEY` y `BESZEL_AGENT_TOKEN` en Dokploy y vuelva a pulsar **Deploy**.
4. Termine el alta en **Add System**. El sistema debe ponerse verde y el log del agente debe mostrar conexión WebSocket; no debe aparecer `Starting SSH server`.
5. Compruebe en el dashboard que CPU, RAM, load, disco y red corresponden al VPS. La ausencia de contenedores es intencional en esta versión. Si el filesystem raíz es incorrecto, obtenga el dispositivo con `findmnt -no SOURCE /`, guárdelo como `BESZEL_FILESYSTEM` y redespliegue. No adivine el dispositivo.

## Heartbeat base y alertas opcionales

En Healthchecks.io cree un check exclusivo para el Hub:

- periodo esperado: 2 minutos;
- gracia: 3 minutos;
- notificación externa: opcional y diferida hasta aprobación del operador;
- ping URL guardada como `BESZEL_HEARTBEAT_URL`.

El Hub envía un `HEAD` cada 60 segundos. Así el dead-man confirma que Beszel y la salida de red siguen vivos sin transmitir el inventario del servidor al proveedor.

Cuando el operador apruebe alertas externas, en
**Beszel > Settings > Notifications** agregue y pruebe una URL con el formato
oficial:

```text
telegram://REPLACE_WITH_BOT_TOKEN@telegram?chats=REPLACE_WITH_CHAT_ID
```

La URL real es secreta y queda en el volumen del Hub, no en este repositorio.
Solo después de activar ese canal habilite para `ELEVANT Development VPS`:

| Alerta Beszel v0.18.8 | Umbral | Persistencia |
| --- | --- | --- |
| Status | down | 2 minutos |
| CPU | mayor a 85% | 10 minutos |
| Memory | mayor a 80% | 10 minutos |
| LoadAvg5 | mayor a 1.8 | 10 minutos |
| Disk | mayor a 80% | 10 minutos |

Beszel v0.18.8 permite un solo umbral por usuario, sistema y métrica; por eso no se configuran simultáneamente niveles 70/80/90. Esta plantilla tampoco entrega datos de contenedores porque el acceso Docker está desactivado por seguridad. Los jobs de SQL health, backup y restore-check deberán tener checks independientes en Healthchecks.io cuando el operador apruebe esa integración. Mientras siga diferida, el operador revisa diariamente Beszel para estado/recursos del host y Dokploy Schedules/`controller.log` para SQL y jobs; no se debe declarar cobertura de alertas automáticas de DB.

## Validación y aceptación

La sintaxis se valida sin imprimir secretos:

```bash
docker compose \
  --env-file .env \
  -f compose.yml \
  config --quiet
```

Después del despliegue, valide desde la **Terminal VPS** usando los IDs que muestra Dokploy:

```bash
curl --fail --silent --show-error http://127.0.0.1:18083/api/health
ss -lntup | grep -E ':(18083|45876|2375)\b' || true
sudo tailscale serve get-config --service=svc:elevant-dev-monitoring
sudo tailscale funnel status
```

El único listener esperado de esos tres es `127.0.0.1:18083`; no debe existir listener TCP para `45876` ni `2375`. Copie de Dokploy los IDs reales y compruebe que su transformación del Compose no amplió la topología:

```bash
ELEVANT_HUB_ID=REPLACE_WITH_BESZEL_HUB_CONTAINER_ID
ELEVANT_AGENT_ID=REPLACE_WITH_BESZEL_AGENT_CONTAINER_ID
ELEVANT_INIT_ID=REPLACE_WITH_BESZEL_VOLUME_INIT_CONTAINER_ID

ELEVANT_HUB_NETWORKS="$(
  docker inspect \
    --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' \
    "$ELEVANT_HUB_ID" |
    sed '/^$/d'
)"

test "$ELEVANT_HUB_NETWORKS" = elevant-dev-observability-runtime
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$ELEVANT_AGENT_ID")" = host
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$ELEVANT_INIT_ID")" = none
test "$(docker inspect --format '{{range .Config.Env}}{{if eq . "DOCKER_HOST="}}{{println .}}{{end}}{{end}}' "$ELEVANT_AGENT_ID")" = 'DOCKER_HOST='

for ELEVANT_CONTAINER_ID in "$ELEVANT_HUB_ID" "$ELEVANT_AGENT_ID" "$ELEVANT_INIT_ID"; do
  test -z "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/run/docker.sock"}}FOUND{{end}}{{end}}' "$ELEVANT_CONTAINER_ID")"
done
```

La primera prueba exige exactamente una red para el Hub y, por tanto, también falla si Dokploy adjuntó `dokploy-network`. En Dokploy compruebe además:

- `beszel-hub` y `beszel-agent`: healthy;
- `beszel-volume-init`: `Exit 0`;
- ninguna publicación distinta de `127.0.0.1:18083:8090`;
- ningún montaje de `docker.sock` en ningún servicio y `DOCKER_HOST` vacío en Agent;
- Agent conectado por WebSocket y sistema verde;
- Service accesible desde `group:elevant-ops` y denegado desde `group:elevant-dev`;
- URL pública/IP pública incapaz de alcanzar el Hub por IPv4 e IPv6;
- heartbeat base reciente y, solo si se habilitó un canal externo, prueba de
  notificación recibida;
- estado conservado después de reiniciar los contenedores y, en el checkpoint final, el VPS.

La suma de límites persistentes es `384 MB` y `0.30 CPU`. El init es transitorio y dispone de `32 MB`/`0.05 CPU` solo mientras corrige permisos.

## Rollback

Un fallo detiene la secuencia. Para retirar acceso, drene y desactive únicamente `svc:elevant-dev-monitoring` según la guía Tailscale. Detenga el Compose desde Dokploy sin borrar volúmenes. Restaurar una revisión anterior requiere sus digests y una copia compatible del volumen del Hub; nunca haga downgrade sobre datos existentes sin comprobar la compatibilidad indicada por Beszel.

## Referencias oficiales

- [Beszel v0.18.8](https://github.com/henrygd/beszel/releases/tag/v0.18.8)
- [Instalación del Hub](https://beszel.dev/guide/hub-installation)
- [Instalación del Agent](https://beszel.dev/guide/agent-installation)
- [Variables de entorno](https://beszel.dev/guide/environment-variables)
- [Seguridad WebSocket/SSH](https://beszel.dev/guide/security)
- [Healthchecks de contenedor](https://beszel.dev/guide/healthchecks)
- [Heartbeat externo](https://beszel.dev/guide/heartbeat)
- [Notificaciones Telegram](https://beszel.dev/guide/notifications/telegram)
- [Tecnativa Docker Socket Proxy (imagen usada solo por el init)](https://github.com/Tecnativa/docker-socket-proxy)
- [Tailscale Services](https://tailscale.com/docs/features/tailscale-services)
- [Dokploy: Isolated Deployments](https://docs.dokploy.com/docs/core/docker-compose/utilities#isolated-deployments)
- [Dokploy: transformación de Domains y Preview Compose](https://docs.dokploy.com/docs/core/docker-compose/domains#how-it-works)
