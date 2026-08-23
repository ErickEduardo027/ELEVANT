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

El workflow `.github/workflows/backend-ci.yml` publica primero las dos imágenes
y crea al final un artefacto OCI mínimo con `/manifest.json`. El alias mutable
`development-certified` solo sirve para descubrir el último manifiesto; el
controlador del VPS vuelve a resolver y valida todos los digests antes de hacer
una operación.

La interfaz completa se consulta con:

```bash
python backend/scripts/deployment/database_release_manifest.py --help
```

Las pruebas unitarias viven en
`backend/tests/scripts/test_database_release_manifest.py`.
