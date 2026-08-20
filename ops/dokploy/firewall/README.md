# Firewall del VPS Development

Estos artefactos crean una sola tabla nativa de nftables, `inet
elevant_firewall`, para proteger la interfaz pública del VPS en IPv4 e IPv6.
La tabla contiene únicamente dos base chains propiedad de ELEVANT:

- `public_input`, conectada al hook `input`.
- `public_forward`, conectada al hook `forward`.

Ambas usan prioridad explícita `filter - 10`, anterior a la prioridad `filter`
(`0`) usada por las reglas compatibles con iptables-nft. Su política base es
`accept` y todas las reglas están limitadas con `iifname` a la interfaz pública.
En nftables un `accept` permite continuar hacia chains posteriores, mientras un
`drop` es definitivo. Por eso ELEVANT puede bloquear primero el tráfico público
sin modificar ni depender del orden de `ts-input`, `ts-forward`, `DOCKER-USER` o
las reglas internas de Docker.

Tailscale conserva `--netfilter-mode=on` y Docker conserva el backend
iptables-nft. Los scripts nunca ejecutan `flush ruleset`, `iptables-save`,
`nftables.service` ni escriben `/etc/nftables.conf`. Tampoco agregan, mueven,
vacían o eliminan tablas/chains de Docker, Tailscale u otro propietario. Este
diseño sigue el modelo de base chains independientes y prioridades documentado
por [Netfilter](https://netfilter.org/projects/nftables/manpage.html)
y [Docker](https://docs.docker.com/engine/network/firewall-nftables/).

## Política

| Fase | Tráfico nuevo al host por la interfaz pública | Tráfico público reenviado |
| --- | --- | --- |
| `transitional` | ICMP, ICMPv6, UDP `41641`, TCP `22` y TCP `80` | Solo una conexión TCP nueva con DNAT cuyo puerto de destino original sea `80` |
| `final` | ICMP, ICMPv6 y UDP `41641` | Ninguno |

En ambas fases se descarta primero `INVALID`, se deja continuar
`ESTABLISHED,RELATED` y el último match de la interfaz pública es `drop`. La
excepción transitoria de forwarding exige conjuntamente `ct state new`,
dirección conntrack `original`, estado `dnat`, protocolo TCP y
`ct original proto-dst 80`; no es una apertura general de TCP `80` hacia una
ruta arbitraria. Un paquete público premarcado con el mark de Tailscale o
encaminado hacia `tailscale0` sigue cayendo antes de `ts-forward` si no cumple
esa tupla exacta.

El tráfico recibido desde `tailscale0`, bridges Docker u otras interfaces no
coincide con `iifname` y continúa intacto. Funnel permanece desactivado. SQL
Server, Dokploy, Docker API, HTTPS público y los puertos de Swarm no reciben
excepción.

## Preflight y propiedad estricta

Los scripts requieren Ubuntu 24.04, `nft`, `iptables` e `ip6tables`. Los dos
wrappers de iptables deben reportar el backend `nf_tables`. El archivo de
configuración debe ser regular, no symlink, propiedad de UID `0` y modo exacto
`0600`. Todas las rutas por defecto IPv4 e IPv6 deben indicar la misma interfaz
configurada; `lo` y `tailscale0` se rechazan.

Si `inet elevant_firewall` ya existe, el aplicador y el rollback comparan toda su
estructura —tabla, comentarios, chains, hooks, prioridad, políticas, orden y
expresiones— contra las dos fases canónicas. Una regla, chain, familia, interfaz
o comentario desconocido aborta antes de borrar nada. Un objeto homónimo en
otra familia también aborta. Esto evita apropiarse de una tabla ajena.

La actualización se envía como un único batch `nft -f`: si la tabla existe, la
transacción contiene `delete table` y la definición completa nueva. nftables
confirma todo o conserva la versión anterior; no hay un intervalo entre delete
y add. `--dry-run` ejecuta solamente el check de la transacción y la imprime, sin
mutar el host.

## Instalación

Ejecutar desde la raíz del checkout en el VPS:

```bash
sudo install -D -o root -g root -m 0755 \
  ops/dokploy/firewall/elevant-firewall-apply \
  /usr/local/sbin/elevant-firewall-apply
sudo install -D -o root -g root -m 0755 \
  ops/dokploy/firewall/elevant-firewall-rollback \
  /usr/local/sbin/elevant-firewall-rollback
sudo install -D -o root -g root -m 0600 \
  ops/dokploy/firewall/firewall.env.example \
  /etc/elevant/firewall.env
sudo install -D -o root -g root -m 0644 \
  ops/dokploy/firewall/elevant-firewall.service \
  /etc/systemd/system/elevant-firewall.service
sudo install -D -o root -g root -m 0644 \
  ops/dokploy/firewall/20-elevant-firewall-gate.conf \
  /etc/systemd/system/docker.service.d/20-elevant-firewall-gate.conf
sudo install -D -o root -g root -m 0644 \
  ops/dokploy/firewall/elevant-firewall-rollback.service \
  /etc/systemd/system/elevant-firewall-rollback.service
sudo install -D -o root -g root -m 0644 \
  ops/dokploy/firewall/elevant-firewall-rollback.timer \
  /etc/systemd/system/elevant-firewall-rollback.timer
sudo install -D -o root -g root -m 0644 \
  ops/dokploy/firewall/README.md \
  /usr/local/share/doc/elevant-firewall/README.md
sudo install -d -o root -g root -m 0700 /var/lib/elevant-firewall
```

Verificar herramientas, rutas y configuración antes de habilitar la unidad:

```bash
nft --version
iptables --version
ip6tables --version
ip -4 route show default
ip -6 route show default
sudoedit /etc/elevant/firewall.env
sudo rm -f \
  /etc/systemd/system/docker.service.requires/elevant-firewall.service
sudo systemctl daemon-reload
sudo systemctl reenable elevant-firewall.service
sudo systemctl cat docker.service
sudo systemctl show docker.service \
  --property=After --property=Requires --property=ExecStartPre
```

El `rm` retira solamente el enlace `docker.service.requires` de una versión
anterior; debe terminar con el path exacto mostrado. `reenable` deja la unidad
ELEVANT habilitada de forma independiente por `multi-user.target`.

El drop-in de Docker no contiene `Wants` ni `Requires`: ordena el arranque
normal después de ELEVANT y, antes de cada start/restart de Docker, ejecuta
`--verify-active`. Ese modo toma el mismo lock, repite todo el preflight y exige
que la tabla esté presente y coincida exactamente con la fase configurada, sin
mutar nftables. Si la aplicación de boot falla, Docker también falla cerrado; un
restart manual queda protegido aunque la unidad ELEVANT no forme parte de esa
transacción. Tailscale no queda bloqueado para conservar recuperación privada.

Detener o recargar ELEVANT no cicla Docker, y detener Docker no altera ELEVANT.
Reiniciar o reordenar reglas de Docker/Tailscale tampoco mueve ni elimina la
tabla independiente. `systemctl cat docker.service` debe mostrar el drop-in y
su `ExecStartPre`; si no aparece, no se continúa.

Un target puede quedar `active` aunque una unidad en su transacción haya
fallado. Después de cada boot se validan explícitamente ambas unidades con
`systemctl is-active elevant-firewall.service docker.service` y se revisa el
journal de cualquiera que no devuelva `active`.

## Aplicación segura con rollback de diez minutos

Primero inspeccionar la transacción completa:

```bash
sudo /usr/bin/bash /usr/local/sbin/elevant-firewall-apply \
  --config /etc/elevant/firewall.env --dry-run
```

Desde el Browser Terminal de Hostinger, armar el rollback persistente y después
aplicar. El marcador en `/var/lib` sobrevive un reboot y vuelve a programar la
recuperación al arrancar:

```bash
sudo systemctl enable elevant-firewall-rollback.timer
sudo install -o root -g root -m 0600 /dev/null \
  /var/lib/elevant-firewall/rollback-armed
sudo systemctl restart elevant-firewall-rollback.timer
sudo systemctl is-enabled elevant-firewall-rollback.timer
sudo systemctl is-active elevant-firewall-rollback.timer
sudo systemctl list-timers elevant-firewall-rollback.timer --no-pager
```

No aplicar si el timer no aparece `enabled`, `active` y con próxima ejecución.
`reload-or-restart` usa `ExecReload` si la oneshot ya está activa y la inicia si
no lo está; ambos caminos ejecutan el mismo reemplazo atómico dentro del sandbox
de systemd y no reinician Docker:

```bash
sudo systemctl reload-or-restart elevant-firewall.service
```

Mantener abierta la consola del proveedor. Desde sesiones nuevas e
independientes comprobar:

1. SSH y `sudo` por Tailscale.
2. Dokploy por su URL HTTPS privada de Tailscale.
3. Tabla ELEVANT y reglas Docker/Tailscale intactas.
4. Pruebas externas nuevas de IPv4 e IPv6.

```bash
sudo systemctl status elevant-firewall.service --no-pager
sudo systemctl status docker.service --no-pager
sudo nft list table inet elevant_firewall
sudo iptables -S INPUT
sudo iptables -S FORWARD
sudo iptables -S DOCKER-USER
sudo ip6tables -S INPUT
sudo ip6tables -S FORWARD
sudo ip6tables -S DOCKER-USER
sudo ss -lntup
```

Si todo pasa, cancelar el rollback:

```bash
sudo rm -f /var/lib/elevant-firewall/rollback-armed
sudo systemctl disable --now elevant-firewall-rollback.timer
sudo systemctl is-active elevant-firewall-rollback.timer
sudo systemctl is-enabled elevant-firewall-rollback.timer || true
sudo test ! -e /var/lib/elevant-firewall/rollback-armed
```

Las salidas esperadas son `inactive` y `disabled`. No cancelar basándose solo
en una conexión ya abierta: `ESTABLISHED` puede seguir funcionando aunque una
conexión nueva falle. El timer no modifica el firewall de Hostinger.

## Paso de transitorio a final

1. Validar Tailscale, SSH privado, Dokploy privado y Browser Terminal.
2. Cambiar `ELEVANT_FIREWALL_PHASE=final` en `/etc/elevant/firewall.env`.
3. Repetir dry-run y armar un rollback nuevo de diez minutos.
4. Ejecutar `systemctl reload-or-restart elevant-firewall.service`.
5. Desde otra red, comprobar en IPv4 e IPv6 que fallen los puertos públicos de
   SSH, HTTP, HTTPS, Dokploy, SQL Server, Docker API y Docker Swarm.
6. Solo entonces activar el perfil final de Hostinger con ICMP/ICMPv6 y UDP
   `41641`, sin TCP público.

## Rollback manual exacto

Previsualizar o ejecutar desde el Browser Terminal:

```bash
sudo /usr/bin/bash /usr/local/sbin/elevant-firewall-rollback \
  --config /etc/elevant/firewall.env --dry-run

sudo /usr/bin/bash /usr/local/sbin/elevant-firewall-rollback \
  --config /etc/elevant/firewall.env
```

El rollback valida propiedad estricta y ejecuta `nft --check` antes de cambiar
estado. Elimina y verifica exclusivamente `table inet elevant_firewall` mientras
la unidad sigue habilitada; solo después deshabilita/detiene
`elevant-firewall.service`. Así, un corte anterior al delete conserva la tabla;
uno después del delete pero antes de iniciar la desactivación conserva la unidad
habilitada y la reconstruye en el boot. Si el corte ocurre dentro de
`disable --now` después de retirar el enlace, el drop-in impide que Docker
arranque sin una tabla válida y Tailscale conserva la recuperación privada.
Después de una desactivación exitosa el rollback ya es intencionalmente completo
y no reaplica. Si la desactivación devuelve error, intenta restaurar
inmediatamente la tabla validada y el lifecycle enabled/active anterior. Si
detecta drift, no cambia unidad ni tabla. Nunca vacía el ruleset ni toca una
tabla ajena. Al terminar correctamente, la unidad queda inactiva y deshabilitada
para que la política no reaparezca silenciosamente al reiniciar.

El drop-in de Docker se conserva intencionalmente. El Docker que ya estaba
activo no se detiene durante el rollback, pero su próximo start/restart falla
cerrado hasta que se vuelva a habilitar/aplicar ELEVANT y `--verify-active`
termine en cero. No retire el gate para forzar un arranque; use la consola del
proveedor para reparar o reaplicar la tabla.

Solo si termina en cero, limpiar una recuperación armada manualmente:

```bash
sudo rm -f /var/lib/elevant-firewall/rollback-armed
sudo systemctl disable --now elevant-firewall-rollback.timer
```

## Comportamiento ante errores

- `flock` impide aplicar y revertir al mismo tiempo.
- Los dos hooks y ambas familias se validan y cambian en una sola transacción.
- Una transacción inválida conserva íntegra la política anterior.
- Cualquier drift de la tabla ELEVANT aborta antes del `delete table`.
- Docker y Tailscale pueden reiniciarse sin reconciliar orden de hooks.
- El firewall de Hostinger es una capa independiente y nunca es cambiado por
  estos scripts.

## Prueba reproducible

La regresión automatizada corre en un namespace de red aislado y cubre IPv4,
IPv6, INPUT, DNAT transitorio, prioridad frente a Tailscale/Docker, paquetes
premarcados, `--verify-active` ausente/válido/fase incorrecta/lock, drift,
atomicidad, compensación de rollback e idempotencia:

```bash
sudo bash ops/dokploy/firewall/test-firewall
```

La prueba no debe ejecutarse durante el despliegue manual; pertenece a CI o a un
host desechable con `unshare`, `nft`, iptables-nft, `python3` y `ping`.
