# B752: cómo reconstruir este modelo

La forma preferida de modificar esta obra es el modelo original de su repositorio, más el script que la procesa. Los dos son públicos:

- [`fam/b752/glTF2/B752.glb`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/b752/glTF2/B752.glb) (2994212 bytes, SHA-256 `8f3ca67e2f956f5b799d83cb781462a9325f69a168d01387a26879966657622f`)
- [`fam/b752/LICENSE`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/b752/LICENSE) (19187 bytes, SHA-256 `f9c5933bb189067c5484cc0315b32a20b6d67d9eb34f1ff9a9c3a8db448ae43e`)
- [`fam/README.md`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/README.md) (491 bytes, SHA-256 `bf12cd622a565fa2717474091476ff2e4100970d2581bb481ada0c6dc8facabb`)
- `frontend/private-web/scripts/models/build-aircraft-models.mjs`, con `lib/` y `aircraft-sources.json` (en el repositorio de ELEVANT).

## Pasos

1. Descarga cada archivo de la lista anterior desde su URL a `<fuentes>/<ruta>` (la ruta de la lista).
2. Desde `frontend/private-web`, instala las dependencias con `npm ci`.
3. Ejecuta `node scripts/models/build-aircraft-models.mjs <fuentes> --only B752`.

El script comprueba el SHA-256 de cada archivo antes de usarlo y escribe `l2.gltf`, `l2.bin`, `l1.gltf`, `l1.bin`, `LICENSE`, `NOTICE.md` y este archivo en `public/models/aircraft/B752/`. El resultado es determinista: con las mismas fuentes salen los mismos bytes.
