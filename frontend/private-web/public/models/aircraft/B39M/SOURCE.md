# B39M: cómo reconstruir este modelo

La forma preferida de modificar esta obra es el modelo original de su repositorio, más el script que la procesa. Los dos son públicos:

- [`rexo/Models/737-9.ac`](https://raw.githubusercontent.com/REXO-77/737-MAX/fc4316a01c1ec488789725bb54ed2f454f931ac6/Models/737-9.ac) (3726063 bytes, SHA-256 `9372aadb7a2c4b2f7a1d4386f0f02fe0a4916d48f36b62f8070d3dbd117fcbec`)
- [`rexo/LICENSE`](https://raw.githubusercontent.com/REXO-77/737-MAX/fc4316a01c1ec488789725bb54ed2f454f931ac6/LICENSE) (18092 bytes, SHA-256 `8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643`)
- [`rexo/README.md`](https://raw.githubusercontent.com/REXO-77/737-MAX/fc4316a01c1ec488789725bb54ed2f454f931ac6/README.md) (1303 bytes, SHA-256 `9ae90849602a81ba80388f18d1dfeb4a8ba039a7b7f906d9c55022c8c9215c72`)
- `frontend/private-web/scripts/models/build-aircraft-models.mjs`, con `lib/` y `aircraft-sources.json` (en el repositorio de ELEVANT).

## Pasos

1. Descarga cada archivo de la lista anterior desde su URL a `<fuentes>/<ruta>` (la ruta de la lista).
2. Desde `frontend/private-web`, instala las dependencias con `npm ci`.
3. Ejecuta `node scripts/models/build-aircraft-models.mjs <fuentes> --only B39M`.

El script comprueba el SHA-256 de cada archivo antes de usarlo y escribe `l2.gltf`, `l2.bin`, `l1.gltf`, `l1.bin`, `LICENSE`, `NOTICE.md` y este archivo en `public/models/aircraft/B39M/`. El resultado es determinista: con las mismas fuentes salen los mismos bytes.
