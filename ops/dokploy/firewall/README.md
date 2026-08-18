# Firewall del VPS Development

Estos artefactos protegen la interfaz pública del VPS sin modificar las reglas
internas de Docker o Tailscale. Administran exclusivamente estas cadenas en las
tablas `filter` de IPv4 e IPv6:

- `ELEVANT-PUBLIC-IN`, enlazada desde `INPUT` solo para la interfaz pública.
- `ELEVANT-DOCKER-PUBLIC`, enlazada desde `DOCKER-USER` en IPv4 e IPv6.

Los scripts requieren Ubuntu 24.04 con `iptables` e `ip6tables` usando el backend
`nf_tables`. Fallan antes de aplicar reglas si la configuración, la interfaz o el
backend no son válidos. También rechazan el archivo de configuración si no es un
archivo regular, pertenece a una UID distinta de `0` o su modo no es exactamente
`0600`. Nunca ejecutan `iptables-save`, cambian políticas base ni vacían cadenas
de Docker, Tailscale, `INPUT` o `FORWARD`.

## Políticas

| Fase | Tráfico nuevo al host por la interfaz pública | Tráfico público reenviado a Docker |
| --- | --- | --- |
| `transitional` | ICMP/ICMPv6, UDP `41641`, TCP `22` y TCP `80` | Solo conexiones cuyo puerto TCP de destino original sea `80` |
| `final` | ICMP/ICMPv6 y UDP `41641` | Ninguno |

En ambas fases se aceptan respuestas `ESTABLISHED,RELATED`, se descarta tráfico
`INVALID` y todo lo demás termina en `DROP`. El tráfico recibido por `tailscale0`
no atraviesa el salto, porque este queda limitado a la interfaz pública. Este
paquete no configura Tailscale y presupone que Funnel permanece desactivado.

La fase transitoria existe únicamente para conservar SSH y HTTP mientras se
valida Tailscale. SQL Server, Dokploy, Docker API, HTTPS público y los puertos de
Swarm no reciben ninguna excepción.

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

Confirmar que todas las rutas por defecto IPv4 e IPv6 usan la misma interfaz
pública antes de continuar:

```bash
ip -4 route show default
ip -6 route show default
sudoedit /etc/elevant/firewall.env
sudo systemctl daemon-reload
sudo systemctl enable elevant-firewall.service
```

El aplicador exige que Docker haya creado `DOCKER-USER` en IPv4 y en IPv6, y
comprueba en ambas familias el salto incondicional `FORWARD` → `DOCKER-USER`. Así
no acepta una cadena huérfana o residual que no proteja realmente el tráfico
publicado. El salto debe ser la primera regla de `FORWARD` y su única referencia.
Si falta cualquier ruta, falla antes de modificar reglas; no existe una opción
que permita omitir silenciosamente la protección IPv6.

El preflight también exige al menos una ruta por defecto de cada familia y que
todas indiquen `ELEVANT_PUBLIC_INTERFACE`. La mera existencia de la interfaz no
es suficiente: una ruta IPv6 por otra NIC aborta antes de cambiar reglas.

La unidad se ordena después de red, Docker y Tailscale. Docker y Tailscale la
incluyen como dependencia al habilitarla, pero la unidad ELEVANT no intenta
arrancarlos: así no hay una dependencia `Wants` recíproca. `PartOf` propaga los
reinicios y `ReloadPropagatedFrom` propaga las recargas. Un arranque independiente
de Docker o Tailscale también solicita la unidad mediante sus enlaces `.wants`.

## Aplicación segura con rollback de diez minutos

Primero inspeccionar exactamente lo que se ejecutaría:

```bash
sudo /usr/bin/bash /usr/local/sbin/elevant-firewall-apply \
  --config /etc/elevant/firewall.env --dry-run
```

Desde el Browser Terminal de Hostinger, armar el rollback persistente y después
aplicar. El orden `enable`, marcador y `restart` garantiza que un reinicio después
de crear el marcador vuelva a programar la recuperación:

```bash
sudo systemctl enable elevant-firewall-rollback.timer
sudo install -o root -g root -m 0600 /dev/null \
  /var/lib/elevant-firewall/rollback-armed
sudo systemctl restart elevant-firewall-rollback.timer
sudo systemctl is-enabled elevant-firewall-rollback.timer
sudo systemctl is-active elevant-firewall-rollback.timer
sudo systemctl list-timers elevant-firewall-rollback.timer --no-pager
```

No se aplican reglas si el timer no figura `enabled`, `active` y con una próxima
ejecución. Solo después de comprobarlo se aplica la política:

```bash
sudo systemctl restart elevant-firewall.service
```

El marcador vive en `/var/lib`, por lo que sobrevive un reinicio. El
timer vuelve a contar diez minutos desde su activación durante el nuevo arranque;
no conserva el instante exacto del plazo anterior, pero la recuperación permanece
armada. Al dispararse, deshabilita la unidad de aplicación antes de retirar reglas,
se deshabilita a sí mismo y elimina el marcador únicamente si el rollback termina.

Mantener abierta esa consola. Antes de cancelar el temporizador, abrir sesiones
nuevas e independientes y comprobar:

1. SSH a través de Tailscale y `sudo` con el usuario operativo.
2. Dokploy mediante su URL HTTPS privada de Tailscale.
3. Estado y reglas instaladas:

```bash
sudo systemctl status elevant-firewall.service --no-pager
sudo iptables -S INPUT
sudo iptables -S ELEVANT-PUBLIC-IN
sudo iptables -S DOCKER-USER
sudo iptables -S ELEVANT-DOCKER-PUBLIC
sudo ip6tables -S INPUT
sudo ip6tables -S ELEVANT-PUBLIC-IN
sudo ss -lntup
```

Si las pruebas pasan, cancelar el rollback y verificar que no esté activo:

```bash
sudo rm -f /var/lib/elevant-firewall/rollback-armed
sudo systemctl disable --now elevant-firewall-rollback.timer
sudo systemctl is-active elevant-firewall-rollback.timer
sudo systemctl is-enabled elevant-firewall-rollback.timer || true
sudo test ! -e /var/lib/elevant-firewall/rollback-armed
```

Las salidas esperadas son `inactive` y `disabled`, y el último comando debe
terminar en cero. Si se pierde acceso, no se cancela nada: el temporizador
deshabilitará la unidad principal y retirará únicamente las reglas ELEVANT al
cumplirse los diez minutos. Este rollback no cambia el firewall de Hostinger;
por eso el perfil **final** del proveedor se activa solo después de validar el
firewall final del host. El perfil bootstrap/transitorio ya debe estar activo
según el runbook canónico.

## Paso de transitorio a final

1. Verificar primero Tailscale, SSH privado, Dokploy privado y el Browser Terminal.
2. Cambiar `ELEVANT_FIREWALL_PHASE=final` en `/etc/elevant/firewall.env`.
3. Repetir el dry-run y el procedimiento con rollback de diez minutos.
4. Desde una red externa, comprobar que no respondan los puertos públicos de SSH,
   HTTP, HTTPS, Dokploy, SQL Server, Docker API ni Docker Swarm.
5. Solo entonces activar en Hostinger el perfil final que permita ICMP/ICMPv6 y
   UDP `41641`, sin reglas públicas para esos servicios.

El firewall administrado de Hostinger es `DROP` por defecto. El perfil de
bootstrap pudo aceptar temporalmente `3000` solo desde la IP del operador, pero
esa regla se elimina en cuanto Dokploy funciona por Tailscale. El perfil
transitorio acepta ICMP desde cualquier origen, UDP `41641` desde cualquier
origen, TCP `22` únicamente desde las direcciones `/32` y `/128` del operador y
TCP `80` desde cualquier origen. El perfil final conserva solo ICMP y UDP
`41641`; no se agrega una regla general de aceptación. Los cambios pueden tardar
hasta dos minutos y las conexiones ya establecidas no prueban una regla nueva.

No se debe cancelar el rollback basándose únicamente en una sesión que ya estaba
abierta: las conexiones `ESTABLISHED` continúan funcionando aun cuando el acceso
nuevo esté bloqueado.

## Rollback manual exacto

Previsualizar o ejecutar desde el Browser Terminal:

```bash
sudo /usr/bin/bash /usr/local/sbin/elevant-firewall-rollback \
  --config /etc/elevant/firewall.env --dry-run

sudo /usr/bin/bash /usr/local/sbin/elevant-firewall-rollback \
  --config /etc/elevant/firewall.env
```

Solo si el rollback termina en cero, limpiar cualquier recuperación que se
hubiera armado manualmente:

```bash
sudo rm -f /var/lib/elevant-firewall/rollback-armed
sudo systemctl disable --now elevant-firewall-rollback.timer
```

El rollback acepta únicamente una referencia exacta y no duplicada por cadena.
Después de retirar esos saltos vuelve a comprobar que no quede referencia alguna;
solo entonces vacía y elimina las dos cadenas `ELEVANT-*`. Si otra regla intenta
referenciar una cadena ELEVANT, el script aborta antes de vaciarla. El aplicador
realiza la misma comprobación antes de reconstruir una cadena existente. Antes de
retirar reglas, el script ejecutable deshabilita y detiene
`elevant-firewall.service`; por ello el rollback no deja un estado engañoso
`active (exited)` ni permite que la política vuelva a aplicarse en el siguiente
arranque. Para volver a aplicar, se debe habilitar de nuevo la unidad principal.

## Comportamiento ante errores

- `flock` impide aplicar y revertir al mismo tiempo.
- Al actualizar una cadena existente se inserta primero un `DROP` temporal. Las
  reglas nuevas se preparan detrás de él y el guard se retira al final.
- Cada salto ELEVANT se instala en la regla 1 de su cadena padre. Si otro servicio
  lo desplaza, el preflight aborta antes de modificar reglas; no intenta borrar
  por número mientras otra herramienta podría estar cambiando la misma cadena.
- Si una orden falla durante esa sustitución, el guard permanece y el camino
  afectado queda cerrado. Ejecutar el rollback auditado desde la consola del
  proveedor; no vaciar manualmente `DOCKER-USER` ni reiniciar Docker a ciegas.
- El firewall de Hostinger es una segunda capa independiente y nunca es cambiado
  por estos scripts.
