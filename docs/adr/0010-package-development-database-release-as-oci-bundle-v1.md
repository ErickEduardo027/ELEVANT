# ADR-0010: Empaquetar la entrega de base Development como bundle OCI v1

## Estado

Accepted — 2026-08-30. Sustituye ADR-0009 únicamente en el empaquetado del
artefacto de entrega y en la validación de los Compose. El modelo pull-based,
la secuencia SQL y las demás decisiones de ADR-0009 continúan vigentes.

## Contexto

ADR-0009 definió un artefacto OCI que contenía solo `/manifest.json`. El
manifiesto certificaba el SHA-256 de los dos Compose revisados, mientras que el
controlador ejecutaba los archivos Raw conservados por Dokploy. Esa separación
permitía comprobar igualdad byte a byte, pero no transportar la configuración
certificada ni distinguir un cambio semántico de diferencias inocuas de
formato, comentarios u orden YAML.

La promoción necesita ejecutar entradas inmutables y conservar el Compose
aceptado para el backup previo y los jobs programados. A la vez, el Compose Raw
visible en Dokploy debe continuar siendo revisable por el operador y no puede
ser reemplazado automáticamente por el controlador.

## Decisión

- La entrega se publica como una imagen OCI `scratch` denominada **bundle v1**.
  Su identidad de ejecución es el digest del artefacto; el tag
  `development-certified` continúa siendo solo un alias de descubrimiento.
- El protocolo bundle v1 define y consume estos tres payloads requeridos:
  `/manifest.json`,
  `/compose/compose.development.database.yml` y
  `/compose/compose.development.release.yml`. Cualquier otro archivo eventual
  en el filesystem OCI queda fuera del protocolo y nunca se ejecuta ni cachea.
- Conserva las etiquetas de revisión, origen, ambiente y esquema de ADR-0009,
  y agrega
  `io.elevant.database-release.bundle-version=1` y
  `io.elevant.database-release.media-type=application/vnd.elevant.database-release-bundle.v1`.
  Un artefacto de solo manifiesto o con otra versión se rechaza.
- El JSON mantiene `schemaVersion: 1`. Sus campos
  `compose.databaseSha256` y `compose.releaseSha256` son los hashes de los bytes
  exactos de los dos payloads Compose incluidos. No se agregan paths remotos ni
  secretos al manifiesto.
- CI genera los tres payloads desde el mismo checkout certificado, construye el
  bundle, vuelve a extraerlos y exige igualdad byte a byte antes y después de
  publicar por digest. El alias se mueve únicamente después de publicar y
  validar el bundle completo.
- El controlador extrae los tres payloads desde el digest inmutable a un
  directorio temporal root-only. Exige archivos regulares, no symlinks, tamaño
  entre 1 byte y 1 MiB, esquema/identidades canónicos y hashes coincidentes
  antes de crear un intento o ejecutar SQL.
- Cada Compose validado se guarda por contenido en
  `state/compose/database/<sha256>.yml` o
  `state/compose/release/<sha256>.yml`, con propietario del controlador, modo
  `0600` y publicación atómica. El estado aceptado conserva ambos hashes. La
  adopción inicial almacena de la misma manera los Compose vivos; una entrada
  existente alterada o con symlink/metadata incorrectos, y una entrada aceptada
  ausente, fallan cerrado.
- La promoción ejecuta los Compose certificados del candidato desde ese cache.
  El backup previo usa la imagen ops y el Compose database de la última baseline
  aceptada; migración, seed, verificación, backup posterior y restore-check usan
  las entradas del candidato. Los jobs programados usan siempre el Compose
  database y la imagen ops de `last-success.json`.
- Antes de SQL, el controlador compara cada Compose certificado con su archivo
  Raw vivo en Dokploy. Renderiza ambos con Docker Compose en JSON, con todos los
  perfiles y sin interpolar variables ni resolver el entorno o paths; luego
  calcula SHA-256 sobre JSON canónico con claves ordenadas. Comentarios, estilo y
  orden YAML pueden diferir, pero cualquier cambio en el modelo resultante
  detiene la operación. Los secretos permanecen en los `.env` root-only y no
  forman parte de la comparación.
- El controlador no pulsa Deploy, no edita el provider Raw y no sincroniza el
  archivo vivo. Una diferencia semántica se resuelve mediante un cambio
  operativo revisado y un nuevo checkpoint, nunca ignorando el gate.

## Consecuencias

- El digest OCI vincula en una sola unidad el manifiesto y las dos entradas que
  realmente ejecutará el controlador.
- Cambios de formato que Dokploy introduzca en YAML no bloquean una promoción;
  cambios de servicios, imágenes, redes, volúmenes, comandos o permisos sí.
- Backups y restore-check siguen siendo reproducibles aunque un candidato
  posterior o el archivo Raw vivo cambien, porque usan el payload aceptado por
  hash.
- El cache agrega como máximo un archivo por hash y tipo. Bundle v1 no implementa
  recolección automática; no se elimina manualmente una entrada referenciada por
  `last-success.json` o por un intento que deba auditarse.
- El cambio de protocolo requiere un rollout controlado: el controlador nuevo
  no acepta el artefacto anterior de solo manifiesto. El operador espera un
  bundle v1 verde, instala, ejecuta `verify-runtime` y `--dry-run`, y solo
  entonces deshabilita los schedules manuales anteriores para adoptar la
  baseline. Tras `--status` y el primer `--poll` manual, habilita los jobs nuevos
  en orden backup, restore-check y poll. Si la adopción falla, reactiva los
  schedules anteriores.
- Este contrato continúa limitado a Development sintético. No añade firma o
  attestation, no autoriza despliegue remoto y no cambia los requisitos futuros
  de Production.
- GitHub Actions vuelve a consultar `Development` inmediatamente antes de cada
  alias mutable y rechaza avances DB-owned. GHCR no ofrece compare-and-swap de
  tags, por lo que permanece una ventana mínima entre esa consulta y el push;
  la serialización del job y el `runId` monótono del controlador impiden que un
  run antiguo reemplace una entrega que el VPS ya aceptó.

Guías operativas:
[`docs/deployment/dokploy-configuration.md`](../deployment/dokploy-configuration.md)
y [`ops/dokploy/database-cd/README.md`](../../ops/dokploy/database-cd/README.md).
