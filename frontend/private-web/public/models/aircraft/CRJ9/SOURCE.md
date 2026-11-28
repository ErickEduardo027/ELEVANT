# CRJ9: cómo reconstruir este modelo

La forma preferida de modificar esta obra es el modelo original de su repositorio, más el script que la procesa. Los dos son públicos:

- [`fam/crj9/glTF2/CRJ9.glb`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/crj9/glTF2/CRJ9.glb) (2016512 bytes, SHA-256 `efcf8af5cc9325937e96eb1f4d0dcf72bd29cb6fb51470d583517f26878f30fc`)
- [`fam/crj9/LICENSE`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/crj9/LICENSE) (314 bytes, SHA-256 `9f2ea023bb32f950ae91990487ea9f3d63263851bd77bac5fd01a82419421d90`)
- [`fam/a320/COPYING`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/a320/COPYING) (18007 bytes, SHA-256 `dcc100d4161cc0b7177545ab6e47216f84857cda3843847c792a25289852dcaa`)
- [`fam/README.md`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/README.md) (491 bytes, SHA-256 `bf12cd622a565fa2717474091476ff2e4100970d2581bb481ada0c6dc8facabb`)
- `frontend/private-web/scripts/models/build-aircraft-models.mjs`, con `lib/` y `aircraft-sources.json` (en el repositorio de ELEVANT).

## Pasos

1. Descarga cada archivo de la lista anterior desde su URL a `<fuentes>/<ruta>` (la ruta de la lista).
2. Desde `frontend/private-web`, instala las dependencias con `npm ci`.
3. Ejecuta `node scripts/models/build-aircraft-models.mjs <fuentes> --only CRJ9`.

El script comprueba el SHA-256 de cada archivo antes de usarlo y escribe `l2.gltf`, `l2.bin`, `l1.gltf`, `l1.bin`, `LICENSE`, `NOTICE.md` y este archivo en `public/models/aircraft/CRJ9/`. El resultado es determinista: con las mismas fuentes salen los mismos bytes.
