# Tailscale para ELEVANT Development

Esta guia prepara una tailnet privada para administrar el VPS y, mas adelante, compartir la API y los dos frontends Development con el equipo. Tailscale no sustituye la autenticacion de ELEVANT: JWT, roles y tenant scope siguen siendo obligatorios.

## Resultado esperado

| Recurso | Identidad autorizada | Transporte |
| --- | --- | --- |
| OpenSSH del VPS | `group:elevant-ops` | host etiquetado, `tcp:22` |
| Dokploy | `group:elevant-ops` | `svc:elevant-dev-dokploy`, `tcp:443` |
| Beszel | `group:elevant-ops` | `svc:elevant-dev-monitoring`, `tcp:443` |
| API y webs Development | `group:elevant-ops`, `group:elevant-dev` | tres Services, `tcp:443` |
| SQL Server, Docker API y Swarm | nadie por Tailscale | sin grant ni Service |

La politica es deny-by-default. No hay grants al puerto local `3000`, a SQL Server `1433`, a Docker `2375/2376` ni a Swarm `2377/7946/4789`. Tampoco se habilitan Funnel, subnet routes, exit node o Tailscale SSH. El puerto 22 usa OpenSSH normal y conserva su autenticacion por clave.

> Esta guia configura la red privada. No cierre aun SSH ni los puertos publicos en Hostinger: primero pruebe una sesion nueva por Tailscale y siga despues el runbook de firewall.

## 1. Crear la tailnet y las identidades

1. Cree una tailnet nueva con una identidad de organizacion controlada por el propietario. Proteja esa cuenta con MFA o passkey.
2. En **Users**, invite a cada integrante con su propia cuenta. No comparta la cuenta del propietario ni una cuenta generica.
3. Conserve como Owner/Admin solo a quien opere infraestructura. Los companeros de desarrollo deben ser Members.
4. Anote el nombre DNS de la tailnet mostrado por Tailscale como `<TAILNET_DNS_NAME>`; no escriba su valor real en este repositorio.
5. Mantenga MagicDNS habilitado y habilite certificados HTTPS para la tailnet. No habilite Funnel.
6. Instale el cliente estable en el PC del operador y, cuando corresponda, en cada PC o tablet. Todos los clientes que usen Tailscale Services deben ejecutar Tailscale `1.94` o posterior:

```powershell
tailscale version
```

Cada persona inicia sesion con su propia identidad. No se distribuyen auth keys a usuarios finales.

## 2. Definir los Services

Antes de cargar la politica, abra **Admin console > Services > Advertised > Define a Service** y cree estas cinco definiciones. Declare solamente el endpoint `tcp:443` en cada una:

| Service | Uso |
| --- | --- |
| `svc:elevant-dev-dokploy` | panel Dokploy |
| `svc:elevant-dev-monitoring` | Beszel |
| `svc:elevant-dev-api` | API Development privada |
| `svc:elevant-dev-aviam-web` | frontend interno AVIAM futuro |
| `svc:elevant-dev-public-web` | frontend publico Development futuro |

No defina Services para SQL Server, Docker, Swarm o el puerto `3000`. Un
Service puede permanecer en estado **Needs configuration** u **Offline** hasta
que exista su workload.

## 3. Aplicar la politica

1. Abra [`policy.hujson.example`](policy.hujson.example).
2. Sustituya `owner@example.com` por el login exacto del propietario que aparece en **Users**.
3. Sustituya `developer@example.com` y agregue una linea por cada companero. Un usuario puede pertenecer a ambos grupos si tambien es operador.
4. Abra **Admin console > Access controls > JSON editor** y pegue el documento completo.
5. Guarde. Tailscale debe compilar la politica y aprobar todas las pruebas `accept` y `deny`.

No quite pruebas para conseguir que la politica guarde. Si una prueba falla, compruebe primero que los usuarios y los cinco Services existen con los nombres exactos. El archivo es una plantilla: los logins reales viven solo en la consola de Tailscale.

La politica permite que `tag:elevant-dev-host` anuncie los cinco Services. Esa autoaprobacion no otorga acceso a usuarios; los grants separados deciden quien puede conectarse.

## 4. Instalar y enrolar el VPS

Ejecute esta seccion en la terminal del VPS. Instale desde el canal estable oficial y compruebe la version:

```bash
curl -fsSL https://tailscale.com/install.sh | sh

ELEVANT_TS_VERSION="$(tailscale version | head -n 1)"
if dpkg --compare-versions "$ELEVANT_TS_VERSION" ge "1.94"; then
  printf 'Tailscale compatible: %s\n' "$ELEVANT_TS_VERSION"
else
  printf 'ERROR: se requiere Tailscale >= 1.94; actual: %s\n' "$ELEVANT_TS_VERSION" >&2
  false
fi
unset ELEVANT_TS_VERSION
```

En **Admin console > Settings > Keys**, genere una auth key con estas propiedades exactas:

- descripcion reconocible, sin datos secretos;
- **Reusable: desactivado** (one-off);
- expiracion: un dia;
- **Ephemeral: desactivado**;
- tag: `tag:elevant-dev-host`;
- **Pre-approved: activado** solo si la tailnet usa Device approval.

No pegue la key en el comando, el chat, un archivo del repositorio ni el historial. Pegue el siguiente bloque completo en la terminal del VPS; cuando aparezca el prompt, introduzca la key una sola vez. `read -s` oculta la entrada y `file:` evita que el secreto aparezca en los argumentos del proceso:

```bash
(
  set -eu
  umask 077
  ELEVANT_TS_KEY_FILE="$(mktemp)"
  trap 'rm -f -- "$ELEVANT_TS_KEY_FILE"' EXIT

  IFS= read -r -s -p 'Tailscale one-off auth key: ' ELEVANT_TS_AUTH_KEY
  printf '\n'
  printf '%s' "$ELEVANT_TS_AUTH_KEY" > "$ELEVANT_TS_KEY_FILE"
  unset ELEVANT_TS_AUTH_KEY

  sudo tailscale up \
    --auth-key="file:$ELEVANT_TS_KEY_FILE" \
    --hostname=elevant-dev-host \
    --accept-routes=false

  sudo tailscale set \
    --accept-routes=false \
    --advertise-routes= \
    --advertise-exit-node=false \
    --exit-node= \
    --ssh=false
)
```

La key one-off se revoca automaticamente al utilizarse. Confirme igualmente en **Settings > Keys** que ya no es utilizable. En **Machines**, el VPS debe aparecer como `elevant-dev-host`, con `tag:elevant-dev-host`, sin subnet routes y sin anunciarse como exit node.

Valide en el VPS:

```bash
sudo systemctl is-enabled tailscaled
sudo systemctl is-active tailscaled
sudo tailscale status
sudo tailscale ip -4
sudo tailscale funnel status
```

Los dos primeros comandos deben devolver `enabled` y `active`. Funnel no debe mostrar ninguna configuracion. Si aparece alguna, elimine solo esa configuracion y vuelva a comprobar:

```bash
sudo tailscale funnel reset
sudo tailscale funnel status
```

## 5. Publicar Dokploy de forma privada

Primero confirme desde el VPS que Dokploy responde localmente. Un `200`, `302` o `307` es aceptable:

```bash
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  http://127.0.0.1:3000/
```

Configure y anuncie el Service. Con `--service`, Serve queda en segundo plano y Tailscale administra el certificado HTTPS:

```bash
sudo tailscale serve \
  --service=svc:elevant-dev-dokploy \
  --https=443 \
  http://127.0.0.1:3000
```

Compruebe la configuracion y el anuncio:

```bash
sudo tailscale serve get-config --all
sudo tailscale serve status --json
sudo tailscale status --json
```

En **Services**, `svc:elevant-dev-dokploy` debe estar **Connected**, con el VPS como host aprobado y `tcp:443` como endpoint. Desde el PC del operador:

```powershell
curl.exe -I "https://elevant-dev-dokploy.<TAILNET_DNS_NAME>.ts.net/"
ssh elevant-ops@elevant-dev-host
```

Abra una sesion SSH nueva y valide `sudo` antes de cerrar la sesion root de recuperacion o modificar los firewalls. La URL de Dokploy debe fallar desde una cuenta que pertenezca solo a `group:elevant-dev`.

## 6. Publicar monitoreo y workloads futuros

Ejecute cada comando unicamente despues de que el workload correspondiente escuche en loopback. Beszel usa el puerto reservado por el runbook:

```bash
sudo tailscale serve \
  --service=svc:elevant-dev-monitoring \
  --https=443 \
  http://127.0.0.1:18083
```

Los targets usan puertos loopback, no el nombre interno del contenedor:

```bash
sudo tailscale serve --service=svc:elevant-dev-api --https=443 \
  http://127.0.0.1:18080

sudo tailscale serve --service=svc:elevant-dev-aviam-web --https=443 \
  http://127.0.0.1:<AVIAM_WEB_LOOPBACK_PORT>

sudo tailscale serve --service=svc:elevant-dev-public-web --https=443 \
  http://127.0.0.1:<PUBLIC_WEB_LOOPBACK_PORT>
```

Los operadores deben poder abrir los cinco Services. Los miembros de `group:elevant-dev` solo deben poder abrir API, AVIAM Web y Public Web. Ningun usuario debe poder alcanzar por la tailnet `:3000`, `:1433`, Docker o Swarm directamente.

## 7. Checkpoint antes del firewall

No continue al cierre de puertos publicos hasta cumplir todo lo siguiente:

- politica guardada con todas las pruebas aprobadas;
- clientes y VPS en Tailscale `>=1.94`;
- VPS etiquetado y sin subnet routes, exit node, Funnel o Tailscale SSH;
- Dokploy accesible por su URL `https://...ts.net` desde una cuenta `elevant-ops`;
- Dokploy denegado desde una cuenta que solo pertenezca a `elevant-dev`;
- nueva sesion `ssh elevant-ops@elevant-dev-host` y `sudo` funcionales;
- Browser Terminal de Hostinger disponible como recuperacion;
- ningun Service creado para SQL Server ni puertos Docker/Swarm.

La politica Tailscale no cierra por si sola los puertos de la IP publica. El firewall de Hostinger y el firewall del host se aplican en la fase siguiente, despues de este checkpoint.

## Retirada o rollback

Para retirar un endpoint sin borrar su definicion, drene primero el Service y luego limpie solo su configuracion:

```bash
sudo tailscale serve drain svc:elevant-dev-dokploy
sudo tailscale serve clear svc:elevant-dev-dokploy
```

No ejecute `tailscale down`, no elimine el host y no quite el grant SSH despues de cerrar el puerto publico 22 sin haber restaurado antes una via de administracion comprobada.

## Referencias oficiales

- [Tailscale Services](https://tailscale.com/docs/features/tailscale-services)
- [Grants](https://tailscale.com/docs/features/access-control/grants)
- [Sintaxis del policy file y tests](https://tailscale.com/docs/reference/syntax/policy-file)
- [Auth keys](https://tailscale.com/docs/features/access-control/auth-keys)
- [Manejo seguro de auth keys](https://tailscale.com/docs/features/access-control/auth-keys/how-to/secure-auth-keys)
- [CLI de Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
