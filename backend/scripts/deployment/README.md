# Automatización de despliegue de base de datos

Este directorio contiene utilidades deterministas usadas por CI. No abre una
conexión al VPS, no ejecuta SQL y no contiene credenciales.

## `database_release_manifest.py`

Genera y valida el manifiesto que une una publicación de Development con:

- el commit y la ejecución exactos de GitHub Actions;
- los digests inmutables de las imágenes `elevant-db-ops` y
  `elevant-db-release`;
- los hashes de ambos archivos Compose revisados;
- la cadena de migraciones y las huellas de modelo y seed certificadas.

El JSON no es por sí solo el artefacto de entrega. El workflow
`.github/workflows/backend-ci.yml` publica primero las dos imágenes y crea al
final el bundle OCI v1 con estos tres payloads certificados por el protocolo:

```text
/manifest.json
/compose/compose.development.database.yml
/compose/compose.development.release.yml
```

Los campos `compose.*Sha256` deben coincidir con los bytes incluidos. CI extrae
los tres payloads de la imagen construida y de la publicada por digest, y exige
igualdad byte a byte. El alias mutable `development-certified` solo sirve para
descubrir el último bundle; el controlador del VPS vuelve a resolver el digest,
valida todos los payloads y cachea los Compose por contenido antes de una
operación.

La interfaz completa se consulta con:

```bash
python backend/scripts/deployment/database_release_manifest.py --help
```

Las pruebas unitarias viven en
`backend/tests/scripts/test_database_release_manifest.py`.

## `guard-database-publication.sh`

Protege los aliases mutables de Development frente a ejecuciones obsoletas. El
helper actualiza `origin/Development` y solo autoriza la publicación cuando el
commit de la ejecución sigue siendo el tip, o cuando los commits posteriores no
modifican ninguna entrada propiedad de la base de datos. Rechaza revisiones que
ya no son ancestros de Development y avances que cambian rutas de base de datos.

La suite determinista usa repositorios Git temporales y un `origin` local, por
lo que valida el `fetch`, la ascendencia y la clasificación de rutas sin acceder
a la red:

```bash
bash backend/tests/scripts/test_guard_database_publication.sh
```

## `Dockerfile.database-release-bundle`

Construye una imagen `scratch` sin secretos ni herramientas de ejecución. Además
de las labels OCI de revisión/origen y las labels de esquema existentes, exige
`io.elevant.database-release.bundle-version=1` y
`io.elevant.database-release.media-type=application/vnd.elevant.database-release-bundle.v1`.
`CMD ["/manifest.json"]` conserva la inspección sencilla, pero el contrato es la
unidad de los tres payloads, no solo el JSON.
