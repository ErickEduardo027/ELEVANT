# E190: cómo reconstruir este modelo

La forma preferida de modificar esta obra es el modelo original de su repositorio, más el script que la procesa. Los dos son públicos:

- [`fam/e190/glTF2/E190.glb`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/e190/glTF2/E190.glb) (3493372 bytes, SHA-256 `1f44507cf61b869170545c89f8f9e536566ccebea289ca75e1419f148713407f`)
- [`fam/e190/License.txt`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/e190/License.txt) (18332 bytes, SHA-256 `da0eca0fb517ac939d167924c9d4b3f8750a6b7191932ef2cb145acfa624ac7e`)
- [`fam/README.md`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/README.md) (491 bytes, SHA-256 `bf12cd622a565fa2717474091476ff2e4100970d2581bb481ada0c6dc8facabb`)
- `frontend/private-web/scripts/models/build-aircraft-models.mjs`, con `lib/` y `aircraft-sources.json` (en el repositorio de ELEVANT).

## Pasos

1. Descarga cada archivo de la lista anterior desde su URL a `<fuentes>/<ruta>` (la ruta de la lista).
2. Desde `frontend/private-web`, instala las dependencias con `npm ci`.
3. Ejecuta `node scripts/models/build-aircraft-models.mjs <fuentes> --only E190`.

El script comprueba el SHA-256 de cada archivo antes de usarlo y escribe `l2.gltf`, `l2.bin`, `l1.gltf`, `l1.bin`, `LICENSE`, `NOTICE.md` y este archivo en `public/models/aircraft/E190/`. El resultado es determinista: con las mismas fuentes salen los mismos bytes.
