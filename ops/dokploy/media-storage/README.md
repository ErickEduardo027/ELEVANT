# Medios privados de Development

Este paquete define almacenamiento S3 compatible para fotos y videos comerciales y avatares. Es un recurso **separado** de Database Release y API. Según `ops/AGENTS.md`, el operador instala y modifica el VPS y Dokploy manualmente; el agente solo prepara y revisa este contrato.

Garage `2.3+` admite `--single-node`; esta topología Development tiene factor de réplica 1 y necesita una copia de seguridad externa probada. Véase la [guía oficial de Garage](https://garagehq.deuxfleurs.fr/documentation/quick-start/).

## Preparación del operador

1. Revisar y fijar un digest `sha256` de `dxflrs/garage` versión `2.3+`. Guardar `ELEVANT_GARAGE_IMAGE_DIGEST=sha256:...` en el Environment privado del nuevo recurso Raw `elevant-dev-media`.
2. Verificar la identidad y el alcance de la red externa `elevant-dev-data`. Crear **solo si no existen** los volúmenes nombrados `elevant-dev-media-metadata` y `elevant-dev-media-data`. No reutilizar volúmenes SQL ni emplear `down -v`.
3. Copiar `garage.toml.example` a una ruta absoluta privada del host, reemplazar `rpc_secret` por 32 bytes aleatorios en hexadecimal, proteger el archivo y guardar su ruta como `ELEVANT_GARAGE_CONFIG_FILE`. No pegar el secreto en el repositorio ni en capturas.
4. Revisar y guardar `compose.yml` como Raw sin Domain, puertos, Traefik ni `dokploy-network`. Hacer Preview Compose y verificar que solo use `elevant-dev-data` y los dos volúmenes de medios. Desplegar el contenedor de medios **antes** de promover la API.
5. Comprobar desde la red privada el estado de Garage. Crear el bucket privado `elevant-development-media`, una clave dedicada para la API con lectura y escritura únicamente sobre ese bucket, y verificar una carga y lectura de un objeto sintético. Garage documenta los comandos `garage bucket create`, `garage key create` y `garage bucket allow` en su [guía oficial](https://garagehq.deuxfleurs.fr/documentation/quick-start/#manual-configuration). No habilitar website/public bucket.
6. En el Environment privado del recurso **API**, guardar `ELEVANT_MEDIA_ENDPOINT=http://elevant-dev-media:3900`, `ELEVANT_MEDIA_REGION=garage`, `ELEVANT_MEDIA_BUCKET=elevant-development-media`, `ELEVANT_MEDIA_ACCESS_KEY` y `ELEVANT_MEDIA_SECRET_KEY`. Estos últimos dos son secretos; no compartir valores ni Compose renderizado. Guardar el Raw API certificado con las cinco referencias `MediaStorage__*` antes de permitir el siguiente bundle. El controlador API CD exige igualdad semántica con este Raw.
7. Ejecutar un backup del **par** de volúmenes (metadata y data) mientras Garage está detenido o usar un método consistente documentado. Probar restauración a un recurso aislado antes de habilitar carga de usuarios. El backup SQL por sí solo no contiene los objetos.

## Verificación de la entrega

Promover en orden Database Release y API mediante los controladores existentes. Confirmar migraciones, API healthy, POST multipart de una imagen de servicio sintética con credencial autorizada, vincularla al servicio y comprobar GET del nuevo medio y rechazo de un identificador no vinculado. En el ciclo financiero de prueba, abrir la factura no fiscal y el pago propio y comprobar que ambos PDF se descargan con HTTP 200 y firma `%PDF-`; ambos objetos deben quedar en el bucket privado. Probar el flujo en Public Web, Private Web y el poll no-op posterior. Si falta Garage o su configuración, mantener el candidato API pendiente; no reemplazar la imagen sana por una que no pueda guardar medios o documentos.

No se publica el puerto S3 `3900`, RPC `3901`, SQL ni Dokploy en Internet. Los navegadores solo leen medios por el endpoint autorizado `/api/v1/media/{id}`.

Cada usuario autorizado puede cargar como máximo 100 archivos y 250 MiB por 24 horas; una exclusión por cuenta en SQL serializa cargas simultáneas. Los archivos nuevos se deben vincular durante los seis días posteriores a la carga. La API limpia cada hora los objetos que lleven más de siete días sin quedar vinculados a un servicio, aerolínea o persona. El mantenimiento necesita permisos de lectura, escritura y borrado sobre el bucket. Monitorear los errores del proceso de limpieza y el crecimiento de ambos volúmenes; este proceso no reemplaza el backup y su prueba de restauración.
