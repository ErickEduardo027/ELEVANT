# AT76: aviso de origen, licencia y cambios

Modelo 3D del AT76 (ATR 72-600) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-3.0-only y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del ATR 72-500 (por el ATR 72-600).

## Origen

- Archivo: `atr72/glTF2/AT75.glb` del repositorio [Ysurac/FlightAirMap-3dmodels](https://github.com/Ysurac/FlightAirMap-3dmodels) en el commit `0906d9ba1bdd906ce45807e45ed706c09912db19`.
- URL fijada: https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/atr72/glTF2/AT75.glb
- SHA-256 del original: `52ec4c85143390e11b00a6c690c4b93189c646800e04d1fd2e3ac1f14f4e347a`.
- Autoría: Ysurac, repositorio FlightAirMap-3dmodels (modelos de FGMEMBERS vía fr24-3d-models de Aleksei Kalmykov / Flightradar24).
- Procedencia aguas arriba: FlightGear ATR 72-500 (FGMEMBERS), según el README de FlightAirMap.
- Licencia: GPL-3.0-only, según `atr72/LICENCE.txt` de Ysurac/FlightAirMap-3dmodels.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (27,17 × 27,05 × 7,65 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose+Z».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Quitadas 4 piezas (624 triángulos): lpropblur, nav0, nav1, rpropblur.
- Escalado ×0.9920 a la longitud del AT76 (27,17 m).
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 0,70 m del suelo (z = 0) y la deriva a 7,55 m (7,65 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 24865 a 13676 triángulos (ratio 0.55, error relativo 0.0002), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
