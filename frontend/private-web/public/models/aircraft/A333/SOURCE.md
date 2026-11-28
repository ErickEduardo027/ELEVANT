# A333: cómo reconstruir este modelo

La forma preferida de modificar esta obra es el modelo original de su repositorio, más el script que la procesa. Los dos son públicos:

- [`fam/a333/glTF2/A333.glb`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/a333/glTF2/A333.glb) (3142252 bytes, SHA-256 `2b5a0083fc1bee1b9932ec1b1fb034d5288efbef31aa604c901c66490b84e7f8`)
- [`fam/a333/COPYING`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/a333/COPYING) (18007 bytes, SHA-256 `dcc100d4161cc0b7177545ab6e47216f84857cda3843847c792a25289852dcaa`)
- [`fam/README.md`](https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/README.md) (491 bytes, SHA-256 `bf12cd622a565fa2717474091476ff2e4100970d2581bb481ada0c6dc8facabb`)
- `frontend/private-web/scripts/models/build-aircraft-models.mjs`, con `lib/` y `aircraft-sources.json` (en el repositorio de ELEVANT).

## Pasos

1. Descarga cada archivo de la lista anterior desde su URL a `<fuentes>/<ruta>` (la ruta de la lista).
2. Desde `frontend/private-web`, instala las dependencias con `npm ci`.
3. Ejecuta `node scripts/models/build-aircraft-models.mjs <fuentes> --only A333`.

El script comprueba el SHA-256 de cada archivo antes de usarlo y escribe `l2.gltf`, `l2.bin`, `l1.gltf`, `l1.bin`, `LICENSE`, `NOTICE.md` y este archivo en `public/models/aircraft/A333/`. El resultado es determinista: con las mismas fuentes salen los mismos bytes.
