# ELEVANT en Dokploy

La guía canónica es `docs/deployment/dokploy.md` y la secuencia operativa auditada está en `docs/deployment/dokploy-configuration.md`. Este directorio resume la topología posterior al merge de DB v1 en `Development`.

## Ciclos de vida separados

1. `elevant-dev-database`: Compose manual, sin AutoDeploy; SQL, volúmenes y provisioner.
2. `elevant-dev-database-release`: jobs migrator + seeder Development por release.
3. `elevant-dev-api`: imagen API futura, desplegable solo después de release DB sano.
4. `elevant-dev-aviam-web`: Vite compilado y Nginx no-root.
5. `elevant-dev-public-web`: Next standalone/Node no-root.

Mobile Agent no es un servicio Dokploy. CI/EAS produce una APK firmada que se instala en la tablet y consume `elevant-dev-api`.

Solo API se conecta a la red de datos. Las webs llaman a API por HTTPS y jamás reciben credenciales SQL. Un redeploy de API/web no toca el contenedor o volumen SQL.

## Estado de esta rama

Están implementados y validados los dos primeros Compose y las imágenes de base. El run de publicación del merge de DB v1 certificó las referencias inmutables que registra la guía operativa. Los Dockerfiles/Compose de API y frontends se crearán al comenzar su integración real; la documentación reserva puertos, recursos y fronteras para evitar decisiones incompatibles.

Nada en estos artefactos llama a la API de Dokploy ni modifica el VPS automáticamente. El push a `Development` publica imágenes probadas en GHCR, pero el operador elige el digest y ejecuta manualmente el despliegue inicial con validación entre pasos.

## Acceso Development

Sin dominio propio, la opción recomendada es Tailscale Services + Serve con HTTPS, no puertos públicos o certificados self-signed:

- `svc:elevant-dev-api` -> `127.0.0.1:18080`;
- `svc:elevant-dev-aviam-web` -> `127.0.0.1:18081`;
- `svc:elevant-dev-public-web` -> `127.0.0.1:18082`;
- `svc:elevant-dev-dokploy` -> `127.0.0.1:3000`.

Cada aplicación obtiene hostname/certificado separado. No use Funnel y no anuncie toda una subnet Docker. El firewall del proveedor mantiene cerrados 1433, 18080-18082, 3000 y, tras verificar el acceso privado, los puertos públicos que no sean necesarios.

Antes del primer despliegue hay que confirmar tailnet/Services, roles `dev`/`ops`, acceso de la tablet, namespace/credencial GHCR y un CIDR Docker no conflictivo.
