# Preflight del VPS

`collect-state` reúne únicamente estado operativo no secreto antes y después de cada checkpoint. No lee variables de contenedores, archivos `.env`, contenido de volúmenes, credenciales, historiales ni logs de aplicación.

Desde la raíz del checkout auditado instálelo una sola vez:

```bash
sudo install -D -o root -g root -m 0755 \
  ops/dokploy/preflight/collect-state \
  /usr/local/sbin/elevant-preflight
```

Ejecute en el VPS:

```bash
sudo /usr/local/sbin/elevant-preflight | tee \
  "/run/elevant-preflight-$(date -u +%Y%m%dT%H%M%SZ).log"
```

Use `/run` para que el reporte desaparezca al reiniciar. Revíselo antes de compartirlo: nombres de host, IP y topología siguen siendo información operacional. No lo copie al repositorio.

El script es read-only. Un error de Docker, firewall o Tailscale produce un bloque `unavailable` y debe investigarse; no se corrige relajando seguridad.
