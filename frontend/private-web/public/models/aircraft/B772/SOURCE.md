# B772: cómo reconstruir este modelo

La forma preferida de modificar esta obra es el modelo original de su repositorio, más el script que la procesa. Los dos son públicos:

- [`mbr1376/models/gltf_v2/airplane/b773.glb`](https://raw.githubusercontent.com/mbr1376/fr24-3d-models/3d0a50dfddf14cff653dd4ac6c6c11e3aa58b7de/models/gltf_v2/airplane/b773.glb) (1319992 bytes, SHA-256 `2a513928c397fe2951caf2b4211e053c17d845e6d9806deb53d680da9446915a`)
- [`mbr1376/LICENSE`](https://raw.githubusercontent.com/mbr1376/fr24-3d-models/3d0a50dfddf14cff653dd4ac6c6c11e3aa58b7de/LICENSE) (18046 bytes, SHA-256 `db296f2f7f35bca3a174efb0eb392b3b17bd94b341851429a3dff411b1c2fc73`)
- [`mbr1376/README.md`](https://raw.githubusercontent.com/mbr1376/fr24-3d-models/3d0a50dfddf14cff653dd4ac6c6c11e3aa58b7de/README.md) (5662 bytes, SHA-256 `3409caa2b5420887f4c980c4c164d603e806f5c61116410fe3332dfb385962b0`)
- `frontend/private-web/scripts/models/build-aircraft-models.mjs`, con `lib/` y `aircraft-sources.json` (en el repositorio de ELEVANT).

## Pasos

1. Descarga cada archivo de la lista anterior desde su URL a `<fuentes>/<ruta>` (la ruta de la lista).
2. Desde `frontend/private-web`, instala las dependencias con `npm ci`.
3. Ejecuta `node scripts/models/build-aircraft-models.mjs <fuentes> --only B772`.

El script comprueba el SHA-256 de cada archivo antes de usarlo y escribe `l2.gltf`, `l2.bin`, `l1.gltf`, `l1.bin`, `LICENSE`, `NOTICE.md` y este archivo en `public/models/aircraft/B772/`. El resultado es determinista: con las mismas fuentes salen los mismos bytes.
