# Proxy inverso

Dokploy y su proxy son responsables de TLS, renovación de certificados, dominio y enrutamiento hacia el puerto interno `8080` de la API.

- Publicar únicamente HTTPS para clientes; HTTP puede redirigir en el borde.
- No publicar `1433`, endpoints administrativos ni puertos de diagnóstico.
- Conservar host, esquema e IP de cliente mediante encabezados `Forwarded`, pero aceptar esos encabezados solo de proxies o redes configurados en la API.
- No habilitar una confianza global en `X-Forwarded-For`; permitiría falsificar identidad y eludir rate limiting por IP.
- Usar `/health` para liveness. Reservar `/health/ready` para decisiones que deban considerar SQL Server.

La red `edge` permite que el proxy alcance la API; la red `data` es interna y conecta únicamente API con SQL Server.
